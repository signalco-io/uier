import type { DbComment } from '../db/schema';

/** Match threads opened by the author or containing one of their remaining replies. */
export function matchesAuthor(comment: DbComment, authorId?: string) {
    return authorId === undefined || comment.authorId === authorId
        || comment.thread?.items.some(item => !item.deletedAt && item.authorId === authorId);
}

export function authorSql(authorId?: string) {
    return authorId === undefined ? { clause: '', parameters: [] } : {
        clause: ' AND (c.authorId = @authorId OR EXISTS(SELECT VALUE i FROM i IN c.thread.items WHERE i.authorId = @authorId AND NOT IS_STRING(i.deletedAt)))',
        parameters: [{ name: '@authorId', value: authorId }]
    };
}
