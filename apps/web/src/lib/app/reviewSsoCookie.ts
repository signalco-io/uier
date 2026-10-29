import { cookieNames } from '../cookieNames';
import { signToken, verifyToken } from './tokens';

// A separate purpose and cookie keep the app's SameSite=Lax session out of cross-site frames.
// This credential can only obtain project review access; app routes never accept it.
export const REVIEW_SSO_COOKIE_NAME = cookieNames.reviewSso.name;
export const reviewSsoCookieOptions = {
    httpOnly: true, secure: true, sameSite: 'none' as const, path: '/api/review'
};

export function readReviewSsoSession(token: string | undefined) {
    const session = verifyToken<{ uid: string }>('review-sso', token);
    return session && typeof session.uid === 'string' ? session : null;
}

/** The companion expires with the app session, including when upgrading an existing login. */
export function reviewSsoCookie(sessionToken: string) {
    const session = verifyToken<{ uid: string }>('session', sessionToken);
    if (!session || typeof session.uid !== 'string') return undefined;
    const maxAge = session.exp - Math.floor(Date.now() / 1000);
    return {
        name: REVIEW_SSO_COOKIE_NAME,
        value: signToken('review-sso', { uid: session.uid }, maxAge),
        ...reviewSsoCookieOptions, maxAge
    };
}
