import { apiErrors } from './http';
import { MAX_LIST_COMMENTS } from './limits';
import { isValidId } from './validation';

/**
 * Keyset paging for a list of comments, newest first: `?limit=` (1 to 200, the default 200) and `?before=<createdAt>|<id>`,
 * the last comment the caller has. The next page is what is older than it (`createdAt`, then the id for equal times),
 * so comments added or removed meanwhile never shift a page: it is a live view, not a snapshot. The toolbar's inbox
 * loads its site list this way as the reader scrolls (`packages/toolbar/src/hooks/useComments.tsx`).
 */
export type ListPage = { limit: number; before?: { createdAt: string; id: string } };

const maxCursorTimeLength = 40;

/** The page a list request asks for; an invalid `limit` or `before` is a 400 */
export function listPage(params: URLSearchParams): ListPage {
    const limitParam = params.get('limit');
    const limit = limitParam === null ? MAX_LIST_COMMENTS : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_COMMENTS)
        throw apiErrors.invalidRequest(`"limit" must be a whole number from 1 to ${MAX_LIST_COMMENTS}.`);
    const cursor = params.get('before');
    if (cursor === null) return { limit };
    const separator = cursor.lastIndexOf('|');
    const createdAt = cursor.slice(0, separator);
    const id = cursor.slice(separator + 1);
    if (separator < 1 || createdAt.length > maxCursorTimeLength || Number.isNaN(Date.parse(createdAt)) || !isValidId(id))
        throw apiErrors.invalidRequest('"before" must be the "<createdAt>|<id>" of a listed comment.');
    return { limit, before: { createdAt, id } };
}

/** Newest first, the id breaking ties, as the cursor compares them */
function newerFirst(a: { id: string; createdAt?: string }, b: { id: string; createdAt?: string }) {
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** One page of the comments: those older than the cursor, at most `limit` */
export function pageOfComments<T extends { id: string; createdAt?: string }>(comments: T[], { limit, before }: ListPage): T[] {
    const sorted = [...comments].sort(newerFirst);
    const older = before ? sorted.filter(comment => newerFirst(comment, { id: before.id, createdAt: before.createdAt }) > 0) : sorted;
    return older.slice(0, limit);
}
