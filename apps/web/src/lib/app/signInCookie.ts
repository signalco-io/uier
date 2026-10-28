import { signToken, verifyToken } from './tokens';

export const SIGN_IN_REQUEST_COOKIE_NAME = 'uier_sign_in_request';
const PURPOSE = 'sign-in-request';
type SignInRequestPayload = { requestId: string };

/** The signed binding contains no email, link token or code. Each new request replaces it. */
export function signInRequestToken(requestId: string, ttlSeconds: number) {
    return signToken<SignInRequestPayload>(PURPOSE, { requestId }, ttlSeconds);
}

export function boundSignInRequestId(token: string | undefined) {
    const payload = verifyToken<SignInRequestPayload>(PURPOSE, token);
    return typeof payload?.requestId === 'string' && /^[a-f0-9]{64}$/.test(payload.requestId)
        ? payload.requestId
        : null;
}
