import { feedbackStage, feedbackStageLabels, feedbackStages, type FeedbackStage } from '@uier/toolbar/verification';

export const statusCategories = [...feedbackStages, 'archive'] as const;
export type StatusCategory = typeof statusCategories[number];
export type WorkflowStatus = { id: string; category: StatusCategory; label: string; description: string };
/** Array order is the workflow order within each immutable semantic category. */
export type StatusWorkflow = { verificationEnabled?: boolean; statuses: WorkflowStatus[]; initialStatusId: string; doneStatusId: string; archiveStatusId: string };
export const statusCategoryLabels: Record<StatusCategory, string> = { ...feedbackStageLabels, archive: 'Archive' };
export const defaultStatusWorkflow: StatusWorkflow = {
    statuses: statusCategories.map(category => ({ id: category, category, label: statusCategoryLabels[category], description: '' })),
    initialStatusId: 'open', doneStatusId: 'done', archiveStatusId: 'archive'
};
export type WorkflowComment = { resolved?: boolean; inProgress?: boolean; verificationEnabled?: boolean; verification?: Parameters<typeof feedbackStage>[0]['verification']; archivedAt?: string; workflowStatusId?: string; archiveStatusId?: string };
export function orderedStatuses(workflow: StatusWorkflow) {
    return statusCategories.flatMap(category => workflow.statuses.filter(status => status.category === category && (workflow.verificationEnabled !== false || category !== 'ready')));
}
export function defaultStatus(workflow: StatusWorkflow, category: StatusCategory) {
    const id = category === 'done' ? workflow.doneStatusId : category === 'archive' ? workflow.archiveStatusId : undefined;
    return workflow.statuses.find(status => status.category === category && status.id === id)
        ?? workflow.statuses.find(status => status.category === category)!;
}
/** Removed/foreign IDs and category changes fall back without rewriting historical threads. */
export function statusForComment(workflow: StatusWorkflow, comment: WorkflowComment, includeArchive = true): WorkflowStatus {
    const category: StatusCategory = includeArchive && comment.archivedAt ? 'archive' : feedbackStage({ ...comment, verificationEnabled: workflow.verificationEnabled ?? comment.verificationEnabled });
    const id = category === 'archive' ? comment.archiveStatusId : comment.workflowStatusId;
    return workflow.statuses.find(status => status.id === id && status.category === category) ?? defaultStatus(workflow, category);
}
export function workflowStatusPatch(workflow: StatusWorkflow, category: FeedbackStage) {
    return { workflowStatusId: defaultStatus(workflow, category).id };
}

/** Translate unchanged built-ins only; names authored by members stay as saved. */
export function workflowStatusLabel(status: WorkflowStatus, t: (label: string) => string) {
    return status.id === status.category && status.label === statusCategoryLabels[status.category] ? t(status.label) : status.label;
}
