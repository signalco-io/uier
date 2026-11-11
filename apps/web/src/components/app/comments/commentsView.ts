import type { CommentsView } from './commentLabels';

/** The List/Board choice a person last made, for every project in this browser */
const storageKey = 'uier:comments-view';

/** The remembered view, or `undefined` when there is none or storage is blocked */
export function storedCommentsView(): CommentsView | undefined {
    try {
        const value = window.localStorage.getItem(storageKey);
        return value === 'list' || value === 'board' ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Remembers a view the person chose (List/Board, G then I or B); blocked storage only loses the memory */
export function rememberCommentsView(view: CommentsView) {
    try {
        window.localStorage.setItem(storageKey, view);
    } catch { /* Private windows and blocked site data: the address still holds the view. */ }
}
