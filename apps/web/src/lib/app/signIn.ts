import { randomInt, timingSafeEqual } from 'node:crypto';
import { getCommentsStore } from '../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../comments/rateLimits';
import { keyedHash } from '../comments/environment';
import { ApiError } from '../comments/http';
import { sendEmail } from '../email/send';
import { signInEmail } from '../email/templates';
import { KnownPages } from '../../knownPages';
import { getAppStore } from './store';
import { isRandomToken, randomToken, sha256Hex } from './tokens';
import { findOrCreateUser } from './users';
import type { DbSignInRequest, DbUser } from './model';
import { boundSignInRequestId } from './signInCookie';
import { clearEmailSuppression } from '../email/suppression';
import { completeGoogleLink } from './google/link';

export const SIGN_IN_LINK_TTL_SECONDS = 15 * 60;
export const SIGN_IN_CODE_LENGTH = 8;
export const SIGN_IN_WRONG_CODE_LIMIT = 5;
export const SIGN_IN_CODE_ERROR = 'This code did not work. Ask for a new email and try again in this browser.';

const HOUR = 60 * 60;
const SIGN_IN_EMAILS_PER_ADDRESS = 5;
const SIGN_IN_EMAILS_PER_IP = 20;

const signInPk = (tokenHash: string) => `sign-in:${tokenHash}` as const;

/** Only app paths: never another origin (`//evil.example`) or a non-app page */
export function safeNextPath(next: unknown) {
    if (typeof next !== 'string' || next.length > 2048 || next !== next.trim() || !next.startsWith('/') || next.startsWith('//')) return undefined;
    try {
        const decoded = decodeURIComponent(next);
        if (/[\p{Cc}\\]/u.test(decoded)) return undefined;
        // URL normalizes both literal and encoded dot segments. Reject them before normalization,
        // including encoded separators, so a return path cannot silently change its destination.
        const pathname = decodeURIComponent(next.split(/[?#]/, 1)[0]!);
        if (pathname.split('/').some(segment => segment === '.' || segment === '..')) return undefined;
        const base = new URL('https://uier.invalid');
        const url = new URL(next, base);
        if (url.origin !== base.origin || !(url.pathname === KnownPages.App || url.pathname.startsWith(`${KnownPages.App}/`))) return undefined;
        return `${url.pathname}${url.search}`;
    } catch { return undefined; }
}

/**
 * Sends a link and code. The action exposes the credentials only locally and on previews.
 * `googleLinkId` attaches a Google account waiting for this proof (`googleLinkIdFor`).
 */
export async function requestSignInLink(email: string, next: string | undefined, googleLinkId?: string) {
    // Confirmation also runs without an HTTP context; only requesting an email needs headers.
    const { appBaseUrl, requestIpBucket } = await import('./request');
    const counters = getCommentsStore();
    const tooMany = 'Too many sign-in emails. Try again later.';
    await consume(counters, APP_COUNTERS_PARTITION, { key: `sign-in-email:${email}`, limit: SIGN_IN_EMAILS_PER_ADDRESS, windowSeconds: HOUR, reason: 'too_fast', message: tooMany });
    const ipBucket = await requestIpBucket();
    if (ipBucket)
        await consume(counters, APP_COUNTERS_PARTITION, { key: `sign-in-ip:${ipBucket}`, limit: SIGN_IN_EMAILS_PER_IP, windowSeconds: HOUR, reason: 'too_fast', message: tooMany });

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const code = randomInt(10 ** SIGN_IN_CODE_LENGTH).toString().padStart(SIGN_IN_CODE_LENGTH, '0');
    const createdAt = new Date().toISOString();
    await getAppStore().create<DbSignInRequest>({
        type: 'sign-in',
        id: tokenHash,
        pk: signInPk(tokenHash),
        email,
        codeHash: keyedHash('sign-in-code', `${tokenHash}:${code}`),
        next: safeNextPath(next),
        googleLinkId,
        createdAt,
        ttl: SIGN_IN_LINK_TTL_SECONDS
    });

    const url = `${await appBaseUrl()}${KnownPages.AppSignInConfirm}?token=${encodeURIComponent(token)}`;
    await sendEmail(signInEmail({ to: email, url, code, linksGoogle: Boolean(googleLinkId) }));
    return { url, code, requestId: tokenHash, expiresAt: Date.parse(createdAt) + SIGN_IN_LINK_TTL_SECONDS * 1000 };
}

/** The pending sign-in of a link token (without using it up), or `null` when it is invalid or expired */
export async function getSignInRequest(token: unknown) {
    if (!isRandomToken(token))
        return null;
    const tokenHash = sha256Hex(token);
    return await getSignInRequestById(tokenHash);
}

async function getSignInRequestById(requestId: string) {
    const request = (await getAppStore().get<DbSignInRequest>(signInPk(requestId), requestId))?.doc;
    if (!request || Date.parse(request.createdAt) + SIGN_IN_LINK_TTL_SECONDS * 1000 <= Date.now())
        return null;
    return request;
}

/**
 * Uses up the link: returns the (new or existing) user and where to continue, or `null`. The link
 * works in any browser, but links a waiting Google account only in the one bound to the request.
 */
export async function confirmSignIn(token: unknown, binding?: string): Promise<{ user: DbUser; next?: string } | null> {
    const request = await getSignInRequest(token);
    return await consumeSignInRequest(request, request !== null && boundSignInRequestId(binding) === request.id);
}

/** Both paths use this delete: only its winner may create a user or start a session. */
async function consumeSignInRequest(request: DbSignInRequest | null, bound: boolean): Promise<{ user: DbUser; next?: string } | null> {
    if (!request || !await getAppStore().delete(request.pk, request.id))
        return null;

    const user = await findOrCreateUser(request.email);
    await clearEmailSuppression(request.email);
    const google = request.googleLinkId && bound ? await completeGoogleLink(request.googleLinkId, user.id, request.email) : null;
    // Signed in either way: the inbox is proven. Account says why Google was not linked.
    if (google === 'taken' || google === 'other_account')
        return { user, next: `${KnownPages.AppAccount}?google=${google}` };
    return { user, next: safeNextPath(request.next) };
}

/** A different/missing binding is rejected before reading the request or spending its guess budget. */
export async function confirmSignInCode(requestId: unknown, code: unknown, binding: string | undefined) {
    const boundId = boundSignInRequestId(binding);
    if (!boundId || boundId !== requestId)
        return null;
    const request = await getSignInRequestById(boundId);
    if (!request?.codeHash)
        return null;

    // Reserve a guess before comparing. Even a burst of parallel submissions can compare
    // at most five candidates. A second counter below invalidates the fifth wrong guess.
    if (!await consumeCodeBudget(request, 'attempts', SIGN_IN_WRONG_CODE_LIMIT))
        return null;

    const candidate = typeof code === 'string' && /^\d{8}$/.test(code) ? code : '';
    const actual = Buffer.from(keyedHash('sign-in-code', `${boundId}:${candidate}`), 'hex');
    const expected = Buffer.from(request.codeHash, 'hex');
    if (expected.length === actual.length && timingSafeEqual(expected, actual))
        return await consumeSignInRequest(request, true);

    await consumeCodeBudget(request, 'wrong', SIGN_IN_WRONG_CODE_LIMIT - 1);
    return null;
}

async function consumeCodeBudget(request: DbSignInRequest, kind: 'attempts' | 'wrong', limit: number) {
    try {
        // Four wrong guesses may leave the request alive; the fifth deletes it. Both atomic
        // counters start with the request, so neither resets during its 15-minute lifetime.
        await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
            key: `sign-in-code:${request.id}:${kind}`, limit,
            // Include the subsecond part lost when the creation timestamp is floored.
            windowSeconds: SIGN_IN_LINK_TTL_SECONDS + 1,
            windowStartSeconds: Math.floor(Date.parse(request.createdAt) / 1000),
            reason: 'too_fast', message: SIGN_IN_CODE_ERROR
        });
        return true;
    } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'rate_limited')
            throw error;
        await getAppStore().delete(request.pk, request.id);
        return false;
    }
}
