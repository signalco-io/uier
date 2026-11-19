import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommentItem } from '../components/@types/Comments';
import type { RecordingClip } from '../recordings';
import { apiRequest, commentsQueryKeyPrefix, CommentsApiError, currentReviewerRevision, required } from './api';
import { commentUrl, mergeReadCursor, uploadCommentRecording } from './useComments';

/**
 * Adds a recording to a saved comment that has none (`POST .../comments/<id>/recording`). The clip is
 * uploaded like a reply's; the upload helper keeps a finished upload's id, so a retry attaches the same
 * recording and the API answers it with the saved comment.
 */
export function useAttachRecording(comment: CommentItem) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (clip: RecordingClip) => {
            const revision = currentReviewerRevision();
            const recordingId = await uploadCommentRecording(clip, revision);
            if (revision !== currentReviewerRevision()) throw new CommentsApiError('sign_in_required', 'The review session changed.', 401);
            return required(await apiRequest<CommentItem>(`${commentUrl(comment.id)}/recording`, { method: 'POST', body: { recordingId } }));
        },
        onMutate: () => currentReviewerRevision(),
        onSuccess: (saved, _clip, revision) => {
            // A reviewer who signed out meanwhile never gets the previous one's thread back
            if (revision !== currentReviewerRevision()) return;
            client.setQueriesData<CommentItem[]>({ queryKey: commentsQueryKeyPrefix }, current =>
                current?.map(item => item.id === saved.id ? mergeReadCursor(saved, item.activity?.readSequence) : item));
        },
        onSettled: () => { void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
}
