import type { CommentsView } from './commentLabels';
import { commentsViewCookieNames, parseCommentsView } from '@/src/lib/app/commentsViewPreference';

/**
 * Where a List/Board choice is remembered in this browser: one for every project's comments, and My work's own, so
 * choosing Board for a project's triage does not turn My work's grouped lists into a board too (or the other way round).
 */
export type CommentsViewScope = 'projects' | 'my-work';
const storageKeys: Record<CommentsViewScope, string> = { projects: 'uier:comments-view', 'my-work': 'uier:my-work-view' };

/** The remembered view, or `undefined` when there is none or storage is blocked */
export function storedCommentsView(scope: CommentsViewScope = 'projects'): CommentsView | undefined {
    if (scope === 'projects') {
        try {
            const name = location.protocol === 'https:' ? commentsViewCookieNames.secure : commentsViewCookieNames.local;
            const saved = parseCommentsView(document.cookie.split('; ').find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1));
            if (saved) return saved;
        } catch { /* Fall back to the older localStorage preference. */ }
    }
    try {
        return parseCommentsView(window.localStorage.getItem(storageKeys[scope]));
    } catch {
        return undefined;
    }
}

/** Remembers a view the person chose (List/Board, G then I or B); blocked storage only loses the memory */
export function rememberCommentsView(view: CommentsView, scope: CommentsViewScope = 'projects') {
    try {
        window.localStorage.setItem(storageKeys[scope], view);
    } catch { /* Private windows and blocked site data: the address still holds the view. */ }
    if (scope === 'projects') {
        try {
            const secure = location.protocol === 'https:';
            const name = secure ? commentsViewCookieNames.secure : commentsViewCookieNames.local;
            document.cookie = `${name}=${view}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
        } catch { /* localStorage can still remember it when cookies are blocked. */ }
    }
}
