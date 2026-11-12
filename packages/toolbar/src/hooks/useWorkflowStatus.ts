import { useProjectViewer } from '../project/ProjectGate';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, required, currentReviewerRevision, commentsQueryKeyPrefix, activityQueryKey } from './api';
import { commentUrl, updateCachedComment } from './useComments';
import type { CommentItem } from '../components/@types/Comments';
import type { FeedbackStage } from '../verification';

export type WorkflowStatus = { id: string; category: FeedbackStage | 'archive'; label: string; description: string };
export type WorkflowStatuses = { statuses: WorkflowStatus[]; doneStatusId: string; archiveStatusId: string };

/** The project's workflow statuses (members only), shared by every thread header and pin */
export function useWorkflowStatuses() {
    const { isMember } = useProjectViewer();
    const workflow = useQuery({ queryKey: ['review-statuses', toolbarConfig.project, currentReviewerRevision()], enabled: Boolean(toolbarConfig.project && isMember),
        queryFn: () => apiRequest<WorkflowStatuses>(`${toolbarConfig.apiUrl}/api/review/${encodeURIComponent(toolbarConfig.project!)}/statuses`).then(required), staleTime: 30_000 });
    return { ...workflow, data: isMember && !workflow.error ? workflow.data : undefined };
}

/**
 * The thread's status within its category (`feedbackStage`, or archive): the custom status it names, else the
 * category's default (Done, Archive) or first. Undefined without the project's statuses (guests).
 */
export function selectedWorkflowStatus(comment: Pick<CommentItem, 'archivedAt' | 'archiveStatusId' | 'workflowStatusId'>, stage: FeedbackStage, workflow: WorkflowStatuses | undefined) {
    const selectedStatusId = comment.archivedAt ? comment.archiveStatusId : comment.workflowStatusId;
    const category = comment.archivedAt ? 'archive' : stage;
    const fallbackId = category === 'archive' ? workflow?.archiveStatusId : category === 'done' ? workflow?.doneStatusId : undefined;
    return workflow?.statuses.find(status => status.id === selectedStatusId && status.category === category)
        ?? workflow?.statuses.find(status => status.id === fallbackId && status.category === category)
        ?? workflow?.statuses.find(status => status.category === category);
}

export function useWorkflowStatus() {
    const client = useQueryClient();
    const workflow = useWorkflowStatuses();
    const mutation = useMutation({
        mutationFn: ({ commentId, statusId }: { commentId: string; statusId: string }) => apiRequest<CommentItem>(commentUrl(commentId), { method: 'PATCH', body: { statusId } }).then(required),
        onMutate: () => currentReviewerRevision(),
        onSuccess: (comment, _input, revision) => { if (revision === currentReviewerRevision()) updateCachedComment(client, comment); },
        onSettled: () => { void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); void client.invalidateQueries({ queryKey: activityQueryKey }); }
    });
    return { workflow, mutation };
}
