import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { keyedHash } from '../comments/environment';
import type { EmailProof } from './emailProof';
import { signToken, verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = cookieName(cookieNames.session);
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * `iat`: when this browser signed in (adding a passkey needs a recent sign-in). `ev`: the keyed hash of the
 * email this sign-in proved (`emailProof.ts`), never the address itself; absent when it proved none.
 */
type SessionPayload = { uid: string; iat: number; ev?: string };

const emailProofHash = (email: string) => keyedHash('session-email-proof', email);

/** A new session token for the user, with the email its sign-in proved, if any, and that proof */
export function sessionToken(userId: string, provenEmail?: string) {
    const iat = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = provenEmail ? { uid: userId, iat, ev: emailProofHash(provenEmail) } : { uid: userId, iat };
    const proof: EmailProof | null = provenEmail ? { email: provenEmail, provenAt: iat * 1000 } : null;
    return { token: signToken<SessionPayload>('session', payload, SESSION_TTL_SECONDS), proof };
}

/** Shared verification for Next.js cookie state and same-origin Request handlers. */
export async function sessionUser(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return getUser(session.uid);
}

/** When this browser signed in (Unix seconds): `iat`, or `exp` minus the lifetime on older tokens */
export function sessionSignedInAt(token: string | undefined) {
    const session = verifyToken<{ uid: string; iat?: unknown }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return { userId: session.uid, signedInAt: typeof session.iat === 'number' ? session.iat : session.exp - SESSION_TTL_SECONDS };
}

/** The email this session's sign-in proved for `user` (its own account email) and when, or `null` */
export function sessionEmailProof(token: string | undefined, user: { id: string; email: string }): EmailProof | null {
    const session = verifyToken<{ uid: string; iat?: unknown; ev?: unknown }>('session', token);
    if (!session || session.uid !== user.id || typeof session.iat !== 'number' || session.ev !== emailProofHash(user.email))
        return null;
    return { email: user.email, provenAt: session.iat * 1000 };
}

export function requestSessionUser(request: Request) {
    const parts = request.headers.get('cookie')?.split(';').map(cookie => cookie.trim()) ?? [];
    const value = readMigratingCookie({ get: name => {
        const cookie = parts.find(part => part.startsWith(`${name}=`));
        return cookie === undefined ? undefined : { value: cookie.slice(name.length + 1) };
    } }, cookieNames.session);
    return sessionUser(value);
}
