import { KnownPages } from '../../../knownPages';
import { isLocalRuntime } from '../../comments/environment';
import { deploymentEnvironment } from '../deployment';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const localHosts = ['localhost', '127.0.0.1', '[::1]'];

/** Endpoint overrides apply only in local runtime (the e2e stand-in), never on a deployment. */
function localOverride(value: string | undefined, fallback: string) {
    if (!isLocalRuntime() || !value) return fallback;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !localHosts.includes(url.hostname) || url.username || url.password || url.hash)
        throw new Error('The local Google endpoint is not valid.');
    return url.href.replace(/\/$/, '');
}

export function googleConfig() {
    return {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        authorizeUrl: localOverride(process.env.GOOGLE_OAUTH_AUTHORIZE_URL, 'https://accounts.google.com/o/oauth2/v2/auth'),
        tokenUrl: localOverride(process.env.GOOGLE_OAUTH_TOKEN_URL, 'https://oauth2.googleapis.com/token'),
        // Google documents both forms of its issuer
        issuers: isLocalRuntime() && process.env.GOOGLE_OAUTH_ISSUER
            ? [localOverride(process.env.GOOGLE_OAUTH_ISSUER, GOOGLE_ISSUER)]
            : [GOOGLE_ISSUER, 'accounts.google.com']
    };
}

/**
 * Production and local runtime only. Google accepts only registered redirect URIs, and previews
 * get a new address for every deployment, so they never show the button.
 */
export function isGoogleSignInConfigured() {
    if (!isLocalRuntime() && deploymentEnvironment() !== 'production') return false;
    try {
        const config = googleConfig();
        return Boolean(config.clientId && config.clientSecret);
    } catch {
        return false;
    }
}

/** The registered callback, from `appBaseUrl()` (never a Host header outside local runtime and previews) */
export function googleRedirectUri(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.username || url.password || (isLocalRuntime() ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:'))
        throw new Error('The application URL is not valid for Google sign-in.');
    return new URL(KnownPages.AppSignInGoogleCallback, url.origin).href;
}
