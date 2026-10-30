import { cache } from 'react';
import { cookies } from 'next/headers';
import { cookieNames, readMigratingCookie } from '../cookieNames';
import { isLocalRuntime } from '../comments/environment';
import { signToken } from './tokens';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, sessionSignedInAt, sessionUser } from './sessionIdentity';
import { reviewSsoCookie, REVIEW_SSO_COOKIE_NAME, reviewSsoCookieOptions } from './reviewSsoCookie';
import { SIGN_IN_REQUEST_COOKIE_NAME } from './signInCookie';
import { GOOGLE_SIGN_IN_COOKIE_NAME } from './google/cookie';

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './sessionIdentity';

/** `iat`: when this browser signed in (adding a passkey needs a recent sign-in) */
type SessionPayload = { uid: string; iat: number };

export function appCookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
        // Plain http only in local development and tests
        secure: !isLocalRuntime()
    };
}

/** Signs the user in on this browser (server actions and route handlers only) */
export async function startSession(userId: string) {
    const jar = await cookies();
    const token = signToken<SessionPayload>('session', { uid: userId, iat: Math.floor(Date.now() / 1000) }, SESSION_TTL_SECONDS);
    jar.set(SESSION_COOKIE_NAME, token, appCookieOptions(SESSION_TTL_SECONDS));
    jar.set(SIGN_IN_REQUEST_COOKIE_NAME, '', appCookieOptions(0));
    jar.set(GOOGLE_SIGN_IN_COOKIE_NAME, '', appCookieOptions(0));
    if (SIGN_IN_REQUEST_COOKIE_NAME !== cookieNames.signInRequest.legacy)
        jar.set(cookieNames.signInRequest.legacy, '', appCookieOptions(0));
    const companion = reviewSsoCookie(token);
    if (companion) jar.set(companion);
}

export async function endSession() {
    const jar = await cookies();
    for (const name of new Set([SESSION_COOKIE_NAME, cookieNames.session.legacy]))
        jar.set(name, '', appCookieOptions(0));
    for (const name of [REVIEW_SSO_COOKIE_NAME, cookieNames.reviewSso.legacy])
        jar.set(name, '', { ...reviewSsoCookieOptions, maxAge: 0 });
}

/** The session's user id and sign-in time, or `null` */
export const getSessionSignIn = cache(async () => {
    return sessionSignedInAt(readMigratingCookie(await cookies(), cookieNames.session));
});

/** The signed-in user, or `null` (an invalid, expired or orphaned session counts as signed out) */
export const getSessionUser = cache(async () => {
    return sessionUser(readMigratingCookie(await cookies(), cookieNames.session));
});
