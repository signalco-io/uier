import { feedbackTypeForSubmission } from '../app/feedbackTypes';
import { ordinaryVerificationStatus, withOrdinaryStage } from '../comments/verificationState';
import { withThreadHistory } from '../comments/history';
import { feedbackStage, feedbackStatusTargets, type FeedbackStatusTarget } from '@uier/toolbar/verification';
import { commentPriority, priorities, type CommentPriority } from '@uier/toolbar/triage';
import { commentRevision } from './commentRevision';
import { queueThreadCleanup } from '../comments/cleanup';
import { syncTombstone, withSyncMark } from '../integrations/syncSignal';
import { z } from 'zod';
import { userIdSchema } from '../app/validation';
import { reattachAnchor } from '../comments/reattachAnchor';
import { idempotencyKeySchema, type ReattachAnchorInput } from '../comments/validation';
import { projectOrigins } from '../app/projects';

import type { ArchiveFilter } from '../repo/archiveFilter';
import type { OriginFilter } from '../repo/originFilter';
import type { VisibilityFilter } from '../repo/visibilityFilter';
import { threadActivity, withThreadActivity } from '../comments/activity';
import { nanoid } from 'nanoid';
import { moveMentions } from '@uier/toolbar/mentions';
import { withNotificationEvent } from '../notifications/events';
import { commitChangeSubmission, commitNewSubmission, commitReplySubmission, recoverSubmission, submission, type Submission } from '../comments/submissions';
import { withEditedThreadItem } from '../comments/editing';
import type { EditThreadItemInput } from '../comments/validation';
import type { DbComment, DbCommentDevice, DbThreadItem, DbMention } from '../db/schema';
import { messageAgentClaimSchema, messageAgentFor, type MessageAgentClaim } from './messageAgent';
import { getCommentsStore, type CommentsStore, type ConditionalWriteResult } from '../repo/commentsStore';
import { apiErrors } from '../comments/http';
import { MAX_THREAD_ITEMS } from '../comments/limits';
import { enforceNewCommentLimits, enforceReplyLimits, enforceRewriteLimits, rateLimitIpBucket, usageLinks, type RateLimitSubject } from '../comments/rateLimits';
import { availableScreenshot, commentTtlSeconds, createWithScreenshot, forgetScreenshot, screenshotDocument, screenshotInfo } from '../comments/service';
import { KnownPages } from '../../knownPages';
import { isPrivateAppFeedback, isUierFeedbackProject, PUBLIC_PROJECT_PARTITION, USER_FEEDBACK_PROJECT_ID } from '../comments/publicProject';
import { isValidId, type CreateCommentInput } from '../comments/validation';
import type { DbProject } from '../app/model';
import { actorAuthorId, memberActor, refreshMutationActor, assertWriter, type ProjectActor } from './actor';
import { assertEligibleParticipant, assertParticipantEditor, validateMentions } from './participants';
import { replaceSavedScreenshot } from '../comments/replaceScreenshot';
import type { ParsedScreenshot } from '../comments/screenshot';
import { queueMcpEventDelivery } from '../mcp/events/trigger';
import { queueAiTitles } from '../titles/threadTitles';
import { cleanManualTitle, MANUAL_TITLE_MAX_LENGTH } from '../titles/model';
import { assignedAgents, assignedUserIds, assigneeIdsSchema, assignmentModeSchema, withAssignments, type AssignmentMode } from './assignments';

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

/** `canSeeComment` as a storage filter for the partition, for aggregates that never load threads (`undefined`: all) */
export function commentVisibilityFilter(domain: string, actor: ProjectActor): VisibilityFilter | undefined {
    if (isAdmin(actor)) return undefined;
    return { authorId: actorAuthorId(actor), privatePath: domain === PUBLIC_PROJECT_PARTITION ? KnownPages.App : undefined };
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
    return !item.integrationSource && !item.deletedAt && (isAdmin(actor) || isAuthor(item.authorId, actor));
}

export function canEditItem(item: DbThreadItem, actor: ProjectActor) {
    return !item.integrationSource && !item.deletedAt && (isAdmin(actor) || isAuthor(item.authorId, actor));
}

export function canMakeCommentPrivate(actor: ProjectActor) {
    return isAdmin(actor);
}

/** Actors come from resolveActor/memberActor or mcpProject, which recheck current access. */
function commentRateLimitSubject(request: Request, project: DbProject, actor: ProjectActor, authorId: string): RateLimitSubject {
    return {
        domain: projectPartition(project.id), authorId, ipBucket: rateLimitIpBucket(request),
        // Anyone can join the public feedback project; enrollment raises only its new comments.
        member: actor.kind === 'member' && (!isUierFeedbackProject(project.id) || actor.isAdmin),
        publicAccount: actor.kind === 'member' && isUierFeedbackProject(project.id) && !actor.isAdmin,
        credentialId: actor.kind === 'member' ? actor.agent?.credentialId : undefined,
        usage: usageLinks(project, actor)
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
    project: DbProject,
    actor: ProjectActor,
    id: string,
    update: (comment: DbComment) => T | Promise<T>,
    onDelete?: (comment: DbComment, etag: string) => Promise<ConditionalWriteResult>
): Promise<T> {
    const partition = projectPartition(project.id);
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await getStoredComment(store, partition, id);
        if (!stored)
            throw apiErrors.notFound();

        await refreshMutationActor(project, actor);
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
export async function listProjectComments(project: DbProject, actor: ProjectActor, path?: string, originFilter?: OriginFilter, authorId?: string, onWindow?: (capped: boolean) => void, archive: ArchiveFilter = 'all') {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    if (authorId !== undefined && !isAdmin(actor))
        throw apiErrors.forbidden('Only admins can filter by author.');
    const comments = path === undefined
        ? await store.listAll(partition, MAX_PROJECT_COMMENTS, originFilter, authorId, archive)
        : await store.list(partition, path, MAX_PROJECT_COMMENTS, originFilter, authorId, archive);
    onWindow?.(comments.length >= MAX_PROJECT_COMMENTS);
    return comments.filter(comment => canSeeComment(comment, actor));
}

export async function getProjectComment(project: DbProject, actor: ProjectActor, id: string) {
    const stored = await getStoredComment(getCommentsStore(), projectPartition(project.id), id);
    return stored ? visibleOrThrow(stored.comment, actor) : null;
}

export type NewProjectComment = CreateCommentInput & {
    pageStateVersion?: 1;
    /** Unapproved query field names seen on the page (no values), for the page state suggestions */
    queryKeys?: string[];
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
    const feedbackType = await feedbackTypeForSubmission(project, input.kind);
    await enforceNewCommentLimits(store, commentRateLimitSubject(request, project, actor, authorId), input.path);
    const screenshot = await availableScreenshot(store, partition, input.screenshot);

    const now = nowIso();
    const authorName = actor.kind === 'guest' ? input.authorName : undefined;
    const comment: DbComment = {
        id: `comment_${nanoid()}`,
        domain: partition,
        projectId: project.id,
        ...(isUierFeedbackProject(project.id) ? { ttl: commentTtlSeconds() } : {}),
        // An account's feedback on uier is between them and uier's staff
        ...(isPrivateAppFeedback({ domain: partition, path: input.path }) || project.id === USER_FEEDBACK_PROJECT_ID ? { private: true } : {}),
        origin: input.origin,
        path: input.path,
        ...(input.pageStateVersion === 1 ? { pageStateVersion: 1 as const } : {}),
        ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
        ...(input.queryKeys?.length && !isUierFeedbackProject(project.id) ? { queryKeys: input.queryKeys } : {}),
        position: input.position,
        number: await store.nextCommentNumber(partition),
        kind: input.kind,
        ...(feedbackType ? { feedbackType } : {}),
        ...(input.check ? { check: input.check } : {}),
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
    await refreshMutationActor(project, actor);
    if (attempt) {
        const saved = await commitNewSubmission(store, attempt, recorded, screenshot ? screenshotDocument(recorded, screenshot) : undefined);
        queueMcpEventDelivery(project.id);
        queueAiTitles(project, [saved], 'new');
        return visibleOrThrow(saved, actor);
    }
    await createWithScreenshot(store, recorded, screenshot);
    queueMcpEventDelivery(project.id);
    queueAiTitles(project, [recorded], 'new');
    return recorded;
}

/** The screenshot of a comment the actor can see */
export async function getProjectScreenshot(project: DbProject, actor: ProjectActor, id: string, itemId?: string) {
    const comment = await getProjectComment(project, actor, id);
    const hasImage = itemId ? comment?.thread.items.some(item => item.id === itemId && !item.deletedAt && item.screenshot) : comment?.screenshot;
    const screenshot = hasImage
        ? await getCommentsStore().getScreenshot(projectPartition(project.id), id, itemId)
        : null;
    if (!screenshot)
        throw apiErrors.notFound('Screenshot not found.');
    return screenshot;
}

export async function replaceProjectScreenshot(project: DbProject, actor: ProjectActor, id: string,
    input: { screenshot: ParsedScreenshot; expectedRevision: string | null }) {
    assertWriter(actor);
    return replaceSavedScreenshot(getCommentsStore(), projectPartition(project.id), id, { ...input, usage: usageLinks(project, actor) }, async comment => {
        await refreshMutationActor(project, actor);
        visibleOrThrow(comment, actor);
        if (!canEditComment(comment, actor)) throw apiErrors.forbidden('Only the author or an admin can replace this screenshot.');
    }, (previous, updated) => withSyncMark(project, previous, updated));
}

/**
 * Rewrite suggestions call a paid AI model: limited per reviewer and per project in the project's
 * partition, and per IP and in total across the app (the same counters as `POST /api/rewrite`)
 */
export async function enforceProjectRewriteLimits(request: Request, project: DbProject, actor: ProjectActor) {
    await enforceRewriteLimits(getCommentsStore(), { domain: projectPartition(project.id), authorId: actorAuthorId(actor), ipBucket: rateLimitIpBucket(request), usage: usageLinks(project, actor) });
}

function parseClaim(claim: MessageAgentClaim) {
    const parsed = messageAgentClaimSchema.safeParse(claim);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw apiErrors.invalidRequest(issue && ['model', 'reasoning'].includes(String(issue.path[0])) ? issue.message : 'Choose a valid agent.');
    }
    return parsed.data;
}

/**
 * `writtenBy`: what an MCP connection says about the agent writing the reply. It marks the message only
 * for an MCP actor (one with a connector), and only as `messageAgentFor` decides from the stored thread.
 */
export type ReplyInput = { screenshot?: ParsedScreenshot; text: string; authorName?: string; mentions?: DbMention[]; idempotencyKey?: string; writtenBy?: MessageAgentClaim };

export async function replyToProjectComment(request: Request, project: DbProject, actor: ProjectActor, id: string, input: ReplyInput) {
    const saved = await appendProjectReply(request, project, actor, id, input);
    queueMcpEventDelivery(project.id);
    queueAiTitles(project, [saved], 'change');
    return saved;
}

async function appendProjectReply(request: Request, project: DbProject, actor: ProjectActor, id: string, input: ReplyInput) {
    await refreshMutationActor(project, actor, true);
    const authorId = actorAuthorId(actor);
    if (!authorId)
        throw apiErrors.invalidRequest('Comments need a visitor id.');
    // Only a coding tool connection writes for its owner; the app and the toolbar never mark a message
    const claim = actor.kind === 'member' && actor.agent && input.writtenBy ? parseClaim(input.writtenBy) : undefined;
    const writtenBy = (comment: DbComment) => claim && actor.kind === 'member' ? { writtenBy: messageAgentFor(comment, actor.userId, claim, actor.agent?.credentialId) } : {};

    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    const attempt = submission(partition, authorId, input.idempotencyKey ?? (input.screenshot ? nanoid() : undefined), {
        ...(input.screenshot ? { image: input.screenshot.data.toString('base64') } : {}),
        operation: 'reply', id, text: input.text, mentions: input.mentions ?? [], authorName: actor.kind === 'guest' ? input.authorName : undefined
    });
    const recovered = await recoverSubmission(store, attempt);
    if (recovered) return visibleOrThrow(recovered, actor);
    const stored = await getStoredComment(store, partition, id);
    if (!stored)
        throw apiErrors.notFound();
    visibleOrThrow(stored.comment, actor);

    await enforceReplyLimits(store, commentRateLimitSubject(request, project, actor, authorId));
    const screenshot = await availableScreenshot(store, partition, input.screenshot);

    const now = nowIso();
    const itemId = `item_${nanoid()}`;
    if (attempt) return await commitReplySubmission(store, attempt, id, comment => ({
        id: itemId, text: input.text, authorId,
        ...(screenshot ? { screenshot: screenshotInfo(screenshot) } : {}),
        ...(actor.kind === 'member' && actor.agent ? { agent: actor.agent } : {}),
        ...writtenBy(comment),
        authorName: actor.kind === 'guest' ? input.authorName : undefined,
        mentions: input.mentions, createdAt: now
    }), async comment => { await refreshMutationActor(project, actor, true); return visibleOrThrow(comment, actor); }, async (previous, updated) => {
        const mentions = await validateMentions(project, actor, previous, input.text, input.mentions);
        return withSyncMark(project, previous, withNotificationEvent(updated, authorId, 'reply', now, mentionRecipients(mentions), actor.kind === 'member' ? actor.agent : undefined, { itemId }));
    }, screenshot ? comment => screenshotDocument(comment, screenshot, itemId) : undefined);
    return await updateComment(store, project, actor, id, async comment => {
        await refreshMutationActor(project, actor, true);
        visibleOrThrow(comment, actor);
        const items = threadItems(comment);
        if (items.length >= MAX_THREAD_ITEMS)
            throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);
        const mentions = await validateMentions(project, actor, comment, input.text, input.mentions);
        const updated = { ...withThreadActivity(comment, authorId, actor.kind === 'member' && Boolean(actor.agent)), updatedAt: now, thread: { ...comment.thread, items: [...items, {
            id: itemId, text: input.text, authorId,
            ...(actor.kind === 'member' && actor.agent ? { agent: actor.agent } : {}),
            ...writtenBy(comment),
            authorName: actor.kind === 'guest' ? input.authorName : undefined,
            mentions, createdAt: now
        }] } };
        return withSyncMark(project, comment, withNotificationEvent(updated, authorId, 'reply', now, mentionRecipients(mentions), actor.kind === 'member' ? actor.agent : undefined, { itemId }));
    });
}

/** Applies a change to a comment the actor can see, after `allowed` says the actor may make it */
export async function changeComment(project: DbProject, actor: ProjectActor, id: string, allowed: (comment: DbComment) => boolean, change: (comment: DbComment) => DbComment | Promise<DbComment>, attempt?: Submission, guard?: CommentChangeGuard, store: CommentsStore = getCommentsStore(), options: { ephemeral?: boolean } = {}) {
    const authorize = async (comment: DbComment) => {
        await refreshMutationActor(project, actor, guard?.requireComments);
        visibleOrThrow(comment, actor);
        if (guard?.triage && !canTriageProject(project, actor)) throw apiErrors.notFound();
        if (!allowed(comment))
            throw apiErrors.forbidden('You can\'t change this comment.');
    };
    const apply = async (comment: DbComment) => {
        await authorize(comment);
        if (guard?.revision && commentRevision(comment) !== guard.revision) throw apiErrors.conflict();
        if (guard && guard.value(comment) !== guard.expected) throw apiErrors.conflict();
        const changed = await change(comment);
        guard?.onResult?.(changed !== comment);
        // Presence changes only the etag: no unread step, content timestamp, integration or title work.
        if (options.ephemeral) return changed;
        return changed === comment ? comment : withSyncMark(project, comment, { ...withThreadHistory(comment, changed, actorAuthorId(actor)!), updatedAt: nowIso() });
    };
    const saved = attempt ? await commitChangeSubmission(store, attempt, id, authorize, apply, guard?.onResult)
        : await updateComment(store, project, actor, id, apply);
    if (options.ephemeral) return saved;
    queueMcpEventDelivery(project.id);
    // A new first message (an edit) gets a new title; a thread made before titles gets its first one
    queueAiTitles(project, [saved], 'change');
    return saved;
}

/** Preconditions run inside every conditional-write attempt, after current authorization. Receipt replay skips them. */
export type CommentChangeGuard = {
    expected: string | boolean | null;
    value: (comment: DbComment) => string | boolean | null;
    revision?: string;
    onResult?: (changed: boolean) => void;
    triage?: boolean;
    requireComments?: boolean;
};
function guardFingerprint(guard?: CommentChangeGuard) {
    return guard ? { expected: guard.expected, revision: guard.revision } : {};
}
export function canTriageProject(project: Pick<DbProject, 'id'>, actor: ProjectActor) {
    return actor.kind === 'member' && (!isUierFeedbackProject(project.id) || actor.isAdmin);
}
/** Priority shares activity and integration intent, but deliberately creates no email notification. */
export async function setProjectCommentPriority(project: DbProject, actor: ProjectActor, id: string, priority: CommentPriority, idempotencyKey: string, guard?: CommentChangeGuard, store?: CommentsStore) {
    const parsed = z.enum(priorities).safeParse(priority);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose a valid priority.');
    priority = parsed.data;
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success) throw apiErrors.invalidRequest('Use a valid submission key.');
    return changeComment(project, actor, id, () => canTriageProject(project, actor), comment =>
        commentPriority(comment.priority) === priority ? comment : { ...withThreadActivity(comment, actorAuthorId(actor)!, actor.kind === 'member' && Boolean(actor.agent)), priority },
        submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'priority', id, priority, ...guardFingerprint(guard) }), guard, store);
}

/** Status changes are own activity, including MCP; connection attribution stays on events. */
export async function setProjectCommentResolved(project: DbProject, actor: ProjectActor, id: string, resolved: boolean, idempotencyKey?: string, guard?: CommentChangeGuard, store?: CommentsStore) {
    resolved = z.boolean().parse(resolved);
    return await changeComment(project, actor, id,
        comment => canResolveComment(comment, actor),
        comment => Boolean(comment.resolved) === resolved && !(!resolved && comment.verification?.outcome === 'pending') ? comment : withNotificationEvent(
            { ...ordinaryVerificationStatus(withThreadActivity(comment, actorAuthorId(actor)!), resolved, true) }, actorAuthorId(actor)!, resolved ? 'resolved' : 'reopened', nowIso(), undefined, actor.kind === 'member' ? actor.agent : undefined),
        submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'status', id, resolved, ...guardFingerprint(guard) }), guard, store);
}

/**
 * Open, In progress or Done, with the resolve permission (members, and a guest on their own thread).
 * `resolved` writes keep their meaning: `false` reopens a Done thread to Open and leaves In progress as
 * it is; this sets the stage itself. Leaving Ready to verify ends the check without confirmation.
 */
export async function setProjectCommentStatus(project: DbProject, actor: ProjectActor, id: string, status: FeedbackStatusTarget, idempotencyKey?: string, guard?: CommentChangeGuard, store?: CommentsStore) {
    const parsed = z.enum(feedbackStatusTargets).safeParse(status);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose Open, In progress or Done.');
    status = parsed.data;
    return await changeComment(project, actor, id,
        comment => canResolveComment(comment, actor),
        comment => {
            const from = feedbackStage(comment);
            if (from === status) return comment;
            const actorId = actorAuthorId(actor)!;
            const kind = status === 'done' ? 'resolved' : status === 'in-progress' ? 'progress-started' : from === 'in-progress' ? 'progress-stopped' : 'reopened';
            return withNotificationEvent(withOrdinaryStage(withThreadActivity(comment, actorId), status), actorId, kind, nowIso(), undefined, actor.kind === 'member' ? actor.agent : undefined);
        },
        submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'status', id, status, ...guardFingerprint(guard) }), guard, store);
}

/** Archiving uses the existing status authority and never changes the workflow or read cursors. */
export async function setProjectCommentArchived(project: DbProject, actor: ProjectActor, id: string, archived: boolean, idempotencyKey?: string, store?: CommentsStore) {
    archived = z.boolean().parse(archived);
    return changeComment(project, actor, id, comment => canResolveComment(comment, actor), comment =>
        Boolean(comment.archivedAt) === archived ? comment : withNotificationEvent({
            ...withThreadActivity(comment, actorAuthorId(actor)!), archivedAt: archived ? nowIso() : undefined
        }, actorAuthorId(actor)!, archived ? 'archived' : 'restored', nowIso(), undefined, actor.kind === 'member' ? actor.agent : undefined), submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'archive', id, archived }), undefined, store);
}

export async function setProjectCommentPrivate(project: DbProject, actor: ProjectActor, id: string, isPrivate: boolean) {
    isPrivate = z.boolean().parse(isPrivate);
    return await changeComment(project, actor, id,
        () => canMakeCommentPrivate(actor),
        async comment => {
            if (Boolean(comment.private) === isPrivate) return comment;
            let updated: DbComment = { ...comment, private: isPrivate };
            const visible: string[] = [];
            for (const userId of assignedUserIds(comment)) {
                const recipient = await memberActor(project, userId);
                if (recipient && canSeeComment(updated, recipient)) visible.push(userId);
            }
            if (visible.length !== assignedUserIds(comment).length) {
                updated = assignmentChange(updated, visible, actor, nowIso());
            }
            return updated;
        });
}

/**
 * A member's own title for the thread (those who can triage, as for priority): it replaces the AI title,
 * which is no longer made for it. An empty title removes it, and the AI title shows again.
 */
export async function setProjectCommentTitle(project: DbProject, actor: ProjectActor, id: string, title: string) {
    const cleaned = typeof title === 'string' ? cleanManualTitle(title) : null;
    if (cleaned === null) throw apiErrors.invalidRequest(`Keep the title to ${MANUAL_TITLE_MAX_LENGTH} characters or fewer.`);
    return changeComment(project, actor, id, comment => canTriageProject(project, actor) && !threadItems(comment)[0]?.deletedAt, comment => {
        if ((comment.manualTitle ?? '') === cleaned) return comment;
        const updated: DbComment = { ...comment, manualTitle: cleaned };
        if (!cleaned) delete updated.manualTitle;
        return updated;
    });
}

/** Record the changed people once; retained people keep all their agents and leases. */
function assignmentChange(comment: DbComment, ids: string[], actor: ProjectActor, at: string) {
    const previous = assignedUserIds(comment);
    const changed = [...new Set([...previous, ...ids])].filter(id => previous.includes(id) !== ids.includes(id));
    const actorId = actorAuthorId(actor)!;
    const connector = actor.kind === 'member' ? actor.agent : undefined;
    // Assignment is own activity even via MCP; never acknowledge earlier unseen replies.
    let updated = withNotificationEvent(withAssignments(withThreadActivity(comment, actorId), ids), actorId, 'assignment', at,
        changed.map(id => `user:${id}`), connector, { assigneeId: ids[0] ?? null, assigneeIds: ids, previousAssigneeIds: previous });
    for (const agent of assignedAgents(comment).filter(agent => !ids.includes(agent.assigneeId)))
        updated = withNotificationEvent(updated, actorId, 'agent', at, undefined, connector, { assigneeId: agent.assigneeId, agentId: agent.id, assigneeAgent: null });
    return updated;
}

/** Existing calls replace the assignment with one person (or clear everyone with null). */
export async function setProjectCommentAssignee(project: DbProject, actor: ProjectActor, id: string, assigneeId: string | null, idempotencyKey?: string, guard?: CommentChangeGuard, store?: CommentsStore) {
    const parsed = userIdSchema.nullable().safeParse(assigneeId);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose a valid user id.');
    return changeAssignees(project, actor, id, parsed.data ? [parsed.data] : [], 'replace', idempotencyKey, guard, store, { assigneeId: parsed.data });
}

/** Atomic set/add/remove shared by app, toolbar and MCP. Re-evaluated against the current etag on retry. */
export async function setProjectCommentAssignees(project: DbProject, actor: ProjectActor, id: string, ids: string[], mode: AssignmentMode = 'replace', idempotencyKey?: string, guard?: CommentChangeGuard, store?: CommentsStore) {
    return changeAssignees(project, actor, id, ids, mode, idempotencyKey, guard, store);
}

async function changeAssignees(project: DbProject, actor: ProjectActor, id: string, ids: string[], mode: AssignmentMode, idempotencyKey?: string, guard?: CommentChangeGuard, store?: CommentsStore, legacy?: { assigneeId: string | null }) {
    const parsed = assigneeIdsSchema.safeParse(ids);
    if (!parsed.success || !assignmentModeSchema.safeParse(mode).success) throw apiErrors.invalidRequest('Choose up to 50 distinct people and a valid assignment action.');
    ids = parsed.data;
    return await changeComment(project, actor, id, () => actor.kind === 'member', async comment => {
        await assertParticipantEditor(project, actor, comment);
        const previous = assignedUserIds(comment);
        const next = mode === 'add' ? [...new Set([...previous, ...ids])] : mode === 'remove' ? previous.filter(id => !ids.includes(id)) : ids;
        if (!assigneeIdsSchema.safeParse(next).success) throw apiErrors.invalidRequest('A thread can have up to 50 assignees.');
        // Recheck every requested recipient, even for a no-op or a receipt-free request.
        if (mode !== 'remove') for (const userId of ids) await assertEligibleParticipant(project, comment, userId);
        if (previous.length === next.length && previous.every(id => next.includes(id))) return comment;
        return assignmentChange(comment, next, actor, nowIso());
    }, submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { ...(legacy ? { operation: 'assignment', id, assigneeId: legacy.assigneeId } : { operation: 'assignments', id, ids, mode }), ...guardFingerprint(guard) }), guard, store);
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
            const edited: DbComment = { ...comment, thread: { ...comment.thread, items: [{ ...first, text, mentions: moveMentions(first.text, text, first.mentions ?? []), editedAt: nowIso() }, ...replies] } };
            // The title described the old text: it goes with it, and a new one is made after the save
            delete edited.aiTitle;
            return edited;
        });
}

/** The toolbar edits one message, retaining the thread's author, anchor, image and context. */
export async function editProjectCommentItem(project: DbProject, actor: ProjectActor, id: string, itemId: string, input: EditThreadItemInput & { mentions?: DbMention[] }) {
    return await changeComment(project, actor, id, () => true,
        async comment => {
            const edited = withEditedThreadItem(comment, itemId, input, item => canEditItem(item, actor));
            const previous = comment.thread.items.find(item => item.id === itemId);
            const mentions = await validateMentions(project, actor, comment, input.text, input.mentions, previous);
            const updated: DbComment = { ...edited, thread: { ...edited.thread, items: edited.thread.items.map(item => item.id === itemId ? { ...item, mentions } : item) } };
            // An edit of the first message drops the title made from it; a new one is made after the save
            if (edited.thread.items[0]?.id === itemId) delete updated.aiTitle;
            const existing = new Set(previous?.mentions?.map(mention => mention.userId));
            const recipients = mentionRecipients(mentions.filter(mention => !existing.has(mention.userId)));
            return recipients.length ? withNotificationEvent(withThreadActivity(updated, actorAuthorId(actor)!, actor.kind === 'member' && Boolean(actor.agent)), actorAuthorId(actor)!, 'mention', nowIso(), recipients, actor.kind === 'member' ? actor.agent : undefined, { itemId }) : updated;
        });
}

/** The whole-thread delete: a durable cleanup intent, then the conditional delete with its integration tombstone */
export async function deleteProjectThread(store: CommentsStore, project: Pick<DbProject, 'id' | 'integrations'>, comment: DbComment, etag: string) {
    await queueThreadCleanup(comment.domain, comment.id, true);
    return !isUierFeedbackProject(project.id)
        ? store.deleteWithTombstone(comment.domain, comment.id, etag, syncTombstone(project, comment))
        : store.delete(comment.domain, comment.id, etag);
}

/** Deletes the whole thread (the app: the author or an admin) */
export async function removeProjectComment(project: DbProject, actor: ProjectActor, id: string) {
    const store = getCommentsStore();
    const partition = projectPartition(project.id);
    let hadScreenshot = false;
    let previousImageItems: string[] = [];
    await updateComment(store, project, actor, id, (comment) => {
        visibleOrThrow(comment, actor);
        if (!canDeleteComment(comment, actor))
            throw apiErrors.forbidden('Only the author or an admin can delete this comment.');
        hadScreenshot = Boolean(comment.screenshot);
        previousImageItems = comment.thread.items.filter(item => item.screenshot).map(item => item.id);
        return null;
    }, (comment, etag) => deleteProjectThread(store, project, comment, etag));
    await forgetScreenshot(store, partition, id, hadScreenshot, null, previousImageItems);
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
    let previousImageItems: string[] = [];
    const updated = await updateComment(store, project, actor, id, (comment): DbComment | null => {
        visibleOrThrow(comment, actor);
        hadScreenshot = Boolean(comment.screenshot);
        previousImageItems = comment.thread.items.filter(item => item.screenshot).map(item => item.id);
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
            // The titles were made from, or describe, the deleted text
            delete kept.aiTitle;
            delete kept.manualTitle;
            delete kept.verification;
            delete kept.authorId;
            delete kept.device;
            delete kept.screenshot;
            return withSyncMark(project, comment, withThreadHistory(comment, kept, actorAuthorId(actor)!));
        }

        const remaining = items.filter(other => other !== item);
        if (remaining.every(other => typeof other.deletedAt === 'string'))
            return null;
        return withSyncMark(project, comment, { ...comment, thread: { ...comment.thread, items: remaining }, updatedAt: now });
    }, (comment, etag) => deleteProjectThread(store, project, comment, etag));
    await forgetScreenshot(store, partition, id, hadScreenshot, updated, previousImageItems);
    return updated;
}

export async function reattachProjectAnchor(project: DbProject, actor: ProjectActor, id: string, origin: string, input: ReattachAnchorInput) {
    assertWriter(actor);
    if (!projectOrigins(project).includes(origin)) throw apiErrors.forbidden('Open the reviewed page to change its anchor.');
    return reattachAnchor(getCommentsStore(), projectPartition(project.id), id, input, async comment => {
        await refreshMutationActor(project, actor);
        visibleOrThrow(comment, actor);
        if (!canEditComment(comment, actor)) throw apiErrors.forbidden();
        if (comment.origin !== origin) throw apiErrors.forbidden('Choose a target on the original reviewed site.');
    }, (previous, updated) => withSyncMark(project, previous, withThreadHistory(previous, updated, actorAuthorId(actor)!)));
}
