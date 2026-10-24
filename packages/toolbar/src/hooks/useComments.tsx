import { useContext } from 'react';
import { QueryClient, UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { CommentDeviceInfo, CommentItem, CommentItemPosition, CommentKind } from '../components/@types/Comments';
import { apiRequest, commentsQueryKeyPrefix, required, visitorQueryKey } from './api';
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

function commentUrl(commentId: string) {
    return `${commentsApiUrl}/${encodeURIComponent(commentId)}`;
}

export type CreateCommentInput = {
    position: CommentItemPosition;
    /** `comment` (default) for pinned comments; `feedback` and `bug` with a `page` position */
    kind?: CommentKind;
    text: string;
    quotedText?: string;
    device?: CommentDeviceInfo;
};

async function getComments(path: string) {
    const comments = await apiRequest<CommentItem[]>(`${commentsApiUrl}?path=${encodeURIComponent(path)}`);
    return Array.isArray(comments) ? comments : [];
}

async function createComment(path: string, { position, kind, text, quotedText, device }: CreateCommentInput) {
    return required(await apiRequest<CommentItem>(commentsApiUrl, {
        method: 'POST',
        body: { path, position, kind, text, quotedText, device, authorName: guestAuthorName() }
    }));
}

async function replyToComment({ commentId, text }: { commentId: string; text: string }) {
    return required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/replies`, {
        method: 'POST',
        body: { text, authorName: guestAuthorName() }
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

export function commentsQueryKey(path: string) {
    return [...commentsQueryKeyPrefix, path] as const;
}

function updateCachedComments(client: QueryClient, path: string, update: (comments: CommentItem[]) => CommentItem[]) {
    client.setQueryData<CommentItem[]>(commentsQueryKey(path), (current) => update(current ?? []));
}

function withComment(comments: CommentItem[], comment: CommentItem) {
    return comments.some(c => c.id === comment.id)
        ? comments.map(c => c.id === comment.id ? comment : c)
        : [comment, ...comments];
}

export function useComments(): {
    path: string;
    query: UseQueryResult<CommentItem[], Error>;
    create: UseMutationResult<CommentItem, Error, CreateCommentInput, unknown>;
    reply: UseMutationResult<CommentItem, Error, { commentId: string; text: string }, unknown>;
    resolve: UseMutationResult<CommentItem, Error, { commentId: string; resolved: boolean }, unknown>;
    delete: UseMutationResult<CommentItem | undefined, Error, string, unknown>;
    deleteReply: UseMutationResult<CommentItem | undefined, Error, { commentId: string; itemId: string }, unknown>;
} {
    const { path } = useContext(CommentsBootstrapperContext);
    const client = useQueryClient();
    const queryKey = commentsQueryKey(path);

    const query = useQuery({
        queryKey,
        queryFn: () => getComments(path)
    });

    const handleCommentChanged = (comment: CommentItem) => {
        updateCachedComments(client, path, (comments) => withComment(comments, comment));
    };
    const handleCommentDeleted = (commentId: string) => {
        updateCachedComments(client, path, (comments) => comments.filter(c => c.id !== commentId));
    };
    const handleSettled = () => {
        // Also picks up other visitors' changes; the comment is gone on `not_found`
        client.invalidateQueries({ queryKey });
    };

    // The first comment or reply gives the visitor a guest name (see hooks/useVisitor.tsx)
    const handleWritten = (comment: CommentItem) => {
        handleCommentChanged(comment);
        client.invalidateQueries({ queryKey: visitorQueryKey });
    };

    const create = useMutation({
        mutationFn: (input: CreateCommentInput) => createComment(path, input),
        onSuccess: handleWritten,
        onSettled: handleSettled
    });

    const reply = useMutation({
        mutationFn: replyToComment,
        onSuccess: handleWritten,
        onSettled: handleSettled
    });

    const resolve = useMutation({
        mutationFn: resolveComment,
        onSuccess: handleCommentChanged,
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
        delete: remove,
        deleteReply: removeReply
    };
}
