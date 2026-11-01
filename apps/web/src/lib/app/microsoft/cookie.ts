import { cookieName, cookieNames } from '../../cookieNames';
import { signToken, verifyToken } from '../tokens';

/**
 * Binds a Microsoft sign-in, or a Microsoft account waiting for an email code, to this browser. It
 * holds only a signed record id; the purposes differ, so one kind is never accepted as the other.
 */
export const MICROSOFT_SIGN_IN_COOKIE_NAME = cookieName(cookieNames.microsoftSignIn);

type MicrosoftBindingPurpose = 'flow' | 'link';
type MicrosoftBindingPayload = { id: string };

export function microsoftBindingToken(purpose: MicrosoftBindingPurpose, id: string, ttlSeconds: number) {
    return signToken<MicrosoftBindingPayload>(`microsoft-sign-in:${purpose}`, { id }, ttlSeconds);
}

export function boundMicrosoftRecordId(purpose: MicrosoftBindingPurpose, token: string | undefined) {
    const payload = verifyToken<MicrosoftBindingPayload>(`microsoft-sign-in:${purpose}`, token);
    return typeof payload?.id === 'string' && /^[a-f0-9]{64}$/.test(payload.id) ? payload.id : null;
}
