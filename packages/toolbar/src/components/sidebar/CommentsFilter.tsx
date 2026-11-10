import { feedbackStage } from '../../verification';
import { commentAssignees } from '../../agents';
import { matchesFeedbackSearch } from '../../triage';
import type { CommentItem } from '../@types/Comments';

/**
 * `unresolved`: Active, everything not done (Open, In progress and Ready to verify), the default; `open`, `in-progress`
 * and `ready` are the statuses folded under Active, one each; `resolved` is Done. The app's `StatusFilter`.
 */
export type CommentsStatusFilter = 'unresolved' | 'open' | 'in-progress' | 'ready' | 'resolved' | 'all';

/** The statuses folded under Active, each also a filter of its own */
export const activeStatusFilters = ['open', 'in-progress', 'ready'] as const satisfies readonly CommentsStatusFilter[];

/** Whether the status filter shows Active or one of the statuses folded under it */
export function isActiveStatusFilter(status: CommentsStatusFilter) {
    return status === 'unresolved' || (activeStatusFilters as readonly CommentsStatusFilter[]).includes(status);
}

/**
 * Which pages the inbox lists: this page (the default), all of the site's pages, one other
 * page (`page:<key>`, see `inboxPageKey`) or a section (`section:/blog`: that page and every page under it)
 */
export type CommentsPageFilter = 'current' | 'all' | `page:${string}` | `section:${string}`;

/** Whether a page (a relative URL, which can carry its saved query) is in the section `base`, as the app's `/blog/*` filter */
export function inSection(base: string, path: string) {
    return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`);
}

export type CommentsFilter = {
    keywords?: string;
    unread?: boolean;
    status: CommentsStatusFilter;
    assignedToMe?: boolean;
    page?: CommentsPageFilter;
};

/** One page of another thread's list entry: its path, and its environment when it has one */
export function inboxPageKey(comment: CommentItem): `page:${string}` {
    return `page:${comment.source?.environment ?? ''}|${comment.path}`;
}

/** Whether the comment has the status and every word of the search (pages are chosen separately) */
export function matchesFilter(comment: CommentItem, filter: CommentsFilter) {
    if (!matchesStatus(comment, filter.status)) {
        return false;
    }
    return matchesSearch(comment, filter);
}

export function matchesStatus(comment: CommentItem, status: CommentsStatusFilter) {
    if (status === 'all') return true;
    if (status === 'unresolved') return !comment.resolved;
    return feedbackStage(comment) === (status === 'resolved' ? 'done' : status);
}

/** Everything but the status: assigned to me, unread and the words of the search */
export function matchesSearch(comment: CommentItem, filter: CommentsFilter) {
    if (filter.assignedToMe && !commentAssignees(comment).some(person => person.isMe)) return false;
    if (filter.unread && !comment.activity?.unread) return false;

    return matchesFeedbackSearch({ number: comment.number, path: comment.path, messages: comment.thread.items,
        context: [...commentAssignees(comment).map(person => person.name), ...comment.thread.items.flatMap(item => item.deleted ? [] : [item.author?.name ?? '', ...(item.mentions ?? []).map(mention => mention.name ?? '')])] }, filter.keywords ?? '');
}
