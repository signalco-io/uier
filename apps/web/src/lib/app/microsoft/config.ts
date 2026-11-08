import { KnownPages } from '../../../knownPages';
import { isLocalRuntime } from '../../comments/environment';
import { deploymentEnvironment } from '../deployment';

export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com';
export const MICROSOFT_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const isMicrosoftTenantId = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Overrides are loopback-only and ignored on every deployment. */
function localOverride(value: string | undefined, fallback: string) {
    if (!isLocalRuntime() || !value) return fallback;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.hash || url.search)
        throw new Error('The local Microsoft endpoint is not valid.');
    return url.href.replace(/\/$/, '');
}

export function microsoftConfig() {
    return {
        clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
        authorizeUrl: localOverride(process.env.MICROSOFT_OAUTH_AUTHORIZE_URL, `${MICROSOFT_AUTHORITY}/common/oauth2/v2.0/authorize`),
        tokenUrl: localOverride(process.env.MICROSOFT_OAUTH_TOKEN_URL, `${MICROSOFT_AUTHORITY}/common/oauth2/v2.0/token`),
        authority: localOverride(process.env.MICROSOFT_OAUTH_AUTHORITY, MICROSOFT_AUTHORITY),
        /** The signed-in person's photo in Microsoft Graph, read once with the sign-in's access token */
        photoUrl: localOverride(process.env.MICROSOFT_GRAPH_PHOTO_URL, 'https://graph.microsoft.com/v1.0/me/photo/$value')
    };
}

/** Exact registered callbacks: production and local development, never deployment previews. */
export function isMicrosoftSignInConfigured() {
    if (!isLocalRuntime() && deploymentEnvironment() !== 'production') return false;
    try {
        const config = microsoftConfig();
        return Boolean(config.clientId && config.clientSecret);
    } catch { return false; }
}

export function microsoftRedirectUri(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.username || url.password || (isLocalRuntime() ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:'))
        throw new Error('The application URL is not valid for Microsoft sign-in.');
    return new URL(KnownPages.AppSignInMicrosoftCallback, url.origin).href;
}
