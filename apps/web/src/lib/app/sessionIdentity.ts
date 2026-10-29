import { verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = 'uier_session';

/** Shared verification for Next.js cookie state and same-origin Request handlers. */
export async function sessionUser(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return getUser(session.uid);
}

export function requestSessionUser(request: Request) {
    const value = request.headers.get('cookie')?.split(';')
        .map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
        ?.slice(SESSION_COOKIE_NAME.length + 1);
    return sessionUser(value);
}
