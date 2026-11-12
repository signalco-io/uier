import { feedbackStages, type FeedbackStage } from '@uier/toolbar/verification';
import { boardSortOptions, defaultBoardSort, type BoardColumn, type BoardSort } from '../../../lib/app/boardSort';

/** My work's lists, in the order they show */
export const myWorkGroups = ['assigned', 'mentions', 'unread'] as const;
export type MyWorkGroup = typeof myWorkGroups[number];

/** What My work sorts: each list, and each column of its board */
export type MyWorkSortKey = MyWorkGroup | FeedbackStage;
export type MyWorkSorts = Record<MyWorkSortKey, BoardSort>;

/** The board column whose choices a list or column offers: a list sorts like an active column (priority by default) */
export function myWorkSortColumn(key: MyWorkSortKey): BoardColumn {
    return (myWorkGroups as readonly string[]).includes(key) ? 'open' : key as FeedbackStage;
}

const keys: readonly MyWorkSortKey[] = [...myWorkGroups, ...feedbackStages];
export const defaultMyWorkSorts = Object.fromEntries(keys.map(key => [key, defaultBoardSort(myWorkSortColumn(key))])) as MyWorkSorts;

/**
 * Remembered in this browser only, like My work's List/Board (`commentsView.ts`): My work is one person's, so its order
 * is too, apart from the sorts a project's board saves for everyone
 */
const storageKey = 'uier:my-work-sorts';

/** The remembered sorts, the defaults for anything missing, unknown or not offered, or when storage is blocked */
export function storedMyWorkSorts(): MyWorkSorts {
    try {
        const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
        const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
        return Object.fromEntries(keys.map(key => {
            const value = record[key];
            return [key, typeof value === 'string' && boardSortOptions(myWorkSortColumn(key)).includes(value as BoardSort) ? value : defaultMyWorkSorts[key]];
        })) as MyWorkSorts;
    } catch {
        return defaultMyWorkSorts;
    }
}

/** Remembers the sorts that differ from their defaults; blocked storage only loses the memory */
export function rememberMyWorkSorts(sorts: MyWorkSorts) {
    const chosen = Object.fromEntries(keys.flatMap(key => sorts[key] === defaultMyWorkSorts[key] ? [] : [[key, sorts[key]]]));
    try {
        if (Object.keys(chosen).length) window.localStorage.setItem(storageKey, JSON.stringify(chosen));
        else window.localStorage.removeItem(storageKey);
    } catch { /* Private windows and blocked site data: the order lasts until the page is opened again. */ }
}
