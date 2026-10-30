import { isLocalRuntime } from './comments/environment';

const day = 24 * 60 * 60;
// Fixed rollout boundary, never reset by subsequent builds. Allow in-flight old cookies through
// 30 October, then retire each fallback after its longest possible original lifetime.
export const cookieMigrationCutoff = Date.UTC(2026, 9, 30);
export const cookieNames = {
    visitor: { name: '__Host-uier_visitor', legacy: 'uier_visitor', lifetime: 365 * day },
    session: { name: '__Host-uier_session', legacy: 'uier_session', lifetime: 30 * day },
    signInRequest: { name: '__Host-uier_sign_in_request', legacy: 'uier_sign_in_request', lifetime: 15 * 60 },
    workspace: { name: '__Host-uier_workspace', legacy: 'uier_workspace', lifetime: 365 * day },
    reviewSso: { name: '__Secure-uier_review_sso', legacy: 'uier_review_sso', lifetime: 30 * day },
    // New after the cutoff: `legacy` is only the local HTTP name, never read on HTTPS (see passkeys.ts).
    passkeyChallenge: { name: '__Host-uier_passkey_challenge', legacy: 'uier_passkey_challenge', lifetime: 5 * 60 }
} as const;
type CookieName = typeof cookieNames[keyof typeof cookieNames];
type CookieReader = { get(name: string): { value: string } | undefined };

/** Plain HTTP local development keeps unprefixed cookies; deployed cookies always use Secure. */
export function cookieName(cookie: CookieName, secure = !isLocalRuntime()) {
    return secure ? cookie.name : cookie.legacy;
}

export function readMigratingCookie(jar: CookieReader, cookie: CookieName, secure = !isLocalRuntime(), now = Date.now()) {
    const current = jar.get(cookieName(cookie, secure));
    if (current) return current.value;
    if (secure && now < cookieMigrationCutoff + cookie.lifetime * 1000)
        return jar.get(cookie.legacy)?.value;
    return undefined;
}
