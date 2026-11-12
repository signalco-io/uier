import { useProjectViewer } from '../project/ProjectGate';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, required, currentReviewerRevision, commentsQueryKeyPrefix, activityQueryKey } from './api';
import { commentUrl, updateCachedComment } from './useComments';
import type { CommentItem } from '../components/@types/Comments';
import type { FeedbackStage } from '../verification';

export type WorkflowStatus = { id: string; category: FeedbackStage | 'archive'; label: string; description: string };
export function useWorkflowStatus() {
    const client = useQueryClient();
    const { isMember } = useProjectViewer();
    const workflow = useQuery({ queryKey: ['review-statuses', toolbarConfig.project, currentReviewerRevision()], enabled: Boolean(toolbarConfig.project && isMember),
        queryFn: () => apiRequest<{ statuses: WorkflowStatus[]; doneStatusId: string; archiveStatusId: string }>(`${toolbarConfig.apiUrl}/api/review/${encodeURIComponent(toolbarConfig.project!)}/statuses`).then(required), staleTime: 30_000 });
    const mutation = useMutation({
        mutationFn: ({ commentId, statusId }: { commentId: string; statusId: string }) => apiRequest<CommentItem>(commentUrl(commentId), { method: 'PATCH', body: { statusId } }).then(required),
        onMutate: () => currentReviewerRevision(),
        onSuccess: (comment, _input, revision) => { if (revision === currentReviewerRevision()) updateCachedComment(client, comment); },
        onSettled: () => { void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); void client.invalidateQueries({ queryKey: activityQueryKey }); }
    });
    return { workflow: { ...workflow, data: isMember && !workflow.error ? workflow.data : undefined }, mutation };
}
