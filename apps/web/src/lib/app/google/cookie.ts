import { cookieName, cookieNames } from '../../cookieNames';
import { signToken, verifyToken } from '../tokens';

/**
 * Binds a Google sign-in, or a Google account waiting for an email code, to this browser. It
 * holds only a signed record id; the purposes differ, so one kind is never accepted as the other.
 */
export const GOOGLE_SIGN_IN_COOKIE_NAME = cookieName(cookieNames.googleSignIn);

type GoogleBindingPurpose = 'flow' | 'link';
type GoogleBindingPayload = { id: string };

export function googleBindingToken(purpose: GoogleBindingPurpose, id: string, ttlSeconds: number) {
    return signToken<GoogleBindingPayload>(`google-sign-in:${purpose}`, { id }, ttlSeconds);
}

export function boundGoogleRecordId(purpose: GoogleBindingPurpose, token: string | undefined) {
    const payload = verifyToken<GoogleBindingPayload>(`google-sign-in:${purpose}`, token);
    return typeof payload?.id === 'string' && /^[a-f0-9]{64}$/.test(payload.id) ? payload.id : null;
}
