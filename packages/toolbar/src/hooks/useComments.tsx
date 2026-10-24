import { useContext } from 'react';
import { QueryClient, UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { CommentDeviceInfo, CommentItem, CommentItemPosition } from '../components/@types/Comments';

// Same origin as the toolbar script, or explicitly configured (see src/config.ts)
const commentsApiUrl = `${toolbarConfig.apiUrl}/api/comments`;

/**
 * Error codes returned by the comments API (`{ error, message }` bodies), plus
 * `network_error` when the API could not be reached.
 */
export type CommentsApiErrorCode =
    | 'invalid_request'
    | 'forbidden'
    | 'bot_detected'
    | 'not_found'
    | 'too_large'
    | 'rate_limited'
    | 'server_error'
    | 'network_error';

export class CommentsApiError extends Error {
    readonly code: CommentsApiErrorCode | (string & {});
    readonly status: number;
    /** Seconds until the request may be retried (`Retry-After`), for `rate_limited` */
    readonly retryAfter?: number;

    constructor(code: CommentsApiError['code'], message: string, status: number, retryAfter?: number) {
        super(message);
        this.name = 'CommentsApiError';
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

function errorCodeFromStatus(status: number): CommentsApiErrorCode {
    switch (status) {
        case 400: return 'invalid_request';
        case 403: return 'forbidden';
        case 404: return 'not_found';
        case 413: return 'too_large';
        case 429: return 'rate_limited';
        default: return 'server_error';
    }
}

async function request<T>(url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T | undefined> {
    const hasBody = init?.body !== undefined;
    let response: Response;
    try {
        response = await fetch(url, {
            method: init?.method ?? 'GET',
            // Anonymous visitor identity is the API's HttpOnly `uier_visitor` cookie
            credentials: 'include',
            headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
            body: hasBody ? JSON.stringify(init.body) : undefined
        });
    } catch (error) {
        throw new CommentsApiError('network_error', error instanceof Error ? error.message : 'Network error', 0);
    }

    if (!response.ok) {
        let body: { error?: unknown; message?: unknown } | undefined;
        try {
            body = await response.json() as typeof body;
        } catch {
            body = undefined;
        }

        // Readable cross-origin only when the API exposes it (Access-Control-Expose-Headers)
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new CommentsApiError(
            typeof body?.error === 'string' ? body.error : errorCodeFromStatus(response.status),
            typeof body?.message === 'string' ? body.message : response.statusText,
            response.status,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }

    if (response.status === 204) {
        return undefined;
    }

    const text = await response.text();
    return text.length ? JSON.parse(text) as T : undefined;
}

function required<T>(value: T | undefined): T {
    if (value === undefined) {
        throw new CommentsApiError('server_error', 'Empty response', 200);
    }
    return value;
}

function commentUrl(commentId: string) {
    return `${commentsApiUrl}/${encodeURIComponent(commentId)}`;
}

export type CreateCommentInput = {
    position: CommentItemPosition;
    text: string;
    quotedText?: string;
    device?: CommentDeviceInfo;
};

async function getComments(path: string) {
    const comments = await request<CommentItem[]>(`${commentsApiUrl}?path=${encodeURIComponent(path)}`);
    return Array.isArray(comments) ? comments : [];
}

async function createComment(path: string, { position, text, quotedText, device }: CreateCommentInput) {
    return required(await request<CommentItem>(commentsApiUrl, {
        method: 'POST',
        body: { path, position, text, quotedText, device }
    }));
}

async function replyToComment({ commentId, text }: { commentId: string; text: string }) {
    return required(await request<CommentItem>(`${commentUrl(commentId)}/replies`, {
        method: 'POST',
        body: { text }
    }));
}

async function resolveComment({ commentId, resolved }: { commentId: string; resolved: boolean }) {
    return required(await request<CommentItem>(commentUrl(commentId), {
        method: 'PATCH',
        body: { resolved }
    }));
}

async function deleteComment(commentId: string) {
    await request<void>(commentUrl(commentId), { method: 'DELETE' });
}

async function deleteReply({ commentId, itemId }: { commentId: string; itemId: string }) {
    // 204, or 200 with the updated comment
    return await request<CommentItem>(`${commentUrl(commentId)}/replies/${encodeURIComponent(itemId)}`, {
        method: 'DELETE'
    });
}

export function commentsQueryKey(path: string) {
    return ['comments', path] as const;
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
    delete: UseMutationResult<void, Error, string, unknown>;
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
    const handleSettled = () => {
        // Also picks up other visitors' changes; the comment is gone on `not_found`
        client.invalidateQueries({ queryKey });
    };

    const create = useMutation({
        mutationFn: (input: CreateCommentInput) => createComment(path, input),
        onSuccess: handleCommentChanged,
        onSettled: handleSettled
    });

    const reply = useMutation({
        mutationFn: replyToComment,
        onSuccess: handleCommentChanged,
        onSettled: handleSettled
    });

    const resolve = useMutation({
        mutationFn: resolveComment,
        onSuccess: handleCommentChanged,
        onSettled: handleSettled
    });

    const remove = useMutation({
        mutationFn: deleteComment,
        onSuccess: (_, commentId) => {
            updateCachedComments(client, path, (comments) => comments.filter(c => c.id !== commentId));
        },
        onSettled: handleSettled
    });

    const removeReply = useMutation({
        mutationFn: deleteReply,
        onSuccess: (comment, { commentId, itemId }) => {
            if (comment) {
                handleCommentChanged(comment);
            } else {
                updateCachedComments(client, path, (comments) => comments.map(c => c.id === commentId
                    ? { ...c, thread: { ...c.thread, items: c.thread.items.filter(i => i.id !== itemId) } }
                    : c));
            }
        },
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
