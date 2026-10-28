import { useProjectViewer } from '../project/ProjectGate';
import { useContext, useEffect } from 'react';
import { QueryClient, UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { CommentActivity, CommentDeviceInfo, CommentItem, CommentItemPosition, CommentItemThreadItem, CommentKind, Mention } from '../components/@types/Comments';
import { apiImage, apiRequest, commentsQueryKeyPrefix, required, visitorQueryKey, pageVisitorQueryKey, projectViewerQueryKey, CommentsApiError, currentReviewerRevision, activityQueryKey } from './api';
import { newCommentDraftKey, newRewriteDraftKey, feedbackDraftKey, useDrafts } from './useDrafts';
import type { Visitor } from './useVisitor';
import { getGuestName } from '../project/projectSession';
import { getCommentsErrorMessage } from '../components/CommentsErrorMessage';
import { showErrorToast } from '../components/Toaster';

export { CommentsApiError, type CommentsApiErrorCode, type CommentsRateLimitReason } from './api';

// Same origin as the toolbar script, or explicitly configured (see src/config.ts). A project's
// comments are in the review API, which applies the project's "who can comment" setting.
const commentsApiUrl = toolbarConfig.project
    ? `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/comments`
    : `${toolbarConfig.apiUrl}/api/comments`;

/** Guests of a project tag their comments with their name (see project/ProjectGate.tsx) */
function guestAuthorName() {
    return toolbarConfig.project ? getGuestName() : undefined;
}

export function commentUrl(commentId: string) {
    return `${commentsApiUrl}/${encodeURIComponent(commentId)}`;
}

export type CreateCommentInput = {
    idempotencyKey?: string;
    /** The temporary id the comment is shown with until the API saved it (`newLocalId()`) */
    localId?: string;
    position: CommentItemPosition;
    /** `comment` (default) for pinned comments; `feedback` and `bug` with a `page` position */
    kind?: CommentKind;
    text: string;
    mentions?: Mention[];
    quotedText?: string;
    device?: CommentDeviceInfo;
    /** A screenshot of the commented part of the page, a data URL (see src/screenshot.ts); awaited while sending */
    screenshot?: string | Promise<string | undefined>;
};

type ReplyInput = { commentId: string; text: string; mentions?: Mention[] };

/*
 * Optimistic comments and replies: shown at once, sent in the background. A list fetched while
 * one is on its way keeps it (`withPending`), until the API's version replaces it; a failure
 * removes it and says so in a toast (the composer puts the text back in the draft).
 */
const pendingComments = new Map<string, CommentItem>();
const pendingReplies = new Map<string, CommentItemThreadItem[]>();
// The temporary id a saved comment had (see `commentKey`)
const localKeys = new Map<string, string>();

/**
 * A comment's React key: the temporary id it was shown with while it was sent, so its pin and open
 * thread stay the same component when the API's version (or any later update of it) replaces it
 */
export function commentKey(comment: CommentItem) {
    return localKeys.get(comment.id) ?? comment.id;
}

/** A temporary id for a comment or reply that is not saved yet */
export function newLocalId() {
    return `pending-${Array.from(crypto.getRandomValues(new Uint8Array(12)), value => value.toString(16).padStart(2, '0')).join('')}`;
}

const sameText = (item: CommentItemThreadItem | undefined, text: string) => Boolean(item && !item.deleted && item.author.isMe && item.text === text);

/** A saved comment with the replies to it that are still on their way */
function applyPending(comment: CommentItem): CommentItem {
    const replies = pendingReplies.get(comment.id)?.filter(reply => !reply.deleted && !comment.thread.items.some(item => sameText(item, reply.text)));
    return replies?.length ? { ...comment, thread: { items: [...comment.thread.items, ...replies] } } : comment;
}

/** A fetched list, with the comments (of the list, `include`) that are still on their way */
function withPending(comments: CommentItem[], include: (comment: CommentItem) => boolean) {
    const waiting = [...pendingComments.values()].filter(pending => {
        const first = pending.thread.items[0];
        return include(pending) && !comments.some(comment => comment.isMine && comment.kind === pending.kind && comment.path === pending.path
            && first && !first.deleted && sameText(comment.thread.items[0], first.text));
    });
    return [...waiting, ...comments.map(applyPending)];
}

/** The temporary comment, shown until the API returns the saved one */
function optimisticComment(path: string, input: CreateCommentInput, authorName: string): CommentItem {
    const createdAt = new Date().toISOString();
    const id = input.localId ?? newLocalId();
    return {
        id, path, position: input.position, kind: input.kind ?? 'comment', pending: true,
        thread: { items: [{ id: `${id}-0`, text: input.text, mentions: input.mentions, quotedText: input.quotedText, author: { name: authorName, isMe: true }, createdAt, canDelete: false, canEdit: false, pending: true }] },
        device: input.device && { size: input.device.size, windowSize: input.device.windowSize },
        resolved: false, isMine: true, createdAt,
        // Nothing to change before it is saved
        permissions: { resolve: false, delete: false, edit: false, assign: false }
    };
}

/** The saved comment in place of its temporary one (or added, when the list did not have it) */
function replacePending(comments: CommentItem[], localId: string, saved: CommentItem) {
    const has = comments.some(comment => comment.id === saved.id);
    return comments.flatMap(comment => comment.id === localId
        ? has ? [] : [saved]
        : comment.id === saved.id ? [mergeReadCursor(saved, comment.activity?.readSequence)] : [comment]);
}

const notSent: Record<CommentKind | 'reply', string> = {
    comment: 'Your comment wasn\'t posted',
    rewrite: 'Your suggestion wasn\'t posted',
    feedback: 'Your feedback wasn\'t sent',
    bug: 'Your bug report wasn\'t sent',
    reply: 'Your reply wasn\'t posted'
};

function toastNotSent(kind: CommentKind | 'reply', error: unknown) {
    const reason = getCommentsErrorMessage(error);
    showErrorToast(notSent[kind], /kept/.test(reason) ? reason : `${reason} Your text is kept.`);
}

async function getComments(path: string, client: QueryClient, environment?: string) {
    const comments = await apiRequest<CommentItem[]>(`${commentsApiUrl}?path=${encodeURIComponent(path)}${environment ? `&environment=${encodeURIComponent(environment)}` : ''}`);
    return withPending(reconcileReads(client, Array.isArray(comments) ? comments : []), comment => comment.path === path);
}

async function createComment(path: string, { idempotencyKey, position, kind, text, mentions, quotedText, device, screenshot }: CreateCommentInput) {
    return required(await apiRequest<CommentItem>(commentsApiUrl, {
        method: 'POST',
        body: { idempotencyKey, path, position, kind, text, mentions, quotedText, device, screenshot: await screenshot, authorName: guestAuthorName() }
    }));
}

/** The image of a comment's screenshot, as a data URL */
export function getCommentScreenshot(commentId: string) {
    return apiImage(`${commentUrl(commentId)}/screenshot`);
}

async function replyToComment({ commentId, text, mentions, idempotencyKey }: { commentId: string; text: string; mentions?: Mention[]; idempotencyKey?: string }) {
    return required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/replies`, {
        method: 'POST',
        body: { text, mentions, idempotencyKey, authorName: guestAuthorName() }
    }));
}

async function resolveComment({ commentId, resolved }: { commentId: string; resolved: boolean }) {
    return required(await apiRequest<CommentItem>(commentUrl(commentId), {
        method: 'PATCH',
        body: { resolved }
    }));
}

async function deleteComment(commentId: string) {
    // 204 when the comment is gone, or 200 with the thread that stays because others replied
    return await apiRequest<CommentItem>(commentUrl(commentId), { method: 'DELETE' });
}

async function deleteReply({ commentId, itemId }: { commentId: string; itemId: string }) {
    // 200 with the updated comment, or 204 when the whole comment is gone
    return await apiRequest<CommentItem>(`${commentUrl(commentId)}/replies/${encodeURIComponent(itemId)}`, {
        method: 'DELETE'
    });
}

export type ReattachInput = { commentId: string; path: string; position: import('../components/@types/Comments').CommentAnchor; expectedRevision: string | null };

type EditMessageInput = { commentId: string; itemId: string; text: string; expectedText: string; mentions?: Mention[] };
async function editMessage({ commentId, itemId, text, expectedText, mentions }: EditMessageInput) {
    return required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/replies/${encodeURIComponent(itemId)}`, {
        method: 'PATCH', body: { text, expectedText, mentions }
    }));
}

async function getSiteComments(client: QueryClient, unreadOnly: boolean, environment?: string) {
    const comments = await apiRequest<CommentItem[]>(`${commentsApiUrl}?scope=site${unreadOnly ? '&unread=true' : ''}${environment ? `&environment=${encodeURIComponent(environment)}` : ''}`);
    return withPending(reconcileReads(client, Array.isArray(comments) ? comments : []), () => !unreadOnly);
}

export function commentsQueryKey(path: string, environment?: string, reviewer?: string) {
    return [...commentsQueryKeyPrefix, path, environment ?? 'current', reviewer ?? 'public'] as const;
}

/** The comments of every page of the site (paths always start with "/", so this key is not a page's) */
export const siteCommentsQueryKey = [...commentsQueryKeyPrefix, 'site'] as const;

function withComment(comments: CommentItem[], comment: CommentItem) {
    return comments.some(c => c.id === comment.id)
        ? comments.map(c => c.id === comment.id ? mergeReadCursor(comment, c.activity?.readSequence) : c)
        : [comment, ...comments];
}

/** Applies a change to every cached list of comments (each page's and the site's) */
function updateAllCachedComments(client: QueryClient, update: (comments: CommentItem[]) => CommentItem[]) {
    client.setQueriesData<CommentItem[]>({ queryKey: commentsQueryKeyPrefix }, (current) => current && update(current));
}

/** The comments of every page of the site, for the inbox (fetched while `enabled`) */
export function useSiteComments(enabled: boolean, unreadOnly = false): UseQueryResult<CommentItem[], Error> {
    const { environment, draftScope } = useProjectViewer();
    const client = useQueryClient();
    return useQuery({
        queryKey: [...(unreadOnly ? [...commentsQueryKeyPrefix, 'site-unread'] : siteCommentsQueryKey), environment ?? 'current', draftScope ?? 'public'],
        queryFn: () => authorizedList(client, () => getSiteComments(client, unreadOnly, environment)),
        refetchOnMount: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
        enabled
    });
}

export function useComments(refreshOnMount = false): {
    path: string;
    query: UseQueryResult<CommentItem[], Error>;
    create: UseMutationResult<CommentItem, Error, CreateCommentInput, { localId: string }>;
    reply: UseMutationResult<CommentItem, Error, ReplyInput, { itemId: string }>;
    resolve: UseMutationResult<CommentItem, Error, { commentId: string; resolved: boolean }, unknown>;
    delete: UseMutationResult<CommentItem | undefined, Error, string, unknown>;
    deleteReply: UseMutationResult<CommentItem | undefined, Error, { commentId: string; itemId: string }, unknown>;
    assign: UseMutationResult<CommentItem, Error, { commentId: string; assigneeId: string | null }, unknown>;
    edit: UseMutationResult<CommentItem, Error, EditMessageInput, unknown>;
    reattach: UseMutationResult<CommentItem, Error, ReattachInput, unknown>;
} {
    const { path } = useContext(CommentsBootstrapperContext);
    const client = useQueryClient();
    const drafts = useDrafts();
    const { currentEnvironment, draftScope } = useProjectViewer();
    const queryKey = commentsQueryKey(path, currentEnvironment, draftScope);

    const query = useQuery({
        queryKey,
        queryFn: () => authorizedList(client, () => getComments(path, client, currentEnvironment)),
        // Only the review layer refreshes on navigation. New pin/header observers reuse it.
        refetchOnMount: refreshOnMount ? 'always' : false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false
    });

    // A comment can be on another page (the inbox lists the whole site): every list that has it
    const handleCommentChanged = (comment: CommentItem) => {
        updateAllCachedComments(client, (comments) => comments.map(c => c.id === comment.id ? mergeReadCursor(applyPending(comment), c.activity?.readSequence) : c));
    };
    const handleCommentDeleted = (commentId: string) => {
        updateAllCachedComments(client, (comments) => comments.filter(c => c.id !== commentId));
    };
    const handleSettled = () => {
        // Also picks up other visitors' changes; the comment is gone on `not_found`
        client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
        client.invalidateQueries({ queryKey: activityQueryKey });
    };

    // The first comment or reply gives the visitor a guest name (see hooks/useVisitor.tsx)
    const handleWritten = (comment: CommentItem) => {
        handleCommentChanged(comment);
        client.invalidateQueries({ queryKey: visitorQueryKey });
    };

    // The visitor's name on what they just wrote, until the API returns it
    const authorName = () => client.getQueryData<Visitor>(pageVisitorQueryKey(path))?.name ?? guestAuthorName() ?? 'You';

    const create = useMutation({
        mutationFn: (input: CreateCommentInput) => {
            const key = input.kind === 'rewrite' ? newRewriteDraftKey : input.kind === 'feedback' || input.kind === 'bug' ? `${feedbackDraftKey}:${input.kind}` : newCommentDraftKey;
            // The same content is the same attempt (a retry the API can recognize), whatever its local id
            const { device: _device, screenshot: _screenshot, idempotencyKey: _identity, localId: _local, ...content } = input;
            return createComment(path, { ...input, idempotencyKey: drafts.attempt(key, JSON.stringify({ path, ...content })) });
        },
        onMutate: (input: CreateCommentInput) => {
            const comment = optimisticComment(path, input, authorName());
            pendingComments.set(comment.id, comment);
            client.setQueryData<CommentItem[]>(queryKey, (current) => [comment, ...(current ?? [])]);
            client.setQueryData<CommentItem[]>(siteCommentsQueryKey, (current) => current && [comment, ...current]);
            return { localId: comment.id };
        },
        onSuccess: (comment: CommentItem, _input, { localId }) => {
            pendingComments.delete(localId);
            localKeys.set(comment.id, localId);
            const saved = applyPending(comment);
            updateAllCachedComments(client, (comments) => comments.some(c => c.id === localId) ? replacePending(comments, localId, saved) : comments);
            client.setQueryData<CommentItem[]>(queryKey, (current) => withComment(current ?? [], saved));
            client.setQueryData<CommentItem[]>(siteCommentsQueryKey, (current) => current && withComment(current, saved));
            client.invalidateQueries({ queryKey: visitorQueryKey });
        },
        onError: (error, input, context) => {
            if (context) {
                pendingComments.delete(context.localId);
                updateAllCachedComments(client, (comments) => comments.filter(c => c.id !== context.localId));
            }
            toastNotSent(input.kind ?? 'comment', error);
        },
        onSettled: handleSettled
    });

    const forgetPendingReply = (commentId: string, itemId: string) => {
        const rest = pendingReplies.get(commentId)?.filter(item => item.id !== itemId) ?? [];
        if (rest.length) pendingReplies.set(commentId, rest);
        else pendingReplies.delete(commentId);
    };

    const reply = useMutation({
        mutationFn: (input: ReplyInput) => replyToComment({
            ...input, idempotencyKey: drafts.attempt(input.commentId, JSON.stringify(input))
        }),
        onMutate: (input: ReplyInput) => {
            const item: CommentItemThreadItem = {
                id: newLocalId(), text: input.text, mentions: input.mentions, author: { name: authorName(), isMe: true },
                createdAt: new Date().toISOString(), canDelete: false, canEdit: false, pending: true
            };
            pendingReplies.set(input.commentId, [...(pendingReplies.get(input.commentId) ?? []), item]);
            updateAllCachedComments(client, (comments) => comments.map(c => c.id === input.commentId ? { ...c, thread: { items: [...c.thread.items, item] } } : c));
            return { itemId: item.id };
        },
        onSuccess: (comment, input, { itemId }) => {
            forgetPendingReply(input.commentId, itemId);
            handleWritten(comment);
        },
        onError: (error, input, context) => {
            if (context) {
                forgetPendingReply(input.commentId, context.itemId);
                updateAllCachedComments(client, (comments) => comments.map(c => c.id === input.commentId
                    ? { ...c, thread: { items: c.thread.items.filter(item => item.id !== context.itemId) } }
                    : c));
            }
            toastNotSent('reply', error);
        },
        onSettled: handleSettled
    });

    const resolve = useMutation({
        mutationFn: resolveComment,
        onSuccess: handleCommentChanged,
        onSettled: handleSettled
    });

    const assign = useMutation({
        mutationFn: async ({ commentId, assigneeId }: { commentId: string; assigneeId: string | null }) => required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/assignee`, { method: 'PATCH', body: { assigneeId } })),
        onSuccess: handleCommentChanged, onSettled: handleSettled
    });
    const edit = useMutation({ mutationFn: editMessage, onSuccess: handleCommentChanged, onSettled: handleSettled });

    const reattach = useMutation({
        mutationFn: ({ commentId, ...body }: ReattachInput) => authorizedList(client,
            () => apiRequest<CommentItem>(`${commentUrl(commentId)}/anchor`, { method: 'PATCH', body }).then(required)),
        onMutate: () => currentReviewerRevision(),
        onSuccess: (comment, _input, revision) => { if (revision === currentReviewerRevision()) handleCommentChanged(comment); },
        onSettled: handleSettled
    });

    // Deletes return the comment when its thread stays, nothing when the whole comment is gone
    const remove = useMutation({
        mutationFn: deleteComment,
        onSuccess: (comment, commentId) => comment ? handleCommentChanged(comment) : handleCommentDeleted(commentId),
        onSettled: handleSettled
    });

    const removeReply = useMutation({
        mutationFn: deleteReply,
        onSuccess: (comment, { commentId }) => comment ? handleCommentChanged(comment) : handleCommentDeleted(commentId),
        onSettled: handleSettled
    });

    return {
        path,
        query,
        create,
        reply,
        resolve,
        edit,
        reattach,
        assign,
        delete: remove,
        deleteReply: removeReply
    };
}

/** Retain monotonic receipts if an older in-flight list finishes after a read write. */
function reconcileReads(client: QueryClient, comments: CommentItem[]) {
    const cached = client.getQueriesData<CommentItem[]>({ queryKey: commentsQueryKeyPrefix }).flatMap(([, data]) => data ?? []);
    const reads = new Map<string, number>();
    for (const item of cached) reads.set(item.id, Math.max(reads.get(item.id) ?? 0, item.activity?.readSequence ?? 0));
    return comments.map(comment => mergeReadCursor(comment, reads.get(comment.id)));
}

async function authorizedList<T>(client: QueryClient, load: () => Promise<T>) {
    try { return await load(); }
    catch (error) {
        if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
            // React Query retains stale data on error. Purge it before showing an access notice.
            client.setQueriesData({ queryKey: commentsQueryKeyPrefix }, []);
            client.removeQueries({ queryKey: ['screenshot'] });
            client.setQueriesData({ queryKey: activityQueryKey }, { unread: 0, open: 0, done: 0, total: 0 });
            if (toolbarConfig.project) void client.invalidateQueries({ queryKey: projectViewerQueryKey });
        }
        throw error;
    }
}

/** Single-thread and bulk reads share receipt merging and reviewer/cache guards. */
export function useReadComment() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (input: CommentItem | CommentItem[]) => {
            const revision = currentReviewerRevision();
            const snapshot = Array.isArray(input) ? input : [input];
            const reads: { id: string; activity: CommentActivity }[] = [];
            try {
                for (let offset = 0; offset < snapshot.length; offset += 200) {
                    const batch = snapshot.slice(offset, offset + 200);
                    const result = required(await apiRequest<CommentActivity | { reads: typeof reads }>(
                        Array.isArray(input) ? `${commentsApiUrl}/read` : `${commentUrl(input.id)}/read`, {
                            method: 'POST', body: Array.isArray(input)
                                ? { threads: batch.map(comment => ({ id: comment.id, sequence: comment.activity?.sequence ?? 0 })) }
                                : { sequence: input.activity?.sequence ?? 0 }
                        }));
                    if (revision !== currentReviewerRevision()) return { reads: [], failed: [], revision };
                    reads.push(...('reads' in result ? result.reads : [{ id: batch[0]!.id, activity: result }]));
                }
            } catch (error) {
                if (!Array.isArray(input)) throw error;
                // Earlier batches succeeded; leave every unacknowledged cursor available for retry.
            }
            const saved = new Set(reads.map(read => read.id));
            return { reads, failed: snapshot.filter(comment => !saved.has(comment.id)), revision };
        },
        onSuccess: async ({ reads, revision }, input) => {
            await client.cancelQueries({ queryKey: activityQueryKey });
            if (revision !== currentReviewerRevision()) return;
            const receipts = new Map(reads.map(read => [read.id, read.activity]));
            updateAllCachedComments(client, comments => comments.map(comment => {
                const activity = receipts.get(comment.id);
                if (!activity || !comment.activity) return comment;
                return mergeReadCursor({ ...comment, activity: activity.sequence >= comment.activity.sequence ? activity : comment.activity },
                    Math.max(activity.readSequence, comment.activity.readSequence));
            }));
            // Fetch replies newer than the rendered snapshot, and refill a bounded unread list.
            await Promise.all([
                client.invalidateQueries({ queryKey: activityQueryKey }),
                client.invalidateQueries({ queryKey: Array.isArray(input) || reads.some(read => read.activity.sequence > (input.activity?.sequence ?? 0))
                    ? commentsQueryKeyPrefix : [...commentsQueryKeyPrefix, 'site-unread'] })
            ]);
        }
    });
}

/** One scheduler per review layer. Hidden, offline and collapsed reviews do not poll. */
export function useCommentsRefresh(expanded: boolean) {
    const client = useQueryClient();
    useEffect(() => {
        let refreshing = false;
        const refresh = async () => {
            if (!expanded || document.visibilityState !== 'visible' || !navigator.onLine || refreshing) return;
            refreshing = true;
            try {
                if (toolbarConfig.project) await client.invalidateQueries({ queryKey: projectViewerQueryKey });
                else await client.invalidateQueries({ queryKey: visitorQueryKey }, { cancelRefetch: false });
                await Promise.all([
                    client.invalidateQueries({ queryKey: commentsQueryKeyPrefix, refetchType: 'active' }, { cancelRefetch: false }),
                    client.invalidateQueries({ queryKey: activityQueryKey }, { cancelRefetch: false })
                ]);
            } finally { refreshing = false; }
        };
        const interval = window.setInterval(() => { void refresh(); }, 15_000);
        const foreground = () => { void refresh(); };
        window.addEventListener('focus', foreground);
        window.addEventListener('online', foreground);
        document.addEventListener('visibilitychange', foreground);
        if (expanded) void refresh();
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', foreground);
            window.removeEventListener('online', foreground);
            document.removeEventListener('visibilitychange', foreground);
        };
    }, [client, expanded]);
}

export { activityQueryKey };
export type ActivitySummary = { unread: number; open: number; done: number; total: number };

export function useActivitySummary() {
    const { environment, draftScope } = useProjectViewer();
    const client = useQueryClient();
    return useQuery({
        queryKey: [...activityQueryKey, environment ?? 'current', draftScope ?? 'public'],
        queryFn: async () => {
            try { return required(await apiRequest<ActivitySummary>(`${commentsApiUrl}/activity${environment ? `?environment=${encodeURIComponent(environment)}` : ''}`)); }
            catch (error) {
                if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
                    client.setQueriesData({ queryKey: commentsQueryKeyPrefix }, []);
                    client.removeQueries({ queryKey: ['screenshot'] });
                    client.setQueriesData({ queryKey: activityQueryKey }, { unread: 0, open: 0, done: 0, total: 0 });
                }
                throw error;
            }
        },
        retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
    });
}

/** Local mutations, including screenshot replacement, cannot roll a pending receipt backwards. */
export function mergeReadCursor(comment: CommentItem, previousSequence = 0): CommentItem {
    if (!comment.activity) return comment;
    const readSequence = Math.max(comment.activity.readSequence, previousSequence);
    return { ...comment, activity: { ...comment.activity, readSequence, unread: comment.activity.lastOtherSequence > readSequence } };
}
