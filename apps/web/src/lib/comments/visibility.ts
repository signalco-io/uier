import type { DbComment } from '../db/schema';
import { isPrivateAppFeedback } from './publicProject';

/** Public showcase threads are author-only when private or about an app page. */
export function isVisible(comment: Pick<DbComment, 'domain' | 'path' | 'private' | 'authorId'>,
    context: { visitor: { authorId?: string } }) {
    return !(comment.private || isPrivateAppFeedback(comment))
        || (Boolean(comment.authorId) && comment.authorId === context.visitor.authorId);
}
