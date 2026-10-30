import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = cookieName(cookieNames.session);
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Shared verification for Next.js cookie state and same-origin Request handlers. */
export async function sessionUser(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return getUser(session.uid);
}

/** When this browser signed in (Unix seconds): sessions are never re-signed, so `exp` minus the lifetime */
export function sessionSignedInAt(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return { userId: session.uid, signedInAt: session.exp - SESSION_TTL_SECONDS };
}

export function requestSessionUser(request: Request) {
    const parts = request.headers.get('cookie')?.split(';').map(cookie => cookie.trim()) ?? [];
    const value = readMigratingCookie({ get: name => {
        const cookie = parts.find(part => part.startsWith(`${name}=`));
        return cookie === undefined ? undefined : { value: cookie.slice(name.length + 1) };
    } }, cookieNames.session);
    return sessionUser(value);
}
