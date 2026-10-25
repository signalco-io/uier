import { useContext, useEffect } from 'react';
import { QueryClient, UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { CommentActivity, CommentDeviceInfo, CommentItem, CommentItemPosition, CommentKind, Mention } from '../components/@types/Comments';
import { apiImage, apiRequest, commentsQueryKeyPrefix, required, visitorQueryKey, projectViewerQueryKey, CommentsApiError, currentReviewerRevision, activityQueryKey } from './api';
import { newCommentDraftKey, newRewriteDraftKey, feedbackDraftKey, useDrafts } from './useDrafts';
import { getGuestName } from '../project/projectSession';

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
    position: CommentItemPosition;
    /** `comment` (default) for pinned comments; `feedback` and `bug` with a `page` position */
    kind?: CommentKind;
    text: string;
    mentions?: Mention[];
    quotedText?: string;
    device?: CommentDeviceInfo;
    /** A screenshot of the commented part of the page, a data URL (see src/screenshot.ts) */
    screenshot?: string;
};

async function getComments(path: string, client: QueryClient) {
    const comments = await apiRequest<CommentItem[]>(`${commentsApiUrl}?path=${encodeURIComponent(path)}`);
    return reconcileReads(client, Array.isArray(comments) ? comments : []);
}

async function createComment(path: string, { idempotencyKey, position, kind, text, mentions, quotedText, device, screenshot }: CreateCommentInput) {
    return required(await apiRequest<CommentItem>(commentsApiUrl, {
        method: 'POST',
        body: { idempotencyKey, path, position, kind, text, mentions, quotedText, device, screenshot, authorName: guestAuthorName() }
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

type EditMessageInput = { commentId: string; itemId: string; text: string; expectedText: string; mentions?: Mention[] };
async function editMessage({ commentId, itemId, text, expectedText, mentions }: EditMessageInput) {
    return required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/replies/${encodeURIComponent(itemId)}`, {
        method: 'PATCH', body: { text, expectedText, mentions }
    }));
}

async function getSiteComments(client: QueryClient, unreadOnly: boolean) {
    const comments = await apiRequest<CommentItem[]>(`${commentsApiUrl}?scope=site${unreadOnly ? '&unread=true' : ''}`);
    return reconcileReads(client, Array.isArray(comments) ? comments : []);
}

export function commentsQueryKey(path: string) {
    return [...commentsQueryKeyPrefix, path] as const;
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
    const client = useQueryClient();
    return useQuery({
        queryKey: unreadOnly ? [...commentsQueryKeyPrefix, 'site-unread'] : siteCommentsQueryKey,
        queryFn: () => authorizedList(client, () => getSiteComments(client, unreadOnly)),
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
    create: UseMutationResult<CommentItem, Error, CreateCommentInput, unknown>;
    reply: UseMutationResult<CommentItem, Error, { commentId: string; text: string; mentions?: Mention[] }, unknown>;
    resolve: UseMutationResult<CommentItem, Error, { commentId: string; resolved: boolean }, unknown>;
    delete: UseMutationResult<CommentItem | undefined, Error, string, unknown>;
    deleteReply: UseMutationResult<CommentItem | undefined, Error, { commentId: string; itemId: string }, unknown>;
    assign: UseMutationResult<CommentItem, Error, { commentId: string; assigneeId: string | null }, unknown>;
    edit: UseMutationResult<CommentItem, Error, EditMessageInput, unknown>;
} {
    const { path } = useContext(CommentsBootstrapperContext);
    const client = useQueryClient();
    const drafts = useDrafts();
    const queryKey = commentsQueryKey(path);

    const query = useQuery({
        queryKey,
        queryFn: () => authorizedList(client, () => getComments(path, client)),
        // Only the review layer refreshes on navigation. New pin/header observers reuse it.
        refetchOnMount: refreshOnMount ? 'always' : false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false
    });

    // A comment can be on another page (the inbox lists the whole site): every list that has it
    const handleCommentChanged = (comment: CommentItem) => {
        updateAllCachedComments(client, (comments) => comments.map(c => c.id === comment.id ? mergeReadCursor(comment, c.activity?.readSequence) : c));
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

    const create = useMutation({
        mutationFn: (input: CreateCommentInput) => {
            const key = input.kind === 'rewrite' ? newRewriteDraftKey : input.kind === 'feedback' || input.kind === 'bug' ? `${feedbackDraftKey}:${input.kind}` : newCommentDraftKey;
            const { device: _device, screenshot: _screenshot, idempotencyKey: _identity, ...content } = input;
            return createComment(path, { ...input, idempotencyKey: drafts.attempt(key, JSON.stringify({ path, ...content })) });
        },
        onSuccess: (comment: CommentItem) => {
            client.setQueryData<CommentItem[]>(queryKey, (current) => withComment(current ?? [], comment));
            client.setQueryData<CommentItem[]>(siteCommentsQueryKey, (current) => current && withComment(current, comment));
            client.invalidateQueries({ queryKey: visitorQueryKey });
        },
        onSettled: handleSettled
    });

    const reply = useMutation({
        mutationFn: (input: { commentId: string; text: string; mentions?: Mention[] }) => replyToComment({
            ...input, idempotencyKey: drafts.attempt(input.commentId, JSON.stringify(input))
        }),
        onSuccess: handleWritten,
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
    return comments.map(comment => {
        if (!comment.activity) return comment;
        return mergeReadCursor(comment, reads.get(comment.id));
    });
}

async function authorizedList(client: QueryClient, load: () => Promise<CommentItem[]>) {
    try { return await load(); }
    catch (error) {
        if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
            // React Query retains stale data on error. Purge it before showing an access notice.
            client.setQueriesData({ queryKey: commentsQueryKeyPrefix }, []);
            client.removeQueries({ queryKey: ['screenshot'] });
            client.setQueryData(activityQueryKey, { unread: 0, open: 0, done: 0, total: 0 });
            if (toolbarConfig.project) void client.invalidateQueries({ queryKey: projectViewerQueryKey });
        }
        throw error;
    }
}

export function useReadComment() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (comment: CommentItem) => {
            const revision = currentReviewerRevision();
            const activity = required(await apiRequest<CommentActivity>(`${commentUrl(comment.id)}/read`, {
                method: 'POST', body: { sequence: comment.activity?.sequence ?? 0 }
            }));
            return { activity, revision };
        },
        onSuccess: async ({ activity, revision }, comment) => {
            await client.cancelQueries({ queryKey: activityQueryKey });
            if (revision !== currentReviewerRevision()) return;
            // A reply that raced the read request was never acknowledged. Fetch its content now.
            if (activity.sequence > (comment.activity?.sequence ?? 0))
                void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
            void client.invalidateQueries({ queryKey: activityQueryKey });
            void client.invalidateQueries({ queryKey: [...commentsQueryKeyPrefix, 'site-unread'] });
            updateAllCachedComments(client, comments => comments.map(current => {
                if (current.id !== comment.id || !current.activity) return current;
                const readSequence = Math.max(current.activity.readSequence, activity.readSequence);
                return { ...current, activity: { ...current.activity, readSequence, unread: current.activity.lastOtherSequence > readSequence } };
            }));
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
    const client = useQueryClient();
    return useQuery({
        queryKey: activityQueryKey,
        queryFn: async () => {
            try { return required(await apiRequest<ActivitySummary>(`${commentsApiUrl}/activity`)); }
            catch (error) {
                if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
                    client.setQueriesData({ queryKey: commentsQueryKeyPrefix }, []);
                    client.removeQueries({ queryKey: ['screenshot'] });
                    client.setQueryData(activityQueryKey, { unread: 0, open: 0, done: 0, total: 0 });
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
