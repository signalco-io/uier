import type { CommentsStore } from '../repo/commentsStore';
import { apiErrors } from './http';
import {
    MAX_UNRESOLVED_COMMENTS_PER_PAGE,
    PAGE_FULL_RETRY_AFTER_SECONDS,
    RATE_LIMIT_IP_WRITES,
    RATE_LIMIT_VISITOR_COMMENTS,
    RATE_LIMIT_VISITOR_REPLIES,
    RATE_LIMIT_WINDOW_SECONDS
} from './limits';

export type RateLimitSubject = {
    domain: string;
    authorId: string;
    /** Missing when the IP limit doesn't apply (see `rateLimitIpHash`) */
    ipHash?: string;
};

function windowStart(now: number) {
    return new Date(now - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
}

/** Seconds until enough of the counted writes leave the sliding window to get below the limit */
function retryAfterSeconds(timestamps: string[], limit: number, now: number) {
    const sorted = timestamps
        .map(timestamp => Date.parse(timestamp))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    const oldestBlocking = sorted[Math.max(0, sorted.length - limit)] ?? now;
    return Math.max(1, Math.ceil((oldestBlocking + RATE_LIMIT_WINDOW_SECONDS * 1000 - now) / 1000));
}

function assertBelowLimit(timestamps: string[], limit: number, now: number, message: string) {
    if (timestamps.length >= limit)
        throw apiErrors.rateLimited(message, retryAfterSeconds(timestamps, limit, now));
}

async function ipWriteTimestamps(store: CommentsStore, subject: RateLimitSubject, since: string) {
    return subject.ipHash
        ? await store.writeTimestampsByIp(subject.domain, subject.ipHash, since)
        : [];
}

const tooManyComments = 'You are leaving feedback too quickly. Please try again later.';

export async function enforceNewCommentLimits(store: CommentsStore, subject: RateLimitSubject, path: string) {
    const now = Date.now();
    const since = windowStart(now);
    const [visitorComments, ipWrites, unresolvedOnPage] = await Promise.all([
        store.commentTimestampsByAuthor(subject.domain, subject.authorId, since),
        ipWriteTimestamps(store, subject, since),
        store.countUnresolved(subject.domain, path)
    ]);

    assertBelowLimit(visitorComments, RATE_LIMIT_VISITOR_COMMENTS, now, tooManyComments);
    assertBelowLimit(ipWrites, RATE_LIMIT_IP_WRITES, now, tooManyComments);
    if (unresolvedOnPage >= MAX_UNRESOLVED_COMMENTS_PER_PAGE)
        throw apiErrors.rateLimited('This page has too many open comments. Please try again later.', PAGE_FULL_RETRY_AFTER_SECONDS);
}

export async function enforceReplyLimits(store: CommentsStore, subject: RateLimitSubject) {
    const now = Date.now();
    const since = windowStart(now);
    const [visitorReplies, ipWrites] = await Promise.all([
        store.replyTimestampsByAuthor(subject.domain, subject.authorId, since),
        ipWriteTimestamps(store, subject, since)
    ]);

    assertBelowLimit(visitorReplies, RATE_LIMIT_VISITOR_REPLIES, now, 'You are replying too quickly. Please try again later.');
    assertBelowLimit(ipWrites, RATE_LIMIT_IP_WRITES, now, 'You are replying too quickly. Please try again later.');
}
