import { cache } from 'react';
import { cookies } from 'next/headers';
import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import type { DbUser } from './model';
import { sessionEmailProof, sessionSignedInAt, sessionToken, sessionUser } from './sessionIdentity';
import { appCookieOptions } from './appCookies';
import { addBrowserSession, browserSessions, removeBrowserAccount } from './browserAccounts';
import { avatarUrl } from './avatars';

export { appCookieOptions } from './appCookies';
export { MAX_BROWSER_ACCOUNTS, type BrowserAccount } from './browserAccounts';
export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './sessionIdentity';

/** The ways to sign in; the sign-in page marks the one this browser used last */
export type SignInMethod = 'passkey' | 'google' | 'microsoft' | 'email';
const signInMethods: readonly string[] = ['passkey', 'google', 'microsoft', 'email'] satisfies SignInMethod[];
/** Holds only the method's name, and outlives sign-out: it is a hint for the next sign-in */
const LAST_SIGN_IN_COOKIE_NAME = cookieName(cookieNames.lastSignIn);

/**
 * Signs the user in on this browser and remembers how (server actions and route handlers only).
 * `provenEmail`: the account email when this sign-in proved its inbox now (`emailProof.ts`); returns that proof.
 */
export async function startSession(userId: string, method: SignInMethod, provenEmail?: string) {
    const jar = await cookies();
    const { token, proof } = sessionToken(userId, provenEmail);
    await addBrowserSession(jar, token);
    jar.set(LAST_SIGN_IN_COOKIE_NAME, method, appCookieOptions(cookieNames.lastSignIn.lifetime));
    return proof;
}

export async function endSession(all = false) {
    return removeBrowserAccount(await cookies(), all);
}

/** Public account-menu fields only. Credentials never leave HttpOnly cookie state. */
export const getBrowserAccounts = cache(async () => (await browserSessions(await cookies())).map(({ user, active }) => ({
    id: user.id, name: user.name, email: user.email, avatarUrl: avatarUrl(user), active
})));

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
