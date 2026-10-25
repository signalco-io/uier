import { nanoid } from 'nanoid';
import { screenshotDocumentId, type DbComment, type DbCommentDevice, type DbCommentScreenshot, type DbScreenshot, type DbThreadItem } from '../db/schema';
import { commentsContainerName, DEFAULT_COMMENTS_CONTAINER_NAME } from '../db/client';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { toCommentDto, withinListResponseSize, type CommentDto } from './dto';
import { isLocalRuntime } from './environment';
import { apiErrors, writerId, type CommentsApiContext } from './http';
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

const MAX_UPDATE_ATTEMPTS = 8;

function nowIso() {
    return new Date().toISOString();
}

/**
 * 90 days in the production container. Any other container (`comments-preview`) keeps its own,
 * shorter default TTL: a per-item ttl would override it.
 */
function commentTtlSeconds() {
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

function toDto(comment: DbComment, context: CommentsApiContext): CommentDto {
    const dto = toCommentDto(comment, context.visitor.authorId);
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    return dto;
}

function assertCommentAuthor(comment: DbComment, context: CommentsApiContext) {
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

        const updated = update(stored.comment);
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
export async function listComments(context: CommentsApiContext, path: string | null) {
    const store = getCommentsStore();
    const comments = path === null
        ? await store.listAll(context.domain, MAX_LIST_COMMENTS)
        : await store.list(context.domain, path, MAX_LIST_COMMENTS);
    return withinListResponseSize(comments
        .map(comment => toCommentDto(comment, context.visitor.authorId))
        .filter((dto): dto is CommentDto => Boolean(dto)));
}

/** What the comment keeps about its screenshot */
export function screenshotInfo(screenshot: ParsedScreenshot): DbCommentScreenshot {
    return { contentType: screenshot.contentType, width: screenshot.width, height: screenshot.height, bytes: screenshot.data.length };
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
    await store.createScreenshot(document);
    try {
        await store.create(comment);
    } catch (error) {
        await store.deleteScreenshot(comment.domain, comment.id).catch(() => undefined);
        throw error;
    }
}

/**
 * Deletes the screenshot when the comment that had one is gone, or lost its first item (the
 * author's content: the screenshot goes with the text)
 */
export async function forgetScreenshot(store: CommentsStore, domain: string, id: string, hadScreenshot: boolean, updated: DbComment | null) {
    if (hadScreenshot && !updated?.screenshot)
        await store.deleteScreenshot(domain, id);
}

export async function createComment(context: CommentsApiContext, input: CreateCommentInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    await enforceNewCommentLimits(store, subject, input.path);
    if (input.screenshot)
        await enforceScreenshotLimits(store, context.domain);

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
        path: input.path,
        position: input.position,
        number: await store.nextCommentNumber(context.domain),
        kind: input.kind,
        thread: { items: [firstItem] },
        device: compactDevice(input.device),
        resolved: false,
        authorId: subject.authorId,
        createdAt: now,
        updatedAt: now,
        ttl: commentTtlSeconds()
    };
    if (input.screenshot)
        comment.screenshot = screenshotInfo(input.screenshot);

    await createWithScreenshot(store, comment, input.screenshot);
    return toDto(comment, context);
}

/** The comment's screenshot; public like the comment */
export async function getCommentScreenshot(context: CommentsApiContext, id: string) {
    const store = getCommentsStore();
    const stored = await store.get(context.domain, id);
    const screenshot = stored?.comment.screenshot ? await store.getScreenshot(context.domain, id) : null;
    if (!screenshot)
        throw apiErrors.notFound('Screenshot not found.');
    return screenshot;
}

export async function replyToComment(context: CommentsApiContext, id: string, input: ReplyInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    if (!await store.get(context.domain, id))
        throw apiErrors.notFound();

    await enforceReplyLimits(store, subject);

    const now = nowIso();
    const result = await store.appendThreadItem(context.domain, id, {
        id: `item_${nanoid()}`,
        text: input.text,
        authorId: subject.authorId,
        createdAt: now
    }, MAX_THREAD_ITEMS, now);
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
        return { ...comment, resolved: input.resolved, updatedAt: nowIso() };
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
