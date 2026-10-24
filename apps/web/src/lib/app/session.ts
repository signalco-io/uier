import { cache } from 'react';
import { cookies } from 'next/headers';
import { isLocalRuntime } from '../comments/environment';
import { signToken, verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = 'uier_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionPayload = { uid: string };

function cookieOptions(maxAge: number) {
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
    (await cookies()).set(SESSION_COOKIE_NAME, signToken<SessionPayload>('session', { uid: userId }, SESSION_TTL_SECONDS), cookieOptions(SESSION_TTL_SECONDS));
}

export async function endSession() {
    (await cookies()).delete(SESSION_COOKIE_NAME);
}

/** The signed-in user, or `null` (an invalid, expired or orphaned session counts as signed out) */
export const getSessionUser = cache(async () => {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const session = verifyToken<SessionPayload>('session', token);
    if (!session || typeof session.uid !== 'string')
        return null;
    return await getUser(session.uid);
});
