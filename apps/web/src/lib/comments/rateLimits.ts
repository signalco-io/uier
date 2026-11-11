import type { CommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from '../review/actor';
import { KnownPageLinks } from '../../knownPages';
import { isLocalRuntime, keyedHash } from './environment';
import { apiErrors } from './http';
import { ipRateLimitBucket, isLoopbackIp, resolveClientIp } from './visitor';
import {
    APP_REWRITES_WINDOW_SECONDS,
    DOMAIN_REWRITES_WINDOW_SECONDS,
    PAGE_COMMENTS_WINDOW_SECONDS,
    RATE_LIMIT_APP_REWRITES,
    RATE_LIMIT_DOMAIN_REWRITES,
    RATE_LIMIT_DOMAIN_SCREENSHOTS,
    SCREENSHOTS_WINDOW_SECONDS,
    RATE_LIMIT_IP_REWRITES,
    RATE_LIMIT_VISITOR_REWRITES,
    RATE_LIMIT_IP_WRITES,
    RATE_LIMIT_IP_REACTIONS,
    RATE_LIMIT_MEMBER_REACTIONS,
    RATE_LIMIT_VISITOR_REACTIONS,
    RATE_LIMIT_MEMBER_COMMENTS,
    RATE_LIMIT_MEMBER_REPLIES,
    RATE_LIMIT_PAGE_COMMENTS,
    RATE_LIMIT_PUBLIC_ACCOUNT_COMMENTS,
    RATE_LIMIT_VISITOR_COMMENTS,
    RATE_LIMIT_VISITOR_REPLIES,
    RATE_LIMIT_WINDOW_SECONDS
} from './limits';

/**
 * Counters that are not about one site live in the comments container under this partition: the
 * app's sign-in emails and invitations, and the app-wide rewrite limits.
 */
export const APP_COUNTERS_PARTITION = 'app';

/**
 * The app page that shows a limit's usage: the account's (what one person sends) or the workspace's
 * (what a whole project shares)
 */
export type UsagePage = 'account' | 'workspace';

/** App paths of a project's usage pages; only a signed-in person has them (a guest has no account to open) */
export type UsageLinks = Record<UsagePage, string>;

export type RateLimitSubject = {
    domain: string;
    authorId: string;
    /** Set only by project review services from a server-resolved actor, never request input. */
    member?: boolean;
    /** A signed-in account on uier's public feedback project, not a member: more new comments than a visitor. Server-resolved only. */
    publicAccount?: boolean;
    /** MCP replies also count per credential, before consuming the human owner's budget. */
    credentialId?: string;
    /** IPv4 address or IPv6 /64; missing when the IP limit doesn't apply (local loopback requests) */
    ipBucket?: string;
    /** A signed-in member's usage pages, named by a rejection so the toolbar can link to them */
    usage?: UsageLinks;
};

export type Limit = {
    /** What is counted, e.g. `visitor-comments:<authorId>` */
    key: string;
    limit: number;
    windowSeconds: number;
    /** Anchor a request's lifetime budget instead of resetting at a wall-clock boundary. */
    windowStartSeconds?: number;
    reason: 'too_fast' | 'page_full';
    message: string;
    /** The usage page that shows this limit; none for limits nobody can act on (the app's total) */
    usage?: UsagePage;
};

/**
 * IP bucket used for rate limiting. Locally (development and e2e tests) loopback requests are not
 * IP limited, so all local test visitors don't share a single bucket.
 */
export function rateLimitIpBucket(request: Pick<Request, 'headers'>) {
    const ip = resolveClientIp(request);
    if (!ip)
        return isLocalRuntime() ? undefined : 'unknown';
    if (isLocalRuntime() && isLoopbackIp(ip))
        return undefined;
    return ipRateLimitBucket(ip);
}

/** Where a signed-in member sees their usage in the project; nothing for guests and anonymous visitors */
export function usageLinks(project: { id: string; publicId?: string }, actor: ProjectActor | undefined): UsageLinks | undefined {
    if (actor?.kind !== 'member')
        return undefined;
    const code = project.publicId ?? project.id;
    return { account: KnownPageLinks.accountUsage(code), workspace: KnownPageLinks.workspaceUsage(code) };
}

/** The limit's counter in the fixed window at `nowSeconds`, and the seconds until that window ends */
export function limitWindow({ key, windowSeconds, windowStartSeconds = 0 }: Limit, nowSeconds = Math.floor(Date.now() / 1000)) {
    const window = Math.floor((nowSeconds - windowStartSeconds) / windowSeconds);
    return {
        // A keyed hash, so the id reveals neither the visitor nor the IP address
        id: `counter_${keyedHash('rate-limit', `${key}:${windowSeconds}:${window}`).slice(0, 40)}`,
        resetsInSeconds: windowStartSeconds + (window + 1) * windowSeconds - nowSeconds
    };
}

/** Counts one write against the limit in the current fixed window (one small counter document) */
export async function consume(store: CommentsStore, domain: string, limit: Limit, links?: UsageLinks) {
    const { id, resetsInSeconds } = limitWindow(limit);
    // Kept a little longer than the window, so a slow request near its end still finds the counter
    if (!await store.incrementCounter(domain, id, limit.limit, limit.windowSeconds + 300))
        throw apiErrors.rateLimited(limit.message, resetsInSeconds, limit.reason, limit.usage && links?.[limit.usage]);
}

/** How much of the limit the current window used (counters stop at their limit), without counting anything */
export async function usedOf(store: CommentsStore, domain: string, limit: Limit) {
    const { id, resetsInSeconds } = limitWindow(limit);
    return { used: Math.min(await store.getCounter(domain, id), limit.limit), limit: limit.limit, resetsInSeconds };
}

const tooManyComments = 'You are leaving feedback too quickly. Please try again later.';
const tooManyReplies = 'You are replying too quickly. Please try again later.';

/** New comments of one author per hour in a site or project; a public feedback account counts under its visitor key */
export function authorCommentsLimit(authorId: string, member = false, publicAccount = false): Limit {
    return { key: `${member ? 'member' : 'visitor'}-comments:${authorId}`,
        limit: member ? RATE_LIMIT_MEMBER_COMMENTS : publicAccount ? RATE_LIMIT_PUBLIC_ACCOUNT_COMMENTS : RATE_LIMIT_VISITOR_COMMENTS,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyComments, usage: 'account' };
}

/** Replies of one author per hour in a site or project */
export function authorRepliesLimit(authorId: string, member = false): Limit {
    return { key: `${member ? 'member' : 'visitor'}-replies:${authorId}`, limit: member ? RATE_LIMIT_MEMBER_REPLIES : RATE_LIMIT_VISITOR_REPLIES,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyReplies, usage: 'account' };
}

/** Replies through one coding tool connection per hour, before they count against its owner's own replies */
function credentialRepliesLimit(credentialId: string): Limit {
    return { key: `credential-replies:${credentialId}`, limit: RATE_LIMIT_VISITOR_REPLIES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyReplies, usage: 'account' };
}

/** New comments and replies from one IP address (or IPv6 /64) per hour in a site or project; members are not counted */
export function networkWritesLimit(ipBucket: string, message = tooManyComments): Limit {
    return { key: `ip-writes:${ipBucket}`, limit: RATE_LIMIT_IP_WRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message, usage: 'account' };
}

/** New comments on one page per day, so a burst can't fill the page */
export function pageCommentsLimit(path: string): Limit {
    return { key: `page-comments:${path}`, limit: RATE_LIMIT_PAGE_COMMENTS, windowSeconds: PAGE_COMMENTS_WINDOW_SECONDS, reason: 'page_full',
        message: 'This page has reached its comment limit for today. Please try again tomorrow.', usage: 'workspace' };
}

function ipLimit(subject: RateLimitSubject, message: string): Limit[] {
    return subject.ipBucket && !subject.member ? [networkWritesLimit(subject.ipBucket, message)] : [];
}

/**
 * Limits are checked one after another and each counts the write as it passes, so a write
 * rejected by a later limit still counts against the earlier ones (on the safe side).
 */
async function consumeAll(store: CommentsStore, subject: RateLimitSubject, limits: Limit[]) {
    for (const limit of limits)
        await consume(store, subject.domain, limit, subject.usage);
}

export async function enforceNewCommentLimits(store: CommentsStore, subject: RateLimitSubject, path: string) {
    await consumeAll(store, subject, [
        authorCommentsLimit(subject.authorId, subject.member, subject.publicAccount),
        ...ipLimit(subject, tooManyComments),
        pageCommentsLimit(path)
    ]);
}

export async function enforceReplyLimits(store: CommentsStore, subject: RateLimitSubject) {
    await consumeAll(store, subject, [
        ...(subject.credentialId ? [credentialRepliesLimit(subject.credentialId)] : []),
        authorRepliesLimit(subject.authorId, subject.member),
        ...ipLimit(subject, tooManyReplies)
    ]);
}

const tooManyReactions = 'You are reacting too quickly. Please try again later.';

/** Reactions added or removed by one author per hour in a site or project */
export function authorReactionsLimit(authorId: string, member = false): Limit {
    return { key: `${member ? 'member' : 'visitor'}-reactions:${authorId}`, limit: member ? RATE_LIMIT_MEMBER_REACTIONS : RATE_LIMIT_VISITOR_REACTIONS,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyReactions, usage: 'account' };
}

/** Reactions from one IP address (or IPv6 /64) per hour in a site or project; members are not counted */
export function networkReactionsLimit(ipBucket: string): Limit {
    return { key: `ip-reactions:${ipBucket}`, limit: RATE_LIMIT_IP_REACTIONS, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyReactions, usage: 'account' };
}

/** Separate from the reply and IP write limits: reacting never uses up what a reviewer can write */
export async function enforceReactionLimits(store: CommentsStore, subject: RateLimitSubject) {
    await consumeAll(store, subject, [
        authorReactionsLimit(subject.authorId, subject.member),
        ...(subject.ipBucket && !subject.member ? [networkReactionsLimit(subject.ipBucket)] : [])
    ]);
}

const tooManyRewrites = 'You are asking for suggestions too quickly. Please try again later.';

/** Rewrite suggestions of one visitor or reviewer per hour in a site or project */
export function authorRewritesLimit(authorId: string): Limit {
    return { key: `visitor-rewrites:${authorId}`, limit: RATE_LIMIT_VISITOR_REWRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyRewrites, usage: 'account' };
}

/** Rewrite suggestions from one IP address per hour, on every site (counted in {@link APP_COUNTERS_PARTITION}) */
export function networkRewritesLimit(ipBucket: string): Limit {
    return { key: `rewrites-ip:${ipBucket}`, limit: RATE_LIMIT_IP_REWRITES, windowSeconds: RATE_LIMIT_WINDOW_SECONDS, reason: 'too_fast', message: tooManyRewrites, usage: 'account' };
}

/** Rewrite suggestions of a whole site or project per day */
export const siteRewritesLimit: Limit = { key: 'domain-rewrites', limit: RATE_LIMIT_DOMAIN_REWRITES, windowSeconds: DOMAIN_REWRITES_WINDOW_SECONDS, reason: 'too_fast',
    message: 'Suggestions for this site have reached their limit for today. Please try again tomorrow.', usage: 'workspace' };

const appRewritesLimit: Limit = { key: 'rewrites', limit: RATE_LIMIT_APP_REWRITES, windowSeconds: APP_REWRITES_WINDOW_SECONDS, reason: 'too_fast',
    message: 'Suggestions have reached their limit for today. Please try again tomorrow.' };

/** Screenshots of a whole site or project per day */
export const siteScreenshotsLimit: Limit = { key: 'domain-screenshots', limit: RATE_LIMIT_DOMAIN_SCREENSHOTS, windowSeconds: SCREENSHOTS_WINDOW_SECONDS, reason: 'too_fast',
    message: 'This site has reached its screenshots for today. Post the comment without one, or try again tomorrow.', usage: 'workspace' };

export type RewriteLimitSubject = {
    /** The site's partition: the request's domain, or `project:<code>` */
    domain: string;
    /** The visitor or reviewer; missing for a visitor without the `uier_visitor` cookie (not counted per visitor) */
    authorId?: string;
    /** IPv4 address or IPv6 /64; missing when the IP limit doesn't apply (local loopback requests) */
    ipBucket?: string;
    /** A signed-in member's usage pages */
    usage?: UsageLinks;
};

/**
 * Rewrite suggestions call a paid AI model. Counted per visitor (in the site's partition), per IP
 * (app-wide), per site (the site's partition) and in total (app-wide), so many sites or projects
 * don't add up to more. From the narrowest to the widest: a request a limit rejects counts against
 * none of the later ones, so one visitor or address can't use up a site's or the app's day, and the
 * app's total counts only requests that get to the model.
 */
export async function enforceRewriteLimits(store: CommentsStore, subject: RewriteLimitSubject) {
    if (subject.authorId)
        await consume(store, subject.domain, authorRewritesLimit(subject.authorId), subject.usage);
    if (subject.ipBucket)
        await consume(store, APP_COUNTERS_PARTITION, networkRewritesLimit(subject.ipBucket), subject.usage);
    await consume(store, subject.domain, siteRewritesLimit, subject.usage);
    await consume(store, APP_COUNTERS_PARTITION, appRewritesLimit);
}

/**
 * Screenshots per site (the domain or `project:<code>` partition) per day, on top of the new
 * comment limits, so one site's stored images can't grow without bounds
 */
export async function enforceScreenshotLimits(store: CommentsStore, domain: string, usage?: UsageLinks) {
    await consume(store, domain, siteScreenshotsLimit, usage);
}
