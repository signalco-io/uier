import { syncTombstone, withSyncMark } from '../integrations/syncSignal';
import { z } from 'zod';
import { userIdSchema } from '../app/validation';
import { reattachAnchor } from '../comments/reattachAnchor';
import type { ReattachAnchorInput } from '../comments/validation';
import { projectOrigins } from '../app/projects';

import type { OriginFilter } from '../repo/originFilter';
import { threadActivity, withThreadActivity } from '../comments/activity';
import { nanoid } from 'nanoid';
import { moveMentions } from '@uier/toolbar/mentions';
import { withNotificationEvent } from '../notifications/events';
import { commitChangeSubmission, commitNewSubmission, commitReplySubmission, recoverSubmission, submission, type Submission } from '../comments/submissions';
import { withEditedThreadItem } from '../comments/editing';
import type { EditThreadItemInput } from '../comments/validation';
import type { DbComment, DbCommentDevice, DbThreadItem, DbMention } from '../db/schema';
import { getCommentsStore, type CommentsStore, type ConditionalWriteResult } from '../repo/commentsStore';
import { apiErrors } from '../comments/http';
import { MAX_THREAD_ITEMS } from '../comments/limits';
import { enforceNewCommentLimits, enforceReplyLimits, enforceRewriteLimits, type RateLimitSubject } from '../comments/rateLimits';
import { availableScreenshot, commentTtlSeconds, createWithScreenshot, forgetScreenshot, screenshotDocument, screenshotInfo } from '../comments/service';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { ipRateLimitBucket, isLoopbackIp, resolveClientIp } from '../comments/visitor';
import { isLocalRuntime } from '../comments/environment';
import { isValidId, type CreateCommentInput } from '../comments/validation';
import type { DbProject } from '../app/model';
import { actorAuthorId, memberActor, assertWriter, type ProjectActor } from './actor';
import { assertEligibleParticipant, assertParticipantEditor, validateMentions } from './participants';
import { replaceSavedScreenshot } from '../comments/replaceScreenshot';
import type { ParsedScreenshot } from '../comments/screenshot';

/** Most comments the app loads for a project (all pages) */
export const MAX_PROJECT_COMMENTS = 1000;
const MAX_UPDATE_ATTEMPTS = 8;

function mentionRecipients(mentions: readonly DbMention[] = []) {
    return [...new Set(mentions.map(mention => `user:${mention.userId}`))];
}

/** Project comments live in the comments container under their own partition */
export function projectPartition(projectId: string) {
    return `project:${projectId}`;
}

function nowIso() {
    return new Date().toISOString();
}

function threadItems(comment: DbComment) {
    return Array.isArray(comment.thread?.items) ? comment.thread.items : [];
}

function isAuthor(authorId: string | undefined, actor: ProjectActor) {
    const id = actorAuthorId(actor);
    return Boolean(authorId && id && authorId === id);
}

function isAdmin(actor: ProjectActor) {
    return actor.kind === 'member' && actor.isAdmin;
}

// Permissions of project comments. Members review together: any member can mark a comment done.
// The author and the workspace admins can edit and delete it; only admins make it private.

export function canSeeComment(comment: Pick<DbComment, 'private' | 'authorId' | 'domain' | 'path'>, actor: ProjectActor) {
    return !(comment.private || isPrivateAppFeedback(comment)) || isAdmin(actor) || isAuthor(comment.authorId, actor);
}

export function canResolveComment(comment: DbComment, actor: ProjectActor) {
    return actor.kind === 'member' || isAuthor(comment.authorId, actor);
}

export function canEditComment(comment: DbComment, actor: ProjectActor) {
    return isAdmin(actor) || isAuthor(comment.authorId, actor);
}

export function canDeleteComment(comment: DbComment, actor: ProjectActor) {
    return isAdmin(actor) || isAuthor(comment.authorId, actor);
}

export function canDeleteItem(item: DbThreadItem, actor: ProjectActor) {
    return !item.deletedAt && (isAdmin(actor) || isAuthor(item.authorId, actor));
}

export function canEditItem(item: DbThreadItem, actor: ProjectActor) {
    return !item.deletedAt && (isAdmin(actor) || isAuthor(item.authorId, actor));
}

export function canMakeCommentPrivate(actor: ProjectActor) {
    return isAdmin(actor);
}

function rateLimitIpBucket(request: Request) {
    const ip = resolveClientIp(request);
    if (!ip)
        return isLocalRuntime() ? undefined : 'unknown';
    if (isLocalRuntime() && isLoopbackIp(ip))
        return undefined;
    return ipRateLimitBucket(ip);
}

/** Actors come from resolveActor/memberActor or mcpProject, which recheck current access. */
function commentRateLimitSubject(request: Request, project: DbProject, actor: ProjectActor, authorId: string): RateLimitSubject {
    return {
        domain: projectPartition(project.id), authorId, ipBucket: rateLimitIpBucket(request),
        // Anyone can join the public feedback project; enrollment must not raise its limits.
        member: actor.kind === 'member' && (project.id !== PUBLIC_PROJECT_ID || actor.isAdmin),
        credentialId: actor.kind === 'member' ? actor.agent?.credentialId : undefined
    };
}

function compactDevice(device: CreateCommentInput['device']): DbCommentDevice | undefined {
    if (!device)
        return undefined;
    const compacted = Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined)) as DbCommentDevice;
    return Object.keys(compacted).length ? compacted : undefined;
}

/**
 * The stored comment. Ids the server never gives out (the app's actions get theirs from the
 * browser) are not found, like the partition's documents that are not comments.
 */
async function getStoredComment(store: CommentsStore, partition: string, id: string) {
    return isValidId(id) ? await store.get(partition, id) : null;
}

/** Read-modify-write with optimistic concurrency; `update` returns `null` to delete the comment */
async function updateComment<T extends DbComment | null>(
    store: CommentsStore,
    partition: string,
    id: string,
    update: (comment: DbComment) => T | Promise<T>,
    onDelete?: (comment: DbComment, etag: string) => Promise<ConditionalWriteResult>
): Promise<T> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await getStoredComment(store, partition, id);
        if (!stored)
            throw apiErrors.notFound();

        const updated = await update({ ...stored.comment, activity: threadActivity(stored.comment) });
        const result = updated
            ? await store.replace(updated, stored.etag)
            : await (onDelete ? onDelete(stored.comment, stored.etag) : store.delete(partition, id, stored.etag));
        if (result === 'ok')
            return updated;
        if (result === 'not_found')
            throw apiErrors.notFound();

        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
    }
    throw apiErrors.conflict();
}

/** A comment the actor can see; private comments of others are "not found" */
function visibleOrThrow(comment: DbComment, actor: ProjectActor) {
    if (!canSeeComment(comment, actor))
        throw apiErrors.notFound();
    return comment;
}

/** Comments of one page, or of every page (`path` undefined), that the actor can see */
export async function listProjectComments(project: DbProject, actor: ProjectActor, path?: string, originFilter?: OriginFilter, authorId?: string) {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    if (authorId !== undefined && !isAdmin(actor))
        throw apiErrors.forbidden('Only admins can filter by author.');
    const comments = path === undefined
        ? await store.listAll(partition, MAX_PROJECT_COMMENTS, originFilter, authorId)
        : await store.list(partition, path, MAX_PROJECT_COMMENTS, originFilter, authorId);
    return comments.filter(comment => canSeeComment(comment, actor));
}

export async function getProjectComment(project: DbProject, actor: ProjectActor, id: string) {
    const stored = await getStoredComment(getCommentsStore(), projectPartition(project.id), id);
    return stored ? visibleOrThrow(stored.comment, actor) : null;
}

export type NewProjectComment = CreateCommentInput & {
    pageStateVersion?: 1;
    /** Origin of the site it was left on (one of the project's addresses) */
    origin: string;
    mentions?: DbMention[];
    /** Guests: the name they gave */
    authorName?: string;
};

export async function createProjectComment(request: Request, project: DbProject, actor: ProjectActor, input: NewProjectComment) {
    const authorId = actorAuthorId(actor);
    if (!authorId)
        throw apiErrors.invalidRequest('Comments need a visitor id.');

    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    const attempt = submission(partition, authorId, input.idempotencyKey, {
        operation: 'create', path: input.path, position: input.position, kind: input.kind, text: input.text, mentions: input.mentions ?? [],
        quotedText: input.quotedText, authorName: actor.kind === 'guest' ? input.authorName : undefined, origin: input.origin
    });
    const recovered = await recoverSubmission(store, attempt);
    if (recovered) return visibleOrThrow(recovered, actor);
    await enforceNewCommentLimits(store, commentRateLimitSubject(request, project, actor, authorId), input.path);
    const screenshot = await availableScreenshot(store, partition, input.screenshot);

    const now = nowIso();
    const authorName = actor.kind === 'guest' ? input.authorName : undefined;
    const comment: DbComment = {
        id: `comment_${nanoid()}`,
        domain: partition,
        projectId: project.id,
        ...(project.id === PUBLIC_PROJECT_ID ? { ttl: commentTtlSeconds() } : {}),
        ...(isPrivateAppFeedback({ domain: partition, path: input.path }) ? { private: true } : {}),
        origin: input.origin,
        path: input.path,
        ...(input.pageStateVersion === 1 ? { pageStateVersion: 1 as const } : {}),
        position: input.position,
        number: await store.nextCommentNumber(partition),
        kind: input.kind,
        thread: {
            items: [{
                id: `item_${nanoid()}`,
                text: input.text,
                quotedText: input.quotedText,
                authorId,
                authorName,
                createdAt: now
            }]
        },
        device: compactDevice(input.device),
        resolved: false,
        authorId,
        activity: { sequence: 1, byActor: { [authorId]: 1 } },
        createdAt: now,
        updatedAt: now
    };
    comment.thread.items[0]!.mentions = await validateMentions(project, actor, comment, input.text, input.mentions);
    if (screenshot)
        comment.screenshot = screenshotInfo(screenshot);
    const recorded = withSyncMark(project, null, withNotificationEvent(comment, authorId, 'comment', now, mentionRecipients(comment.thread.items[0]!.mentions), actor.kind === 'member' ? actor.agent : undefined, { itemId: comment.thread.items[0]!.id }));
    if (attempt) return visibleOrThrow(await commitNewSubmission(store, attempt, recorded, screenshot ? screenshotDocument(recorded, screenshot) : undefined), actor);
    await createWithScreenshot(store, recorded, screenshot);
    return recorded;
}

/** The screenshot of a comment the actor can see */
export async function getProjectScreenshot(project: DbProject, actor: ProjectActor, id: string) {
    const comment = await getProjectComment(project, actor, id);
    const screenshot = comment?.screenshot
        ? await getCommentsStore().getScreenshot(projectPartition(project.id), id)
        : null;
    if (!screenshot)
        throw apiErrors.notFound('Screenshot not found.');
    return screenshot;
}

export async function replaceProjectScreenshot(project: DbProject, actor: ProjectActor, id: string,
    input: { screenshot: ParsedScreenshot; expectedRevision: string | null }) {
    assertWriter(actor);
    return replaceSavedScreenshot(getCommentsStore(), projectPartition(project.id), id, input, comment => {
        visibleOrThrow(comment, actor);
        if (!canEditComment(comment, actor)) throw apiErrors.forbidden('Only the author or an admin can replace this screenshot.');
    }, (previous, updated) => withSyncMark(project, previous, updated));
}

/**
 * Rewrite suggestions call a paid AI model: limited per reviewer and per project in the project's
 * partition, and per IP and in total across the app (the same counters as `POST /api/rewrite`)
 */
export async function enforceProjectRewriteLimits(request: Request, project: DbProject, actor: ProjectActor) {
    await enforceRewriteLimits(getCommentsStore(), { domain: projectPartition(project.id), authorId: actorAuthorId(actor), ipBucket: rateLimitIpBucket(request) });
}

export async function replyToProjectComment(request: Request, project: DbProject, actor: ProjectActor, id: string, input: { text: string; authorName?: string; mentions?: DbMention[]; idempotencyKey?: string }) {
    const authorId = actorAuthorId(actor);
    if (!authorId)
        throw apiErrors.invalidRequest('Comments need a visitor id.');

    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    const attempt = submission(partition, authorId, input.idempotencyKey, {
        operation: 'reply', id, text: input.text, mentions: input.mentions ?? [], authorName: actor.kind === 'guest' ? input.authorName : undefined
    });
    const recovered = await recoverSubmission(store, attempt);
    if (recovered) return visibleOrThrow(recovered, actor);
    const stored = await getStoredComment(store, partition, id);
    if (!stored)
        throw apiErrors.notFound();
    visibleOrThrow(stored.comment, actor);

    await enforceReplyLimits(store, commentRateLimitSubject(request, project, actor, authorId));

    const now = nowIso();
    const itemId = `item_${nanoid()}`;
    if (attempt) return await commitReplySubmission(store, attempt, id, {
        id: itemId, text: input.text, authorId,
        ...(actor.kind === 'member' && actor.agent ? { agent: actor.agent } : {}),
        authorName: actor.kind === 'guest' ? input.authorName : undefined,
        mentions: input.mentions, createdAt: now
    }, comment => visibleOrThrow(comment, actor), async (previous, updated) => {
        const mentions = await validateMentions(project, actor, previous, input.text, input.mentions);
        return withSyncMark(project, previous, withNotificationEvent(updated, authorId, 'reply', now, mentionRecipients(mentions), actor.kind === 'member' ? actor.agent : undefined, { itemId }));
    });
    return await updateComment(store, partition, id, async comment => {
        visibleOrThrow(comment, actor);
        const items = threadItems(comment);
        if (items.length >= MAX_THREAD_ITEMS)
            throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);
        const mentions = await validateMentions(project, actor, comment, input.text, input.mentions);
        const updated = { ...withThreadActivity(comment, authorId), updatedAt: now, thread: { ...comment.thread, items: [...items, {
            id: itemId, text: input.text, authorId,
            authorName: actor.kind === 'guest' ? input.authorName : undefined,
            mentions, createdAt: now
        }] } };
        return withSyncMark(project, comment, withNotificationEvent(updated, authorId, 'reply', now, mentionRecipients(mentions), actor.kind === 'member' ? actor.agent : undefined, { itemId }));
    });
}

/** Applies a change to a comment the actor can see, after `allowed` says the actor may make it */
async function changeComment(project: DbProject, actor: ProjectActor, id: string, allowed: (comment: DbComment) => boolean, change: (comment: DbComment) => DbComment | Promise<DbComment>, attempt?: Submission) {
    const authorize = (comment: DbComment) => {
        visibleOrThrow(comment, actor);
        if (!allowed(comment))
            throw apiErrors.forbidden('You can\'t change this comment.');
    };
    const apply = async (comment: DbComment) => {
        authorize(comment);
        const changed = await change(comment);
        return changed === comment ? comment : withSyncMark(project, comment, { ...changed, updatedAt: nowIso() });
    };
    if (attempt) return commitChangeSubmission(getCommentsStore(), attempt, id, authorize, apply);
    return await updateComment(getCommentsStore(), projectPartition(project.id), id, apply);
}

export async function setProjectCommentResolved(project: DbProject, actor: ProjectActor, id: string, resolved: boolean, idempotencyKey?: string) {
    resolved = z.boolean().parse(resolved);
    return await changeComment(project, actor, id,
        comment => canResolveComment(comment, actor),
        comment => Boolean(comment.resolved) === resolved ? comment : withNotificationEvent(
            { ...withThreadActivity(comment, actorAuthorId(actor)!), resolved }, actorAuthorId(actor)!, resolved ? 'resolved' : 'reopened', nowIso(), undefined, actor.kind === 'member' ? actor.agent : undefined),
        submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'status', id, resolved }));
}

export async function setProjectCommentPrivate(project: DbProject, actor: ProjectActor, id: string, isPrivate: boolean) {
    isPrivate = z.boolean().parse(isPrivate);
    return await changeComment(project, actor, id,
        () => canMakeCommentPrivate(actor),
        async comment => {
            if (Boolean(comment.private) === isPrivate) return comment;
            const updated = { ...comment, private: isPrivate };
            if (updated.assigneeId) {
                const recipient = await memberActor(project, updated.assigneeId);
                if (!recipient || !canSeeComment(updated, recipient)) delete updated.assigneeId;
            }
            return updated;
        });
}

/** One assignment service for the app and toolbar; access is always checked here. */
export async function setProjectCommentAssignee(project: DbProject, actor: ProjectActor, id: string, assigneeId: string | null, idempotencyKey?: string) {
    const parsed = userIdSchema.nullable().safeParse(assigneeId);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose a valid user id.');
    assigneeId = parsed.data;
    return await changeComment(project, actor, id,
        () => actor.kind === 'member',
        async (comment) => {
            await assertParticipantEditor(project, actor, comment);
            if (assigneeId) await assertEligibleParticipant(project, comment, assigneeId);
            if ((comment.assigneeId ?? null) === assigneeId) return comment;
            const updated = { ...withThreadActivity(comment, actorAuthorId(actor)!), assigneeId: assigneeId ?? undefined };
            if (!assigneeId) delete updated.assigneeId;
            const recipients = [...new Set([comment.assigneeId, assigneeId].filter((id): id is string => Boolean(id)).map(id => `user:${id}`))];
            return withNotificationEvent(updated, actorAuthorId(actor)!, 'assignment', nowIso(), recipients, actor.kind === 'member' ? actor.agent : undefined, { assigneeId });
        }, submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'assignment', id, assigneeId }));
}

/** Edits the text of the comment (its first item) */
export async function editProjectCommentText(project: DbProject, actor: ProjectActor, id: string, text: string) {
    return await changeComment(project, actor, id,
        comment => canEditComment(comment, actor) && !threadItems(comment)[0]?.deletedAt,
        (comment) => {
            const [first, ...replies] = threadItems(comment);
            if (!first)
                throw apiErrors.notFound();
            if (first.text === text) return comment;
            return { ...comment, thread: { ...comment.thread, items: [{ ...first, text, mentions: moveMentions(first.text, text, first.mentions ?? []), editedAt: nowIso() }, ...replies] } };
        });
}

/** The toolbar edits one message, retaining the thread's author, anchor, image and context. */
export async function editProjectCommentItem(project: DbProject, actor: ProjectActor, id: string, itemId: string, input: EditThreadItemInput & { mentions?: DbMention[] }) {
    return await changeComment(project, actor, id, () => true,
        async comment => {
            const edited = withEditedThreadItem(comment, itemId, input, item => canEditItem(item, actor));
            const previous = comment.thread.items.find(item => item.id === itemId);
            const mentions = await validateMentions(project, actor, comment, input.text, input.mentions, previous);
            const updated = { ...edited, thread: { ...edited.thread, items: edited.thread.items.map(item => item.id === itemId ? { ...item, mentions } : item) } };
            const existing = new Set(previous?.mentions?.map(mention => mention.userId));
            const recipients = mentionRecipients(mentions.filter(mention => !existing.has(mention.userId)));
            return recipients.length ? withNotificationEvent(withThreadActivity(updated, actorAuthorId(actor)!), actorAuthorId(actor)!, 'mention', nowIso(), recipients, actor.kind === 'member' ? actor.agent : undefined, { itemId }) : updated;
        });
}

function deleteProjectThread(store: CommentsStore, project: DbProject, comment: DbComment, etag: string) {
    return project.id !== PUBLIC_PROJECT_ID
        ? store.deleteWithTombstone(comment.domain, comment.id, etag, syncTombstone(project, comment))
        : store.delete(comment.domain, comment.id, etag);
}

/** Deletes the whole thread (the app: the author or an admin) */
export async function removeProjectComment(project: DbProject, actor: ProjectActor, id: string) {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    let hadScreenshot = false;
    await updateComment(store, partition, id, (comment) => {
        visibleOrThrow(comment, actor);
        if (!canDeleteComment(comment, actor))
            throw apiErrors.forbidden('Only the author or an admin can delete this comment.');
        hadScreenshot = Boolean(comment.screenshot);
        return null;
    }, (comment, etag) => deleteProjectThread(store, project, comment, etag));
    await forgetScreenshot(store, partition, id, hadScreenshot, null);
}

/**
 * Deletes a thread item, the way the toolbar does. The first item: an admin deletes the whole
 * thread; its author deletes it with their own replies, or, when others replied, leaves a
 * "Comment deleted" placeholder so the replies stay. A reply: its author or an admin; the last
 * reply under a placeholder takes the thread with it. Returns the comment that stays, or `null`.
 */
export async function deleteProjectCommentItem(project: DbProject, actor: ProjectActor, id: string, itemId: string) {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    let hadScreenshot = false;
    const updated = await updateComment(store, partition, id, (comment): DbComment | null => {
        visibleOrThrow(comment, actor);
        hadScreenshot = Boolean(comment.screenshot);
        const items = threadItems(comment);
        const index = items.findIndex(item => item.id === itemId);
        const item = items[index];
        if (!item)
            throw apiErrors.notFound('Reply not found.');
        if (!canDeleteItem(item, actor))
            throw apiErrors.forbidden('Only the author or an admin can delete this.');

        const now = nowIso();
        if (index === 0) {
            const replies = items.slice(1);
            if (isAdmin(actor) || replies.every(reply => reply.authorId === comment.authorId))
                return null;

            const placeholder: DbThreadItem = { id: item.id, text: '', deletedAt: now };
            if (item.createdAt)
                placeholder.createdAt = item.createdAt;
            const kept: DbComment = { ...comment, thread: { ...comment.thread, items: [placeholder, ...replies] }, updatedAt: now };
            delete kept.authorId;
            delete kept.device;
            delete kept.screenshot;
            return withSyncMark(project, comment, kept);
        }

        const remaining = items.filter(other => other !== item);
        if (remaining.every(other => typeof other.deletedAt === 'string'))
            return null;
        return withSyncMark(project, comment, { ...comment, thread: { ...comment.thread, items: remaining }, updatedAt: now });
    }, (comment, etag) => deleteProjectThread(store, project, comment, etag));
    await forgetScreenshot(store, partition, id, hadScreenshot, updated);
    return updated;
}

export async function reattachProjectAnchor(project: DbProject, actor: ProjectActor, id: string, origin: string, input: ReattachAnchorInput) {
    assertWriter(actor);
    if (!projectOrigins(project).includes(origin)) throw apiErrors.forbidden('Open the reviewed page to change its anchor.');
    return reattachAnchor(getCommentsStore(), projectPartition(project.id), id, input, comment => {
        visibleOrThrow(comment, actor);
        if (!canEditComment(comment, actor)) throw apiErrors.forbidden();
        if (comment.origin !== origin) throw apiErrors.forbidden('Choose a target on the original reviewed site.');
    }, (previous, updated) => withSyncMark(project, previous, updated));
}
