import { z } from 'zod';
import { feedbackStages, type FeedbackStage } from '@uier/toolbar/verification';

/**
 * How a column of a project's board orders its cards. Saved on the project (`DbProject.boardSorts`), so
 * everyone who opens the board sees the same order. Browser-safe: the board and the server share it.
 */
export const boardSorts = ['priority', 'newest', 'oldest', 'updated', 'completed'] as const;
export type BoardSort = typeof boardSorts[number];
/** A choice per column; a column without one uses its default (`defaultBoardSort`) */
export type BoardSorts = Partial<Record<FeedbackStage, BoardSort>>;

const activeSorts: readonly BoardSort[] = ['priority', 'newest', 'oldest', 'updated'];
const doneSorts: readonly BoardSort[] = ['completed', 'priority', 'newest', 'oldest', 'updated'];

/** The column's choices, its default first: Done also offers Recently completed */
export function boardSortOptions(status: FeedbackStage): readonly BoardSort[] {
    return status === 'done' ? doneSorts : activeSorts;
}

/** Today's order: active columns by priority, then newest number; Done by the most recent completion */
export function defaultBoardSort(status: FeedbackStage): BoardSort {
    return boardSortOptions(status)[0]!;
}

/** The column's saved choice, or its default for a missing value or one the column does not offer */
export function boardSort(sorts: BoardSorts | undefined, status: FeedbackStage): BoardSort {
    const saved = sorts?.[status];
    return saved && boardSortOptions(status).includes(saved) ? saved : defaultBoardSort(status);
}

/** Every column's sort, defaults included */
export function boardSortsOf(sorts: BoardSorts | undefined) {
    return Object.fromEntries(feedbackStages.map(status => [status, boardSort(sorts, status)])) as Record<FeedbackStage, BoardSort>;
}

/** A column and one of its choices */
export const boardSortInputSchema = z.object({
    status: z.enum(feedbackStages),
    sort: z.enum(boardSorts)
}).refine(({ status, sort }) => boardSortOptions(status).includes(sort), 'Choose a sort this column offers.');

/**
 * The project with the column's sort: only choices other than a column's default are kept (none: no field),
 * and saved values a column does not offer are dropped.
 */
export function withBoardSort<T extends { boardSorts?: BoardSorts }>(project: T, status: FeedbackStage, sort: BoardSort): T {
    const sorts: BoardSorts = {};
    for (const stage of feedbackStages) {
        const chosen = stage === status ? sort : boardSort(project.boardSorts, stage);
        if (chosen !== defaultBoardSort(stage)) sorts[stage] = chosen;
    }
    const { boardSorts: _previous, ...rest } = project;
    return (Object.keys(sorts).length ? { ...rest, boardSorts: sorts } : rest) as T;
}
