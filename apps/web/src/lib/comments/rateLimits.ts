import type { CommentsStore } from '../repo/commentsStore';
import { keyedHash } from './environment';
import { apiErrors } from './http';
import {
    PAGE_COMMENTS_WINDOW_SECONDS,
    RATE_LIMIT_IP_WRITES,
    RATE_LIMIT_PAGE_COMMENTS,
    RATE_LIMIT_VISITOR_COMMENTS,
    RATE_LIMIT_VISITOR_REPLIES,
    RATE_LIMIT_WINDOW_SECONDS
} from './limits';

export type RateLimitSubject = {
    domain: string;
    authorId: string;
    /** IPv4 address or IPv6 /64; missing when the IP limit doesn't apply (local loopback requests) */
    ipBucket?: string;
};

export type Limit = {
    /** What is counted, e.g. `visitor-comments:<authorId>` */
    key: string;
    limit: number;
    windowSeconds: number;
    reason: 'too_fast' | 'page_full';
    message: string;
};

/**
 * Counts one write against the limit in the current fixed window. The counter document's id is a
 * keyed hash, so it reveals neither the visitor nor the IP address.
 */
export async function consume(store: CommentsStore, domain: string, { key, limit, windowSeconds, reason, message }: Limit) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSeconds / windowSeconds);
    const id = `counter_${keyedHash('rate-limit', `${key}:${windowSeconds}:${window}`).slice(0, 40)}`;

    // Kept a little longer than the window, so a slow request near its end still finds the counter
    if (!await store.incrementCounter(domain, id, limit, windowSeconds + 300))
        throw apiErrors.rateLimited(message, (window + 1) * windowSeconds - nowSeconds, reason);
}

const tooManyComments = 'You are leaving feedback too quickly. Please try again later.';
const tooManyReplies = 'You are replying too quickly. Please try again later.';

function ipLimit(subject: RateLimitSubject, message: string): Limit[] {
    return subject.ipBucket
        ? [{ key: `ip-writes:${subject.ipBucket}`, limit: RATE_LIMIT_IP_WRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message }]
        : [];
}

/**
 * Limits are checked one after another and each counts the write as it passes, so a write
 * rejected by a later limit still counts against the earlier ones (on the safe side).
 */
async function consumeAll(store: CommentsStore, domain: string, limits: Limit[]) {
    for (const limit of limits)
        await consume(store, domain, limit);
}

export async function enforceNewCommentLimits(store: CommentsStore, subject: RateLimitSubject, path: string) {
    await consumeAll(store, subject.domain, [
        { key: `visitor-comments:${subject.authorId}`, limit: RATE_LIMIT_VISITOR_COMMENTS, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyComments },
        ...ipLimit(subject, tooManyComments),
        { key: `page-comments:${path}`, limit: RATE_LIMIT_PAGE_COMMENTS, windowSeconds: PAGE_COMMENTS_WINDOW_SECONDS, reason: 'page_full', message: 'This page has reached its comment limit for today. Please try again tomorrow.' }
    ]);
}

export async function enforceReplyLimits(store: CommentsStore, subject: RateLimitSubject) {
    await consumeAll(store, subject.domain, [
        { key: `visitor-replies:${subject.authorId}`, limit: RATE_LIMIT_VISITOR_REPLIES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyReplies },
        ...ipLimit(subject, tooManyReplies)
    ]);
}
