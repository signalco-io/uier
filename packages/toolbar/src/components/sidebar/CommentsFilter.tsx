import type { CommentItem } from '../@types/Comments';

export type CommentsStatusFilter = 'unresolved' | 'resolved' | 'all';

/**
 * Which pages the inbox lists: this page (the default), all of the site's pages, or one other
 * page (`page:<key>`, see `inboxPageKey`)
 */
export type CommentsPageFilter = 'current' | 'all' | `page:${string}`;

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

/** What a search looks through: the messages, quotes, authors, the page and the public id (`#12`) */
function searchableText(comment: CommentItem) {
    return [
        comment.number !== undefined ? `#${comment.number}` : '',
        comment.path,
        comment.assignee?.name ?? '',
        ...comment.thread.items.flatMap(item => item.deleted
            ? []
            : [item.text, item.quotedText ?? '', item.author?.name ?? '', ...(item.mentions ?? []).map(mention => mention.name ?? '')])
    ].join('\n').toLocaleLowerCase();
}

/** Whether the comment has the status and every word of the search (pages are chosen separately) */
export function matchesFilter(comment: CommentItem, filter: CommentsFilter) {
    if (!matchesStatus(comment, filter.status)) {
        return false;
    }
    return matchesSearch(comment, filter);
}

export function matchesStatus(comment: CommentItem, status: CommentsStatusFilter) {
    return status === 'all' || comment.resolved === (status === 'resolved');
}

/** Everything but the status: assigned to me, unread and the words of the search */
export function matchesSearch(comment: CommentItem, filter: CommentsFilter) {
    if (filter.assignedToMe && !comment.assignee?.isMe) return false;
    if (filter.unread && !comment.activity?.unread) return false;

    const words = filter.keywords?.toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
    if (!words.length) {
        return true;
    }
    const text = searchableText(comment);
    return words.every(word => text.includes(word));
}
