import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommentItem } from '../components/@types/Comments';
import { apiRequest, commentsQueryKeyPrefix, required, screenshotQueryKey } from './api';
import { commentUrl, mergeReadCursor } from './useComments';

export function useReplaceScreenshot(comment: CommentItem) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (screenshot: string) => required(await apiRequest<CommentItem>(`${commentUrl(comment.id)}/screenshot`, {
            method: 'POST', body: { screenshot, expectedRevision: comment.screenshot?.revision ?? null }
        })),
        onSuccess: async (saved, screenshot) => {
            // Cancel in-flight reads before dropping superseded image bytes from this client.
            await client.cancelQueries({ queryKey: screenshotQueryKey(comment.id) });
            client.removeQueries({ queryKey: screenshotQueryKey(comment.id) });
            client.setQueryData([...screenshotQueryKey(comment.id), saved.screenshot?.revision ?? null], screenshot);
            client.setQueriesData<CommentItem[]>({ queryKey: commentsQueryKeyPrefix }, current =>
                current?.map(item => item.id === saved.id ? mergeReadCursor(saved, item.activity?.readSequence) : item));
        },
        onSettled: () => { void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
}
