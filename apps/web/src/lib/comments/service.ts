import { readActivity, threadActivity, withThreadActivity } from './activity';
import { getReadSequence, loadReadSequences, unreadComments } from './readState';
import { nanoid } from 'nanoid';
import { submission, recoverSubmission, commitNewSubmission, commitReplySubmission } from './submissions';
import { withEditedThreadItem } from './editing';
import type { EditThreadItemInput } from './validation';
import { screenshotDocumentId, type DbComment, type DbCommentDevice, type DbCommentScreenshot, type DbScreenshot, type DbThreadItem } from '../db/schema';
import { commentsContainerName, DEFAULT_COMMENTS_CONTAINER_NAME } from '../db/client';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { toCommentDto, withinListResponseSize, type CommentDto } from './dto';
import { authorNames } from './authorNames';
import { isLocalRuntime } from './environment';
import { ApiError, apiErrors, writerId, type CommentsApiContext } from './http';
import {
    COMMENT_TTL_SECONDS,
    MAX_LIST_COMMENTS,
    MAX_THREAD_ITEMS,
    PREVIEW_COMMENT_TTL_SECONDS
} from './limits';
import { enforceNewCommentLimits, enforceReplyLimits, enforceScreenshotLimits, type RateLimitSubject, type RewriteLimitSubject } from './rateLimits';
import type { ParsedScreenshot } from './screenshot';
import type { CreateCommentInput, ReplyInput, UpdateCommentInput } from './validation';
import { ipRateLimitBucket, isLoopbackIp, resolveClientIp } from './visitor';
import { HEADLINE_COMMENT_ID, STEP_COMMENT_ID, PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION, isPrivateAppFeedback } from './publicProject';

const MAX_UPDATE_ATTEMPTS = 8;

function nowIso() {
    return new Date().toISOString();
}

/**
 * 90 days in the production container. Any other container (`comments-preview`) keeps its own,
 * shorter default TTL: a per-item ttl would override it.
 */
export function commentTtlSeconds() {
    return commentsContainerName() === DEFAULT_COMMENTS_CONTAINER_NAME ? COMMENT_TTL_SECONDS : undefined;
}

/**
 * IP bucket used for rate limiting. Locally (development and e2e tests) loopback requests are not
 * IP limited, so all local test visitors don't share a single bucket.
 */
function rateLimitIpBucket(request: Request) {
    const ip = resolveClientIp(request);
    if (!ip)
        return isLocalRuntime() ? undefined : 'unknown';
    if (isLocalRuntime() && isLoopbackIp(ip))
        return undefined;
    return ipRateLimitBucket(ip);
}

function rateLimitSubject(context: CommentsApiContext): RateLimitSubject {
    return {
        domain: context.domain,
        authorId: writerId(context),
        ipBucket: rateLimitIpBucket(context.request)
    };
}

/**
 * Rewrite requests never create the visitor identity, so the visitor is counted only when the
 * `uier_visitor` cookie is already there; the IP, site and app-wide limits always apply.
 */
export function rewriteLimitSubject(context: CommentsApiContext): RewriteLimitSubject {
    return {
        domain: context.domain,
        authorId: context.visitor.authorId,
        ipBucket: rateLimitIpBucket(context.request)
    };
}

function compactDevice(device: CreateCommentInput['device']): DbCommentDevice | undefined {
    if (!device)
        return undefined;

    const compacted = Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined)) as DbCommentDevice;
    return Object.keys(compacted).length ? compacted : undefined;
}

/** Private comments (made private by the team, or feedback on the app) show only to their author here */
function isVisible(comment: DbComment, context: CommentsApiContext) {
    return !(comment.private || isPrivateAppFeedback(comment))
        || (Boolean(comment.authorId) && comment.authorId === context.visitor.authorId);
}

/** Public showcase uses the visitor cookie; private project threads still stay author-only. */
function assertVisible(comment: DbComment, context: CommentsApiContext) {
    if (!isVisible(comment, context))
        throw apiErrors.notFound();
}

async function toDto(comment: DbComment, context: CommentsApiContext): Promise<CommentDto> {
    assertVisible(comment, context);
    const dto = toCommentDto(comment, context.visitor.authorId, await authorNames([comment]));
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    return { ...dto, activity: readActivity(comment, context.visitor.authorId, context.visitor.authorId ? await getReadSequence(context.domain, context.visitor.authorId, comment.id) : 0) };
}

export function assertCommentAuthor(comment: DbComment, context: CommentsApiContext) {
    assertVisible(comment, context);
    if (!comment.authorId || comment.authorId !== context.visitor.authorId)
        throw apiErrors.forbidden('Only the author of the comment can do this.');
}

/**
 * Read-modify-write with optimistic concurrency (Cosmos etag / If-Match), retried on conflicts, so
 * concurrent replies or deletes never overwrite each other. `update` returns the new comment, or
 * `null` to delete it; either is written only if the comment is still the version it was given.
 */
async function updateComment<T extends DbComment | null>(
    store: CommentsStore,
    domain: string,
    id: string,
    update: (comment: DbComment) => T
): Promise<T> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await store.get(domain, id);
        if (!stored)
            throw apiErrors.notFound();

        const updated = update({ ...stored.comment, activity: threadActivity(stored.comment) });
        const result = updated
            ? await store.replace(updated, stored.etag)
            : await store.delete(domain, id, stored.etag);
        if (result === 'ok')
            return updated;
        if (result === 'not_found')
            throw apiErrors.notFound();

        // Somebody else modified the comment in the meantime - back off a bit and retry on the new version
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
    }

    throw apiErrors.conflict();
}

/**
 * The page's newest comments (or, without a path, those of every page of the domain), as many as
 * fit into {@link MAX_LIST_RESPONSE_BYTES}
 */
export async function listComments(context: CommentsApiContext, path: string | null, unreadOnly = false) {
    const store = getCommentsStore();
    let comments = unreadOnly
        ? await unreadComments(context.domain, context.visitor.authorId)
        : path === null
        ? await store.listAll(context.domain, MAX_LIST_COMMENTS)
        : await store.list(context.domain, path, MAX_LIST_COMMENTS);
    // The initial threads stay visible even when the page has more than one list of feedback.
    if (!unreadOnly && context.domain === PUBLIC_PROJECT_PARTITION && (path === null || path === '/')) {
        const starters = (await Promise.all([HEADLINE_COMMENT_ID, STEP_COMMENT_ID].map(id => store.get(context.domain, id))))
            .flatMap(stored => stored ? [stored.comment] : []);
        const ids = new Set(starters.map(comment => comment.id));
        comments = [...starters, ...comments.filter(comment => !ids.has(comment.id))].slice(0, MAX_LIST_COMMENTS);
    }
    comments = comments.filter(comment => isVisible(comment, context));
    const names = await authorNames(comments);
    const reads = await loadReadSequences(context.domain, context.visitor.authorId);
    return withinListResponseSize(comments.flatMap(comment => {
        const dto = toCommentDto(comment, context.visitor.authorId, names);
        return dto ? [{ ...dto, activity: readActivity(comment, context.visitor.authorId, reads.get(comment.id)) }] : [];
    }));
}

/** What the comment keeps about its screenshot */
export function screenshotInfo(screenshot: ParsedScreenshot): DbCommentScreenshot {
    return { contentType: screenshot.contentType, width: screenshot.width, height: screenshot.height, bytes: screenshot.data.length };
}

/** Image limits do not block automatic feedback text. */
export async function availableScreenshot(store: CommentsStore, domain: string, screenshot: ParsedScreenshot | undefined) {
    if (!screenshot) return undefined;
    try {
        await enforceScreenshotLimits(store, domain);
        return screenshot;
    } catch (error) {
        if (error instanceof ApiError && error.code === 'rate_limited') return undefined;
        throw error;
    }
}

/**
 * Stores the comment and its screenshot (a document of its own, written first, with the comment's
 * `ttl`). When the comment can't be written, the screenshot goes again.
 */
export async function createWithScreenshot(store: CommentsStore, comment: DbComment, screenshot: ParsedScreenshot | undefined) {
    if (!screenshot) {
        await store.create(comment);
        return;
    }

    const document = screenshotDocument(comment, screenshot);
    try {
        await store.createScreenshot(document);
    } catch (error) {
        console.warn('[comments] Screenshot storage failed; saving feedback without an image', error);
        await store.deleteScreenshot(comment.domain, comment.id).catch(() => undefined);
        delete comment.screenshot;
        await store.create(comment);
        return;
    }
    try {
        await store.create(comment);
    } catch (error) {
        await store.deleteScreenshot(comment.domain, comment.id).catch(() => undefined);
        throw error;
    }
}

export function screenshotDocument(comment: DbComment, screenshot: ParsedScreenshot): DbScreenshot {
    const document: DbScreenshot = {
        ...screenshotInfo(screenshot),
        id: screenshotDocumentId(comment.id),
        domain: comment.domain,
        type: 'screenshot',
        commentId: comment.id,
        data: screenshot.data.toString('base64'),
        createdAt: comment.createdAt ?? nowIso()
    };
    if (comment.ttl !== undefined)
        document.ttl = comment.ttl;
    return document;
}

/**
 * Deletes the screenshot when the comment that had one is gone, or lost its first item (the
 * author's content: the screenshot goes with the text). The comment is already written, so a
 * failure here is retried once and logged, never turned into an error for a delete that happened.
 */
export async function forgetScreenshot(store: CommentsStore, domain: string, id: string, hadScreenshot: boolean, updated: DbComment | null) {
    if (!hadScreenshot || updated?.screenshot)
        return;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await store.deleteScreenshot(domain, id);
            return;
        } catch (error) {
            if (attempt === 2)
                console.error(`[comments] The screenshot of ${id} could not be deleted`, error);
        }
    }
}

export async function createComment(context: CommentsApiContext, input: CreateCommentInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    const attempt = submission(context.domain, subject.authorId, input.idempotencyKey, {
        operation: 'create', path: input.path, position: input.position, kind: input.kind, text: input.text, quotedText: input.quotedText
    });
    const recovered = await recoverSubmission(store, attempt);
    if (recovered) return toDto(recovered, context);
    await enforceNewCommentLimits(store, subject, input.path);
    const screenshot = await availableScreenshot(store, context.domain, input.screenshot);

    const now = nowIso();
    const firstItem: DbThreadItem = {
        id: `item_${nanoid()}`,
        text: input.text,
        quotedText: input.quotedText,
        authorId: subject.authorId,
        createdAt: now
    };
    const comment: DbComment = {
        id: `comment_${nanoid()}`,
        domain: context.domain,
        ...(context.domain === PUBLIC_PROJECT_PARTITION ? { projectId: PUBLIC_PROJECT_ID } : {}),
        ...(isPrivateAppFeedback({ domain: context.domain, path: input.path }) ? { private: true } : {}),
        path: input.path,
        position: input.position,
        number: await store.nextCommentNumber(context.domain),
        kind: input.kind,
        thread: { items: [firstItem] },
        device: compactDevice(input.device),
        resolved: false,
        authorId: subject.authorId,
        activity: { sequence: 1, byActor: { [subject.authorId!]: 1 } },
        createdAt: now,
        updatedAt: now,
        ttl: commentTtlSeconds()
    };
    if (screenshot)
        comment.screenshot = screenshotInfo(screenshot);

    if (attempt) return toDto(await commitNewSubmission(store, attempt, comment, screenshot ? screenshotDocument(comment, screenshot) : undefined), context);
    await createWithScreenshot(store, comment, screenshot);
    return toDto(comment, context);
}

/** The comment's screenshot; public like the comment */
export async function getCommentScreenshot(context: CommentsApiContext, id: string) {
    const store = getCommentsStore();
    const stored = await store.get(context.domain, id);
    if (stored) assertVisible(stored.comment, context);
    const screenshot = stored?.comment.screenshot ? await store.getScreenshot(context.domain, id) : null;
    if (!screenshot)
        throw apiErrors.notFound('Screenshot not found.');
    return screenshot;
}

export async function replyToComment(context: CommentsApiContext, id: string, input: ReplyInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    const attempt = submission(context.domain, subject.authorId, input.idempotencyKey, { operation: 'reply', id, text: input.text });
    const recovered = await recoverSubmission(store, attempt);
    if (recovered) { assertVisible(recovered, context); return toDto(recovered, context); }
    const target = await store.get(context.domain, id);
    if (!target) throw apiErrors.notFound();
    assertVisible(target.comment, context);

    await enforceReplyLimits(store, subject);

    const now = nowIso();
    const item: DbThreadItem = {
        id: `item_${nanoid()}`,
        text: input.text,
        authorId: subject.authorId,
        createdAt: now
    };
    if (attempt) return toDto(await commitReplySubmission(store, attempt, id, item, comment => assertVisible(comment, context)), context);
    const result = await store.appendThreadItem(context.domain, id, item, MAX_THREAD_ITEMS, now);
    if (result === 'not_found')
        throw apiErrors.notFound();
    if (result === 'full')
        throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);

    const stored = await store.get(context.domain, id);
    if (!stored)
        throw apiErrors.notFound();
    return toDto(stored.comment, context);
}

export async function updateCommentResolved(context: CommentsApiContext, id: string, input: UpdateCommentInput) {
    const updated = await updateComment(getCommentsStore(), context.domain, id, comment => {
        assertCommentAuthor(comment, context);
        return { ...(Boolean(comment.resolved) === input.resolved ? comment : withThreadActivity(comment, writerId(context))), resolved: input.resolved, updatedAt: nowIso() };
    });

    return toDto(updated, context);
}

export async function editCommentThreadItem(context: CommentsApiContext, id: string, itemId: string, input: EditThreadItemInput) {
    const updated = await updateComment(getCommentsStore(), context.domain, id, comment => {
        assertVisible(comment, context);
        return withEditedThreadItem(comment, itemId, input, item => Boolean(item.authorId) && item.authorId === context.visitor.authorId);
    });
    return toDto(updated, context);
}

function threadItems(comment: DbComment) {
    return Array.isArray(comment.thread?.items) ? comment.thread.items : [];
}

function isDeletedItem(item: DbThreadItem) {
    return typeof item.deletedAt === 'string';
}

/**
 * The comment without its first item, or `null` when the whole comment goes. Author of the comment
 * only.
 *
 * When other visitors replied, their replies stay: the first item becomes a placeholder ("Comment
 * deleted") without its text, quoted text and author, and the comment loses its author and device
 * details, so nobody can resolve or delete the thread any more. Without other visitors' replies the
 * comment is deleted, with the author's own replies.
 */
function withoutFirstItem(comment: DbComment, context: CommentsApiContext): DbComment | null {
    assertCommentAuthor(comment, context);

    const [first, ...replies] = threadItems(comment);
    if (!first || replies.every(reply => reply.authorId === comment.authorId))
        return null;

    const now = nowIso();
    const placeholder: DbThreadItem = { id: first.id, text: '', deletedAt: now };
    if (first.createdAt)
        placeholder.createdAt = first.createdAt;

    const updated: DbComment = {
        ...comment,
        thread: { ...comment.thread, items: [placeholder, ...replies] },
        updatedAt: now
    };
    delete updated.authorId;
    delete updated.device;
    delete updated.screenshot;
    return updated;
}

/**
 * The comment without one of its replies, or `null` when only the placeholder of a deleted first
 * item would be left. Author of the reply only.
 */
function withoutReply(comment: DbComment, itemId: string, context: CommentsApiContext): DbComment | null {
    assertVisible(comment, context);
    const items = threadItems(comment);
    const reply = items.find(item => item.id === itemId);
    if (!reply)
        throw apiErrors.notFound('Reply not found.');
    if (!reply.authorId || reply.authorId !== context.visitor.authorId)
        throw apiErrors.forbidden('Only the author of the reply can delete it.');

    const remaining = items.filter(item => item !== reply);
    if (remaining.every(isDeletedItem))
        return null;

    return {
        ...comment,
        thread: { ...comment.thread, items: remaining },
        updatedAt: nowIso()
    };
}

/**
 * Deletes the comment's first item (see {@link withoutFirstItem}). Returns `null` when the whole
 * comment was deleted, otherwise the comment that stays.
 */
export async function deleteComment(context: CommentsApiContext, id: string): Promise<CommentDto | null> {
    const store = getCommentsStore();
    let hadScreenshot = false;
    const updated = await updateComment(store, context.domain, id, comment => {
        hadScreenshot = Boolean(comment.screenshot);
        return withoutFirstItem(comment, context);
    });
    await forgetScreenshot(store, context.domain, id, hadScreenshot, updated);
    return updated ? toDto(updated, context) : null;
}

/**
 * Deletes a thread item: the first item as {@link deleteComment}, a reply with
 * {@link withoutReply}. Returns `null` when the whole comment was deleted, otherwise the updated
 * comment.
 */
export async function deleteThreadItem(context: CommentsApiContext, id: string, itemId: string): Promise<CommentDto | null> {
    const store = getCommentsStore();
    let hadScreenshot = false;
    const updated = await updateComment(store, context.domain, id, comment => {
        hadScreenshot = Boolean(comment.screenshot);
        const itemIndex = threadItems(comment).findIndex(item => item.id === itemId);
        if (itemIndex < 0)
            throw apiErrors.notFound('Reply not found.');

        return itemIndex === 0
            ? withoutFirstItem(comment, context)
            : withoutReply(comment, itemId, context);
    });

    await forgetScreenshot(store, context.domain, id, hadScreenshot, updated);
    return updated ? toDto(updated, context) : null;
}

export { toDto as toPublicCommentDto };
