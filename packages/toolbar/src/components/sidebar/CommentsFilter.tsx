import type { CommentItem } from '../@types/Comments';

export type CommentsStatusFilter = 'unresolved' | 'resolved' | 'all';

export type CommentsFilter = {
    keywords?: string;
    status: CommentsStatusFilter;
};

/** What a search looks through: the messages, quotes, authors, the page and the public id (`#12`) */
function searchableText(comment: CommentItem) {
    return [
        comment.number !== undefined ? `#${comment.number}` : '',
        comment.path,
        ...comment.thread.items.flatMap(item => item.deleted
            ? []
            : [item.text, item.quotedText ?? '', item.author?.name ?? ''])
    ].join('\n').toLocaleLowerCase();
}

/** Whether the comment has the status and every word of the search */
export function matchesFilter(comment: CommentItem, filter: CommentsFilter) {
    if (filter.status !== 'all' && comment.resolved !== (filter.status === 'resolved')) {
        return false;
    }

    const words = filter.keywords?.toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
    if (!words.length) {
        return true;
    }
    const text = searchableText(comment);
    return words.every(word => text.includes(word));
}
