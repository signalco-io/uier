import { getCommentsStore } from '../repo/commentsStore';
import { consume } from '../comments/rateLimits';
import { sendEmail } from '../email/send';
import { signInEmail } from '../email/templates';
import { KnownPages } from '../../knownPages';
import { getAppStore } from './store';
import { isRandomToken, randomToken, sha256Hex } from './tokens';
import { findOrCreateUser } from './users';
import { appBaseUrl, requestIpBucket } from './request';
import type { DbSignInRequest, DbUser } from './model';

export const SIGN_IN_LINK_TTL_SECONDS = 15 * 60;

const HOUR = 60 * 60;
const SIGN_IN_EMAILS_PER_ADDRESS = 5;
const SIGN_IN_EMAILS_PER_IP = 20;
/** Rate-limit counters of the app live in the comments container under this partition */
export const APP_COUNTERS_PARTITION = 'app';

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
 * Sends a sign-in link to the address. Returns the link only when the app runs locally (there is
 * no email there), so development and tests can follow it.
 */
export async function requestSignInLink(email: string, next: string | undefined) {
    const counters = getCommentsStore();
    const tooMany = 'Too many sign-in emails. Try again later.';
    await consume(counters, APP_COUNTERS_PARTITION, { key: `sign-in-email:${email}`, limit: SIGN_IN_EMAILS_PER_ADDRESS, windowSeconds: HOUR, reason: 'too_fast', message: tooMany });
    const ipBucket = await requestIpBucket();
    if (ipBucket)
        await consume(counters, APP_COUNTERS_PARTITION, { key: `sign-in-ip:${ipBucket}`, limit: SIGN_IN_EMAILS_PER_IP, windowSeconds: HOUR, reason: 'too_fast', message: tooMany });

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    await getAppStore().create<DbSignInRequest>({
        type: 'sign-in',
        id: tokenHash,
        pk: signInPk(tokenHash),
        email,
        next: safeNextPath(next),
        createdAt: new Date().toISOString(),
        ttl: SIGN_IN_LINK_TTL_SECONDS
    });

    const url = `${await appBaseUrl()}${KnownPages.AppSignInConfirm}?token=${encodeURIComponent(token)}`;
    await sendEmail(signInEmail({ to: email, url }));
    return url;
}

/** The pending sign-in of a link token (without using it up), or `null` when it is invalid or expired */
export async function getSignInRequest(token: unknown) {
    if (!isRandomToken(token))
        return null;
    const tokenHash = sha256Hex(token);
    const request = (await getAppStore().get<DbSignInRequest>(signInPk(tokenHash), tokenHash))?.doc;
    if (!request || Date.parse(request.createdAt) + SIGN_IN_LINK_TTL_SECONDS * 1000 <= Date.now())
        return null;
    return request;
}

/** Uses up the link: returns the (new or existing) user and where to continue, or `null` */
export async function confirmSignIn(token: unknown): Promise<{ user: DbUser; next?: string } | null> {
    const request = await getSignInRequest(token);
    // Deleting is what makes the link single-use: only one of two concurrent confirmations succeeds
    if (!request || !await getAppStore().delete(request.pk, request.id))
        return null;

    const user = await findOrCreateUser(request.email);
    return { user, next: request.next };
}
