import { APP_COUNTERS_PARTITION, consume, rateLimitIpBucket } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { actorAuthorId } from '../review/actor';
import type { QuerySource } from './service';

/** Actor limits span projects; guest identity rotation still consumes a normalized network bucket. */
export async function enforceQueryReadLimits(request: Request, sources: QuerySource[]) {
    const store = getCommentsStore();
    const actor = sources[0]?.actor;
    const identity = actor ? actorAuthorId(actor) : undefined;
    const network = rateLimitIpBucket(request);
    if ((!actor || actor.kind !== 'member') && network) await consume(store, APP_COUNTERS_PARTITION, {
        key: `comment-query-network:${network}`, limit: 600, windowSeconds: 60, reason: 'too_fast',
        message: 'Wait a moment before searching again.'
    });
    await consume(store, APP_COUNTERS_PARTITION, {
        key: `comment-query-actor:${identity ?? network ?? 'anonymous'}`, limit: 240, windowSeconds: 60, reason: 'too_fast',
        message: 'Wait a moment before searching again.'
    });
}
