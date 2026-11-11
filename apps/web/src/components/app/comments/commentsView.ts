import type { CommentsView } from './commentLabels';

/**
 * Where a List/Board choice is remembered in this browser: one for every project's comments, and My work's own, so
 * choosing Board for a project's triage does not turn My work's grouped lists into a board too (or the other way round).
 */
export type CommentsViewScope = 'projects' | 'my-work';
const storageKeys: Record<CommentsViewScope, string> = { projects: 'uier:comments-view', 'my-work': 'uier:my-work-view' };

/** The remembered view, or `undefined` when there is none or storage is blocked */
export function storedCommentsView(scope: CommentsViewScope = 'projects'): CommentsView | undefined {
    try {
        const value = window.localStorage.getItem(storageKeys[scope]);
        return value === 'list' || value === 'board' ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Remembers a view the person chose (List/Board, G then I or B); blocked storage only loses the memory */
export function rememberCommentsView(view: CommentsView, scope: CommentsViewScope = 'projects') {
    try {
        window.localStorage.setItem(storageKeys[scope], view);
    } catch { /* Private windows and blocked site data: the address still holds the view. */ }
}
