import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { keyedHash } from '../comments/environment';
import type { EmailProof } from './emailProof';
import { signToken, verifyToken } from './tokens';
import { getUser } from './users';

export const SESSION_COOKIE_NAME = cookieName(cookieNames.session);
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * `iat`: when this browser signed in. `aat`: on a Google or Microsoft sign-in, when the person authenticated
 * there (the provider's `auth_time`), or 0 when the provider did not say. A provider continues the session the
 * browser has with it, so such a sign-in alone does not show the person was just asked. Absent on a passkey or
 * email sign-in, which is the authentication. `ev`: the keyed hash of the email this sign-in proved
 * (`emailProof.ts`), never the address itself; absent when it proved none.
 */
type SessionPayload = { uid: string; iat: number; aat?: number; ev?: string };

const emailProofHash = (email: string) => keyedHash('session-email-proof', email);

/**
 * A new session token for the user, with the email its sign-in proved, if any, and that proof.
 * `authenticatedAt`: only for a Google or Microsoft sign-in, the provider's `auth_time` (Unix seconds) or `null`
 * when it gave none. It decides what counts as a recent sign-in (`sessionSignedInAt`).
 */
export function sessionToken(userId: string, provenEmail?: string, authenticatedAt?: number | null) {
    const iat = Math.floor(Date.now() / 1000);
    const aat = authenticatedAt === undefined ? undefined : Math.max(0, Math.min(Math.floor(authenticatedAt ?? 0), iat));
    const payload: SessionPayload = { uid: userId, iat, ...(aat === undefined ? {} : { aat }), ...(provenEmail ? { ev: emailProofHash(provenEmail) } : {}) };
    const proof: EmailProof | null = provenEmail ? { email: provenEmail, provenAt: iat * 1000 } : null;
    return { token: signToken<SessionPayload>('session', payload, SESSION_TTL_SECONDS), proof };
}

/** Shared verification for Next.js cookie state and same-origin Request handlers. */
export async function sessionUser(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    return getUser(session.uid);
}

/**
 * When the person last authenticated for this session (Unix seconds), which is what a step that needs a recent
 * sign-in asks for: `iat` (`exp` minus the lifetime on older tokens), or, on a Google or Microsoft sign-in,
 * the time the provider gave. A provider that gave none is never recent.
 */
export function sessionSignedInAt(token: string | undefined) {
    const session = verifyToken<{ uid: string; iat?: unknown; aat?: unknown }>('session', token);
    if (!session || typeof session.uid !== 'string') return null;
    const signedInAt = typeof session.iat === 'number' ? session.iat : session.exp - SESSION_TTL_SECONDS;
    return { userId: session.uid, signedInAt: typeof session.aat === 'number' ? Math.min(session.aat, signedInAt) : signedInAt };
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
