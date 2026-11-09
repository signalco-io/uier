import { cache } from 'react';
import { cookies } from 'next/headers';
import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { isLocalRuntime } from '../comments/environment';
import type { DbUser } from './model';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, sessionEmailProof, sessionSignedInAt, sessionToken, sessionUser } from './sessionIdentity';
import { reviewSsoCookie, REVIEW_SSO_COOKIE_NAME, reviewSsoCookieOptions } from './reviewSsoCookie';
import { SIGN_IN_REQUEST_COOKIE_NAME } from './signInCookie';
import { GOOGLE_SIGN_IN_COOKIE_NAME } from './google/cookie';
import { MICROSOFT_SIGN_IN_COOKIE_NAME } from './microsoft/cookie';

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './sessionIdentity';

/** The ways to sign in; the sign-in page marks the one this browser used last */
export type SignInMethod = 'passkey' | 'google' | 'microsoft' | 'email';
const signInMethods: readonly string[] = ['passkey', 'google', 'microsoft', 'email'] satisfies SignInMethod[];
/** Holds only the method's name, and outlives sign-out: it is a hint for the next sign-in */
const LAST_SIGN_IN_COOKIE_NAME = cookieName(cookieNames.lastSignIn);

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

/**
 * Signs the user in on this browser and remembers how (server actions and route handlers only).
 * `provenEmail`: the account email when this sign-in proved its inbox now (`emailProof.ts`); returns that proof.
 */
export async function startSession(userId: string, method: SignInMethod, provenEmail?: string) {
    const jar = await cookies();
    const { token, proof } = sessionToken(userId, provenEmail);
    jar.set(SESSION_COOKIE_NAME, token, appCookieOptions(SESSION_TTL_SECONDS));
    jar.set(LAST_SIGN_IN_COOKIE_NAME, method, appCookieOptions(cookieNames.lastSignIn.lifetime));
    jar.set(SIGN_IN_REQUEST_COOKIE_NAME, '', appCookieOptions(0));
    jar.set(GOOGLE_SIGN_IN_COOKIE_NAME, '', appCookieOptions(0));
    jar.set(MICROSOFT_SIGN_IN_COOKIE_NAME, '', appCookieOptions(0));
    if (SIGN_IN_REQUEST_COOKIE_NAME !== cookieNames.signInRequest.legacy)
        jar.set(cookieNames.signInRequest.legacy, '', appCookieOptions(0));
    const companion = reviewSsoCookie(token);
    if (companion) jar.set(companion);
    return proof;
}

export async function endSession() {
    const jar = await cookies();
    for (const name of new Set([SESSION_COOKIE_NAME, cookieNames.session.legacy]))
        jar.set(name, '', appCookieOptions(0));
    for (const name of [REVIEW_SSO_COOKIE_NAME, cookieNames.reviewSso.legacy])
        jar.set(name, '', { ...reviewSsoCookieOptions, maxAge: 0 });
}

/** How this browser signed in last, kept after sign-out, or `undefined` */
export async function getLastSignInMethod() {
    const value = (await cookies()).get(LAST_SIGN_IN_COOKIE_NAME)?.value;
    return value && signInMethods.includes(value) ? value as SignInMethod : undefined;
}

/** The session's user id and sign-in time, or `null` */
export const getSessionSignIn = cache(async () => {
    return sessionSignedInAt(readMigratingCookie(await cookies(), cookieNames.session));
});

/** The email this browser's sign-in proved for `user` and when, or `null` (`emailProof.ts`) */
export async function getSessionEmailProof(user: DbUser) {
    return sessionEmailProof(readMigratingCookie(await cookies(), cookieNames.session), user);
}

/** The signed-in user, or `null` (an invalid, expired or orphaned session counts as signed out) */
export const getSessionUser = cache(async () => {
    return sessionUser(readMigratingCookie(await cookies(), cookieNames.session));
});
