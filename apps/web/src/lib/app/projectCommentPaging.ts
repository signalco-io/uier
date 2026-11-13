import type { StatusWorkflow } from './statusWorkflow';
import { defaultStatusWorkflow } from './statusWorkflow';
import type { BoardColumn, BoardSort } from './boardSort';
import type { StatusFilter } from '../../components/app/comments/commentLabels';
import type { CommentsQuery } from '../../components/app/comments/commentsQuery';

export const PROJECT_COMMENT_PAGE_SIZE = 25;
export const PROJECT_COMMENT_MAX_DEPTH = 8;
export type CommentLane = string;
export const labelLaneKey = (status: string, label: string) => `${status}~${label}`;
export function selectedGroupLabels(project: { boardGroupByLabel?: boolean; boardGroupLabelIds?: string[] }, labels: { id: string }[]) {
    return project.boardGroupByLabel ? labels.filter(label => project.boardGroupLabelIds === undefined || project.boardGroupLabelIds.includes(label.id)).map(label => label.id) : false;
}
export const labelLaneMatches = (labels: { id: string }[] | undefined, label: string, selected?: string[]) => label === 'unlabeled' ? !labels?.some(value => !selected || selected.includes(value.id)) : Boolean(labels?.some(value => value.id === label));
export type CommentPage = { ids: string[]; total: number; nextCursor: string | null };
export type ProjectCommentPaging = {
    key: string;
    lanes: Partial<Record<CommentLane, CommentPage>>;
    statusCounts: Record<StatusFilter, number>;
    statusUnread: Record<StatusFilter, number>;
    queryTooExpensive?: boolean;
    pages: { path: string; count: number }[];
    historySources: string[];
    scopeTotal: number;
    matchedTotal: number;
    unreadCount: number;
};
export type ProjectCommentPageInput = { lane?: CommentLane; cursor?: string; depths?: Partial<Record<CommentLane, number>>; archiveExpanded?: boolean; openId?: string; signal?: AbortSignal; revisionOnly?: boolean; budgetFallback?: boolean;
    /** Every id in `lane`, not one page of it (Archive all in a board column, uier #357); with `revisionOnly`, no rows are read */
    allIds?: boolean };

/** No open-thread id in the ordinary key: opening a card must not restart its column. */
export function projectCommentPageKey(query: CommentsQuery, sorts: Record<BoardColumn, BoardSort>, archiveExpanded: boolean, workflow: StatusWorkflow = defaultStatusWorkflow, projectId = '', groupByLabel: false | string[] = false) {
    return JSON.stringify([projectId, query.environment ?? 'all', query.author ?? '', query.q ?? '', query.priority ?? '', query.label ?? '', Boolean(query.unread), query.people, query.page ?? '', query.status, query.view, sorts, archiveExpanded, workflow, groupByLabel]);
}
