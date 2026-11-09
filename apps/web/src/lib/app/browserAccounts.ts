import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { UserFacingError } from './actionErrors';
import { appCookieOptions } from './appCookies';
import type { DbUser } from './model';
import { reviewSsoCookie, reviewSignedOutCookie, reviewSsoCookieOptions, REVIEW_SSO_COOKIE_NAME } from './reviewSsoCookie';
import { verifyToken } from './tokens';
import { getUser } from './users';

import { MAX_BROWSER_ACCOUNTS } from './browserAccountLimits';
export { MAX_BROWSER_ACCOUNTS } from './browserAccountLimits';
export const ACCOUNT_LIMIT_MESSAGE = 'You can stay signed in to 5 accounts. Sign out of one before adding another.';
export class AccountLimitError extends UserFacingError {
    constructor() { super(ACCOUNT_LIMIT_MESSAGE); }
}

// Only the primary cookie authorizes app/API requests. These four credentials are parked,
// never tried as authorization fallbacks, and never read under an unprefixed name on HTTPS.
const parkedCookies = [cookieNames.account1, cookieNames.account2, cookieNames.account3, cookieNames.account4];
export type AccountCookieReader = { get(name: string): { value: string } | undefined };
export type AccountCookieWriter = { set(name: string, value: string, options: ReturnType<typeof appCookieOptions> | typeof reviewSsoCookieOptions & { maxAge: number }): unknown };
export type BrowserSession = { token: string; user: DbUser; exp: number; active: boolean };
export type BrowserAccount = { id: string; name: string; email: string; avatarUrl?: string; active: boolean };

/** Bounded point reads; signature, purpose, expiry and a live user are required for every account. */
export async function browserSessions(jar: AccountCookieReader): Promise<BrowserSession[]> {
    const tokens = [readMigratingCookie(jar, cookieNames.session), ...parkedCookies.map(cookie => jar.get(cookieName(cookie))?.value)];
    const seen = new Set<string>();
    const candidates = tokens.flatMap((token, index) => {
        const payload = verifyToken<{ uid: string }>('session', token);
        if (!token || !payload || typeof payload.uid !== 'string' || seen.has(payload.uid)) return [];
        seen.add(payload.uid);
        return [{ token, userId: payload.uid, exp: payload.exp, active: index === 0 }];
    });
    return (await Promise.all(candidates.map(async ({ userId, ...session }) => {
        const user = await getUser(userId);
        return user ? { ...session, user } : null;
    }))).filter((session): session is BrowserSession => session !== null);
}

/** Write the original tokens with their remaining lifetime. Switching never renews a credential. */
export function writeBrowserSessions(jar: AccountCookieWriter, sessions: BrowserSession[]) {
    const [active, ...parked] = sessions;
    const write = (name: string, session?: BrowserSession) => jar.set(name, session?.token ?? '',
        appCookieOptions(session ? Math.max(0, session.exp - Math.floor(Date.now() / 1000)) : 0));
    write(cookieName(cookieNames.session), active);
    if (cookieName(cookieNames.session) !== cookieNames.session.legacy) write(cookieNames.session.legacy);
    parkedCookies.forEach((cookie, index) => write(cookieName(cookie), parked[index]));
    const companion = active ? reviewSsoCookie(active.token)! : reviewSignedOutCookie();
    jar.set(REVIEW_SSO_COOKIE_NAME, companion.value, { ...reviewSsoCookieOptions, maxAge: companion.maxAge });
    jar.set(cookieNames.reviewSso.legacy, '', { ...reviewSsoCookieOptions, maxAge: 0 });
    // These are browser-wide flow bindings. A ceremony started for the former active account must end.
    for (const cookie of [cookieNames.signInRequest, cookieNames.googleSignIn, cookieNames.microsoftSignIn, cookieNames.passkeyChallenge]) {
        jar.set(cookieName(cookie), '', appCookieOptions(0));
        if (cookieName(cookie) !== cookie.legacy) jar.set(cookie.legacy, '', appCookieOptions(0));
    }
    for (const name of new Set([cookieName(cookieNames.workspace), cookieNames.workspace.legacy]))
        jar.set(name, '', appCookieOptions(0));
}

/** A fresh sign-in replaces only that account's credential, preserving all the other accounts. */
export async function addBrowserSession(jar: AccountCookieReader & AccountCookieWriter, token: string) {
    const payload = verifyToken<{ uid: string }>('session', token);
    const user = payload && typeof payload.uid === 'string' ? await getUser(payload.uid) : null;
    if (!payload || !user) throw new UserFacingError('This sign-in has ended. Sign in again.');
    const others = (await browserSessions(jar)).filter(session => session.user.id !== user.id);
    if (others.length >= MAX_BROWSER_ACCOUNTS) throw new AccountLimitError();
    writeBrowserSessions(jar, [{ token, user, exp: payload.exp, active: true }, ...others]);
}

export async function switchBrowserAccount(jar: AccountCookieReader & AccountCookieWriter, userId: string) {
    const sessions = await browserSessions(jar);
    const selected = sessions.find(session => session.user.id === userId);
    if (!selected) throw new UserFacingError('This account is no longer signed in. Sign in again.');
    writeBrowserSessions(jar, [selected, ...sessions.filter(session => session !== selected)]);
}

/** No fallback authorization on reads; only this explicit sign-out selects the next live account. */
export async function removeBrowserAccount(jar: AccountCookieReader & AccountCookieWriter, all = false) {
    const remaining = all ? [] : (await browserSessions(jar)).filter(session => !session.active);
    writeBrowserSessions(jar, remaining);
    return remaining.length > 0;
}
