import { nanoid } from 'nanoid';
import { withEditedThreadItem } from '../comments/editing';
import type { EditThreadItemInput } from '../comments/validation';
import type { DbComment, DbCommentDevice, DbThreadItem } from '../db/schema';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { apiErrors } from '../comments/http';
import { MAX_THREAD_ITEMS } from '../comments/limits';
import { enforceNewCommentLimits, enforceReplyLimits, enforceRewriteLimits } from '../comments/rateLimits';
import { availableScreenshot, commentTtlSeconds, createWithScreenshot, forgetScreenshot, screenshotInfo } from '../comments/service';
import { PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { ipRateLimitBucket, isLoopbackIp, resolveClientIp } from '../comments/visitor';
import { isLocalRuntime } from '../comments/environment';
import { isValidId, type CreateCommentInput } from '../comments/validation';
import type { DbProject } from '../app/model';
import { actorAuthorId, type ProjectActor } from './actor';

/** Most comments the app loads for a project (all pages) */
export const MAX_PROJECT_COMMENTS = 1000;
const MAX_UPDATE_ATTEMPTS = 8;

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

export function canSeeComment(comment: DbComment, actor: ProjectActor) {
    return !comment.private || isAdmin(actor) || isAuthor(comment.authorId, actor);
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
    update: (comment: DbComment) => T
): Promise<T> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await getStoredComment(store, partition, id);
        if (!stored)
            throw apiErrors.notFound();

        const updated = update(stored.comment);
        const result = updated
            ? await store.replace(updated, stored.etag)
            : await store.delete(partition, id, stored.etag);
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
export async function listProjectComments(project: DbProject, actor: ProjectActor, path?: string) {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    const comments = path === undefined
        ? await store.listAll(partition, MAX_PROJECT_COMMENTS)
        : await store.list(partition, path, MAX_PROJECT_COMMENTS);
    return comments.filter(comment => canSeeComment(comment, actor));
}

export async function getProjectComment(project: DbProject, actor: ProjectActor, id: string) {
    const stored = await getStoredComment(getCommentsStore(), projectPartition(project.id), id);
    return stored ? visibleOrThrow(stored.comment, actor) : null;
}

export type NewProjectComment = CreateCommentInput & {
    /** Origin of the site it was left on (one of the project's addresses) */
    origin: string;
    /** Guests: the name they gave */
    authorName?: string;
};

export async function createProjectComment(request: Request, project: DbProject, actor: ProjectActor, input: NewProjectComment) {
    const authorId = actorAuthorId(actor);
    if (!authorId)
        throw apiErrors.invalidRequest('Comments need a visitor id.');

    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    await enforceNewCommentLimits(store, { domain: partition, authorId, ipBucket: rateLimitIpBucket(request) }, input.path);
    const screenshot = await availableScreenshot(store, partition, input.screenshot);

    const now = nowIso();
    const authorName = actor.kind === 'guest' ? input.authorName : undefined;
    const comment: DbComment = {
        id: `comment_${nanoid()}`,
        domain: partition,
        projectId: project.id,
        ...(project.id === PUBLIC_PROJECT_ID ? { ttl: commentTtlSeconds() } : {}),
        origin: input.origin,
        path: input.path,
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
        createdAt: now,
        updatedAt: now
    };
    if (screenshot)
        comment.screenshot = screenshotInfo(screenshot);
    await createWithScreenshot(store, comment, screenshot);
    return comment;
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

/**
 * Rewrite suggestions call a paid AI model: limited per reviewer and per project in the project's
 * partition, and per IP and in total across the app (the same counters as `POST /api/rewrite`)
 */
export async function enforceProjectRewriteLimits(request: Request, project: DbProject, actor: ProjectActor) {
    await enforceRewriteLimits(getCommentsStore(), { domain: projectPartition(project.id), authorId: actorAuthorId(actor), ipBucket: rateLimitIpBucket(request) });
}

export async function replyToProjectComment(request: Request, project: DbProject, actor: ProjectActor, id: string, input: { text: string; authorName?: string }) {
    const authorId = actorAuthorId(actor);
    if (!authorId)
        throw apiErrors.invalidRequest('Comments need a visitor id.');

    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    const stored = await getStoredComment(store, partition, id);
    if (!stored)
        throw apiErrors.notFound();
    visibleOrThrow(stored.comment, actor);

    await enforceReplyLimits(store, { domain: partition, authorId, ipBucket: rateLimitIpBucket(request) });

    const now = nowIso();
    const result = await store.appendThreadItem(partition, id, {
        id: `item_${nanoid()}`,
        text: input.text,
        authorId,
        authorName: actor.kind === 'guest' ? input.authorName : undefined,
        createdAt: now
    }, MAX_THREAD_ITEMS, now);
    if (result === 'not_found')
        throw apiErrors.notFound();
    if (result === 'full')
        throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);

    const updated = await store.get(partition, id);
    if (!updated)
        throw apiErrors.notFound();
    return updated.comment;
}

/** Applies a change to a comment the actor can see, after `allowed` says the actor may make it */
async function changeComment(project: DbProject, actor: ProjectActor, id: string, allowed: (comment: DbComment) => boolean, change: (comment: DbComment) => DbComment) {
    return await updateComment(getCommentsStore(), projectPartition(project.id), id, comment => {
        visibleOrThrow(comment, actor);
        if (!allowed(comment))
            throw apiErrors.forbidden('You can\'t change this comment.');
        return { ...change(comment), updatedAt: nowIso() };
    });
}

export async function setProjectCommentResolved(project: DbProject, actor: ProjectActor, id: string, resolved: boolean) {
    return await changeComment(project, actor, id,
        comment => canResolveComment(comment, actor),
        comment => ({ ...comment, resolved }));
}

export async function setProjectCommentPrivate(project: DbProject, actor: ProjectActor, id: string, isPrivate: boolean) {
    return await changeComment(project, actor, id,
        () => canMakeCommentPrivate(actor),
        comment => ({ ...comment, private: isPrivate }));
}

/** Assigns the comment to a member (`assigneeId` is a user id the caller checked) or nobody */
export async function setProjectCommentAssignee(project: DbProject, actor: ProjectActor, id: string, assigneeId: string | null) {
    return await changeComment(project, actor, id,
        () => actor.kind === 'member',
        (comment) => {
            const updated = { ...comment, assigneeId: assigneeId ?? undefined };
            if (!assigneeId)
                delete updated.assigneeId;
            return updated;
        });
}

/** Edits the text of the comment (its first item) */
export async function editProjectCommentText(project: DbProject, actor: ProjectActor, id: string, text: string) {
    return await changeComment(project, actor, id,
        comment => canEditComment(comment, actor) && !threadItems(comment)[0]?.deletedAt,
        (comment) => {
            const [first, ...replies] = threadItems(comment);
            if (!first)
                throw apiErrors.notFound();
            return { ...comment, thread: { ...comment.thread, items: [{ ...first, text, editedAt: nowIso() }, ...replies] } };
        });
}

/** The toolbar edits one message, retaining the thread's author, anchor, image and context. */
export async function editProjectCommentItem(project: DbProject, actor: ProjectActor, id: string, itemId: string, input: EditThreadItemInput) {
    return await changeComment(project, actor, id, () => true,
        comment => withEditedThreadItem(comment, itemId, input, item => canEditItem(item, actor)));
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
    });
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
            return kept;
        }

        const remaining = items.filter(other => other !== item);
        if (remaining.every(other => typeof other.deletedAt === 'string'))
            return null;
        return { ...comment, thread: { ...comment.thread, items: remaining }, updatedAt: now };
    });
    await forgetScreenshot(store, partition, id, hadScreenshot, updated);
    return updated;
}
