import { cache } from 'react';
import { cookies } from 'next/headers';
import { isLocalRuntime } from '../comments/environment';
import { signToken, verifyToken } from './tokens';
import { getUser } from './users';
import { reviewSsoCookie, REVIEW_SSO_COOKIE_NAME, reviewSsoCookieOptions } from './reviewSsoCookie';
import { SIGN_IN_REQUEST_COOKIE_NAME } from './signInCookie';

export const SESSION_COOKIE_NAME = 'uier_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionPayload = { uid: string };

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
    const token = signToken<SessionPayload>('session', { uid: userId }, SESSION_TTL_SECONDS);
    jar.set(SESSION_COOKIE_NAME, token, appCookieOptions(SESSION_TTL_SECONDS));
    jar.set(SIGN_IN_REQUEST_COOKIE_NAME, '', appCookieOptions(0));
    const companion = reviewSsoCookie(token);
    if (companion) jar.set(companion);
}

export async function endSession() {
    (await cookies()).delete(SESSION_COOKIE_NAME);
    (await cookies()).set(REVIEW_SSO_COOKIE_NAME, '', { ...reviewSsoCookieOptions, maxAge: 0 });
}

/** The signed-in user, or `null` (an invalid, expired or orphaned session counts as signed out) */
export const getSessionUser = cache(async () => {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const session = verifyToken<SessionPayload>('session', token);
    if (!session || typeof session.uid !== 'string')
        return null;
    return await getUser(session.uid);
});
