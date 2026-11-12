import type { SqlParameter } from '@azure/cosmos';
import type { ArchiveFilter } from './archiveFilter';
import type { OriginFilter } from './originFilter';
import type { VisibilityFilter } from './visibilityFilter';

/**
 * Keyset paging of a partition's comments, newest first: by `createdAt`, then by id for equal times (descending). A page
 * is what is strictly older than the cursor (the last comment the caller has), so comments added or removed meanwhile
 * never shift a later page: it is a live view, not a snapshot. Storage applies the cursor and every filter before the
 * limit (`CommentsStore.listPage`), so no window of newest records bounds what paging can reach.
 */
export type CommentPageCursor = { createdAt: string; id: string };

export type CommentPageOptions = {
    /** 1 to 1000 */
    limit: number;
    before?: CommentPageCursor;
    /** One page's comments (the canonical key and legacy query-string records, as `list`); every page without it */
    path?: string;
    originFilter?: OriginFilter;
    authorId?: string;
    archive?: ArchiveFilter;
    /** The threads the reader may see, in storage; callers still check each thread (`canSeeComment`) */
    visibility?: VisibilityFilter;
};

type Keyed = { id: string; createdAt?: string };

/** The cursor that continues after `comment` */
export function commentPageCursor(comment: Keyed): CommentPageCursor {
    return { createdAt: comment.createdAt ?? '', id: comment.id };
}

/** Its wire form, `<createdAt>|<id>` (ids never contain `|`) */
export function formatCommentPageCursor(cursor: CommentPageCursor) {
    return `${cursor.createdAt}|${cursor.id}`;
}

/** The wire form back, or `undefined` when it is not one; callers validate the id and time */
export function parseCommentPageCursor(value: string): CommentPageCursor | undefined {
    const separator = value.lastIndexOf('|');
    if (separator < 1) return undefined;
    return { createdAt: value.slice(0, separator), id: value.slice(separator + 1) };
}

/** Newest first, the id breaking ties (descending), as storage orders a page */
export function newestCommentFirst(a: Keyed, b: Keyed) {
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Whether the comment comes after the cursor in that order */
export function isAfterCursor(comment: Keyed, before?: CommentPageCursor) {
    return !before || newestCommentFirst(comment, before) > 0;
}

/** The cursor as a parameterized clause (ISO 8601 times compare as text) */
export function commentPageCursorSql(before?: CommentPageCursor): { clause: string; parameters: SqlParameter[] } {
    if (!before) return { clause: '', parameters: [] };
    return {
        clause: ' AND (c.createdAt < @beforeAt OR (c.createdAt = @beforeAt AND c.id < @beforeId))',
        parameters: [{ name: '@beforeAt', value: before.createdAt }, { name: '@beforeId', value: before.id }]
    };
}

/**
 * One page from a query ordered by `createdAt` only (a two-property ORDER BY needs a composite index the container does
 * not have): the first `limit` records, and every record at the time of the last one (`ties`, ordered by id), so the id
 * decides inside a time and the page ends at the same place each time it is read.
 */
export async function completeCommentPage<T extends Keyed>(first: T[], limit: number, ties: (createdAt: string) => Promise<T[]>): Promise<T[]> {
    if (first.length < limit) return [...first].sort(newestCommentFirst);
    const last = first.at(-1)!.createdAt ?? '';
    const tied = await ties(last);
    const ids = new Set(tied.map(comment => comment.id));
    return [...first.filter(comment => comment.createdAt !== last && !ids.has(comment.id)), ...tied].sort(newestCommentFirst).slice(0, limit);
}
