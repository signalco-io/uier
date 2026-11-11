import { feedbackStages } from '@uier/toolbar/verification';

/**
 * How a column of a project's board orders its cards. Saved on the project (`DbProject.boardSorts`), so
 * everyone who opens the board sees the same order. Browser-safe: the board and the server share it.
 */
export const boardSorts = ['priority', 'newest', 'oldest', 'updated', 'completed', 'archived'] as const;
export type BoardSort = typeof boardSorts[number];
/** The board's sortable columns: one per status, then Archive, the last */
export const boardColumns = [...feedbackStages, 'archive'] as const;
export type BoardColumn = typeof boardColumns[number];
/** A choice per column; a column without one uses its default (`defaultBoardSort`) */
export type BoardSorts = Partial<Record<BoardColumn, BoardSort>>;

const activeSorts: readonly BoardSort[] = ['priority', 'newest', 'oldest', 'updated'];
const doneSorts: readonly BoardSort[] = ['completed', ...activeSorts];
const archiveSorts: readonly BoardSort[] = ['archived', ...activeSorts];

/** The column's choices, its default first: Done also offers Recently completed, Archive Recently archived */
export function boardSortOptions(status: BoardColumn): readonly BoardSort[] {
    return status === 'done' ? doneSorts : status === 'archive' ? archiveSorts : activeSorts;
}

/** Today's order: active columns by priority, then newest number; Done by the most recent completion, Archive by the most recent archiving */
export function defaultBoardSort(status: BoardColumn): BoardSort {
    return boardSortOptions(status)[0]!;
}

/** The column's saved choice, or its default for a missing value or one the column does not offer */
export function boardSort(sorts: BoardSorts | undefined, status: BoardColumn): BoardSort {
    const saved = sorts?.[status];
    return saved && boardSortOptions(status).includes(saved) ? saved : defaultBoardSort(status);
}

/** Every column's sort, defaults included */
export function boardSortsOf(sorts: BoardSorts | undefined) {
    return Object.fromEntries(boardColumns.map(status => [status, boardSort(sorts, status)])) as Record<BoardColumn, BoardSort>;
}

/**
 * The project with the column's sort: only choices other than a column's default are kept (none: no field),
 * and saved values a column does not offer are dropped.
 */
export function withBoardSort<T extends { boardSorts?: BoardSorts }>(project: T, status: BoardColumn, sort: BoardSort): T {
    const sorts: BoardSorts = {};
    for (const stage of boardColumns) {
        const chosen = stage === status ? sort : boardSort(project.boardSorts, stage);
        if (chosen !== defaultBoardSort(stage)) sorts[stage] = chosen;
    }
    const { boardSorts: _previous, ...rest } = project;
    return (Object.keys(sorts).length ? { ...rest, boardSorts: sorts } : rest) as T;
}
