import { readyForReview } from '../../verification';
import { matchesFeedbackSearch } from '../../triage';
import type { CommentItem } from '../@types/Comments';

export type CommentsStatusFilter = 'unresolved' | 'ready' | 'resolved' | 'all';

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
    return status === 'ready' ? readyForReview(comment) : status === 'all' || comment.resolved === (status === 'resolved');
}

/** Everything but the status: assigned to me, unread and the words of the search */
export function matchesSearch(comment: CommentItem, filter: CommentsFilter) {
    if (filter.assignedToMe && !comment.assignee?.isMe) return false;
    if (filter.unread && !comment.activity?.unread) return false;

    return matchesFeedbackSearch({ number: comment.number, path: comment.path, messages: comment.thread.items,
        context: [comment.assignee?.name ?? '', ...comment.thread.items.flatMap(item => item.deleted ? [] : [item.author?.name ?? '', ...(item.mentions ?? []).map(mention => mention.name ?? '')])] }, filter.keywords ?? '');
}
