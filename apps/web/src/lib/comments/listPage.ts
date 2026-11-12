import { apiErrors } from './http';
import { MAX_LIST_COMMENTS } from './limits';
import { isValidId } from './validation';
import { parseCommentPageCursor, type CommentPageCursor } from '../repo/commentPage';

/**
 * Keyset paging of a review list, newest first (`repo/commentPage.ts`): `?limit=` (1 to 200) and
 * `?before=<createdAt>|<id>`, the `next` of the page before. Either one asks for a paged response,
 * `{ comments, next }`; a list request with neither keeps its earlier plain-array response. The toolbar's
 * inbox loads its lists this way as the reader scrolls (`packages/toolbar/src/hooks/useComments.tsx`).
 */
export type ListPage = { limit: number; before?: CommentPageCursor };

const maxCursorTimeLength = 40;

/** The page a list request asks for (`undefined`: not paged); an invalid `limit` or `before` is a 400 */
export function listPage(params: URLSearchParams): ListPage | undefined {
    const limitParam = params.get('limit');
    const cursor = params.get('before');
    if (limitParam === null && cursor === null) return undefined;
    const limit = limitParam === null ? MAX_LIST_COMMENTS : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_COMMENTS)
        throw apiErrors.invalidRequest(`"limit" must be a whole number from 1 to ${MAX_LIST_COMMENTS}.`);
    if (cursor === null) return { limit };
    const before = parseCommentPageCursor(cursor);
    if (!before || before.createdAt.length > maxCursorTimeLength || Number.isNaN(Date.parse(before.createdAt)) || !isValidId(before.id))
        throw apiErrors.invalidRequest('"before" must be the "next" of a listed page.');
    return { limit, before };
}
