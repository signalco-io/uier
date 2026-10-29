import type { DbComment } from '../db/schema';
import { commentsContainerName, DEFAULT_COMMENTS_CONTAINER_NAME } from '../db/client';
import { PREVIEW_COMMENT_TTL_SECONDS } from './limits';

/** Related writes must not restart the thread's remaining retention period. */
export function threadRecordTtl(comment: DbComment, maximum = -1, now = Date.now()) {
    const ttl = comment.ttl ?? (commentsContainerName() === DEFAULT_COMMENTS_CONTAINER_NAME ? undefined : PREVIEW_COMMENT_TTL_SECONDS);
    if (!ttl || ttl < 0) return maximum;
    const modified = Date.parse(comment.updatedAt ?? comment.createdAt ?? '');
    const remaining = Math.max(1, Math.floor(((Number.isFinite(modified) ? modified : now) + ttl * 1000 - now) / 1000));
    return maximum > 0 ? Math.min(maximum, remaining) : remaining;
}
