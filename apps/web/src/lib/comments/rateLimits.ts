import type { CommentsStore } from '../repo/commentsStore';
import { keyedHash } from './environment';
import { apiErrors } from './http';
import {
    APP_REWRITES_WINDOW_SECONDS,
    DOMAIN_REWRITES_WINDOW_SECONDS,
    PAGE_COMMENTS_WINDOW_SECONDS,
    RATE_LIMIT_APP_REWRITES,
    RATE_LIMIT_DOMAIN_REWRITES,
    RATE_LIMIT_IP_REWRITES,
    RATE_LIMIT_VISITOR_REWRITES,
    RATE_LIMIT_IP_WRITES,
    RATE_LIMIT_PAGE_COMMENTS,
    RATE_LIMIT_VISITOR_COMMENTS,
    RATE_LIMIT_VISITOR_REPLIES,
    RATE_LIMIT_WINDOW_SECONDS
} from './limits';

/**
 * Counters that are not about one site live in the comments container under this partition: the
 * app's sign-in emails and invitations, and the app-wide rewrite limits.
 */
export const APP_COUNTERS_PARTITION = 'app';

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

const tooManyRewrites = 'You are asking for suggestions too quickly. Please try again later.';

export type RewriteLimitSubject = {
    /** The site's partition: the request's domain, or `project:<code>` */
    domain: string;
    /** The visitor or reviewer; missing for a visitor without the `uier_visitor` cookie (not counted per visitor) */
    authorId?: string;
    /** IPv4 address or IPv6 /64; missing when the IP limit doesn't apply (local loopback requests) */
    ipBucket?: string;
};

/**
 * Rewrite suggestions call a paid AI model. Counted per visitor and per site in the site's
 * partition, then per IP and in total in the app-wide partition, so many sites or projects don't
 * add up to more. Checked before the model call; the app-wide budget last, so it counts only
 * requests that get to the model.
 */
export async function enforceRewriteLimits(store: CommentsStore, subject: RewriteLimitSubject) {
    await consumeAll(store, subject.domain, [
        ...(subject.authorId
            ? [{ key: `visitor-rewrites:${subject.authorId}`, limit: RATE_LIMIT_VISITOR_REWRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast' as const, message: tooManyRewrites }]
            : []),
        { key: 'domain-rewrites', limit: RATE_LIMIT_DOMAIN_REWRITES, windowSeconds: DOMAIN_REWRITES_WINDOW_SECONDS, reason: 'too_fast', message: 'Suggestions for this site have reached their limit for today. Please try again tomorrow.' }
    ]);
    await consumeAll(store, APP_COUNTERS_PARTITION, [
        ...(subject.ipBucket
            ? [{ key: `rewrites-ip:${subject.ipBucket}`, limit: RATE_LIMIT_IP_REWRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast' as const, message: tooManyRewrites }]
            : []),
        { key: 'rewrites', limit: RATE_LIMIT_APP_REWRITES, windowSeconds: APP_REWRITES_WINDOW_SECONDS, reason: 'too_fast', message: 'Suggestions have reached their limit for today. Please try again tomorrow.' }
    ]);
}
