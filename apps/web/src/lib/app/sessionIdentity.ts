import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = cookieName(cookieNames.session);

/** Shared verification for Next.js cookie state and same-origin Request handlers. */
export async function sessionUser(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return getUser(session.uid);
}

export function requestSessionUser(request: Request) {
    const parts = request.headers.get('cookie')?.split(';').map(cookie => cookie.trim()) ?? [];
    const value = readMigratingCookie({ get: name => {
        const cookie = parts.find(part => part.startsWith(`${name}=`));
        return cookie === undefined ? undefined : { value: cookie.slice(name.length + 1) };
    } }, cookieNames.session);
    return sessionUser(value);
}
