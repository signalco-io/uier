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
    if (typeof next !== 'string' || next.length > 2048)
        return undefined;
    if (!(next === KnownPages.App || next.startsWith(`${KnownPages.App}/`) || next.startsWith(`${KnownPages.App}?`)))
        return undefined;
    if (next.includes('\\') || next.startsWith('//'))
        return undefined;
    return next;
}

/**
 * Sends a link and code. The action exposes the credentials only locally and on previews.
 */
export async function requestSignInLink(email: string, next: string | undefined) {
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
        createdAt,
        ttl: SIGN_IN_LINK_TTL_SECONDS
    });

    const url = `${await appBaseUrl()}${KnownPages.AppSignInConfirm}?token=${encodeURIComponent(token)}`;
    await sendEmail(signInEmail({ to: email, url, code }));
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

/** Uses up the link: returns the (new or existing) user and where to continue, or `null` */
export async function confirmSignIn(token: unknown): Promise<{ user: DbUser; next?: string } | null> {
    return await consumeSignInRequest(await getSignInRequest(token));
}

/** Both paths use this delete: only its winner may create a user or start a session. */
async function consumeSignInRequest(request: DbSignInRequest | null): Promise<{ user: DbUser; next?: string } | null> {
    if (!request || !await getAppStore().delete(request.pk, request.id))
        return null;

    const user = await findOrCreateUser(request.email);
    await clearEmailSuppression(request.email);
    return { user, next: request.next };
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
        return await consumeSignInRequest(request);

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
