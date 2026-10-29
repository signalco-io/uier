import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured } from '../secrets';

export function linearKey() {
    return { key: process.env.LINEAR_TOKEN_KEY, keyId: process.env.LINEAR_TOKEN_KEY_ID ?? 'k1',
        previousKeys: process.env.LINEAR_TOKEN_KEY_PREVIOUS ? { [process.env.LINEAR_TOKEN_KEY_PREVIOUS_ID ?? 'k1']: process.env.LINEAR_TOKEN_KEY_PREVIOUS } : undefined };
}

function endpoint(value: string | undefined, fallback: string) {
    if (!isLocalRuntime() || !value) return fallback;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.hash) throw new Error('Invalid Linear test endpoint');
    return url.href;
}

export function linearConfig() {
    return { clientId: process.env.LINEAR_CLIENT_ID ?? '', clientSecret: process.env.LINEAR_CLIENT_SECRET ?? '',
        apiUrl: endpoint(process.env.LINEAR_API_BASE_URL, 'https://api.linear.app/graphql'),
        authorizeUrl: endpoint(process.env.LINEAR_OAUTH_AUTHORIZE_URL, 'https://linear.app/oauth/authorize'),
        tokenUrl: endpoint(process.env.LINEAR_OAUTH_TOKEN_URL, 'https://api.linear.app/oauth/token'),
        revokeUrl: endpoint(process.env.LINEAR_OAUTH_REVOKE_URL, 'https://api.linear.app/oauth/revoke') };
}

export function isLinearConfigured() {
    if (!isLocalRuntime() && (process.env.VERCEL_ENV === 'preview' || process.env.UIER_DEPLOYMENT_ENV === 'preview')) return false;
    try { const config = linearConfig(); return Boolean(config.clientId && config.clientSecret && isSecretKeyConfigured(linearKey())); }
    catch { return false; }
}

export function linearCallback(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.username || url.password || (isLocalRuntime() ? !['http:', 'https:'].includes(url.protocol)
        : url.origin !== 'https://uier.io')) throw new Error('Invalid application URL');
    return new URL('/app/linear/callback', url.origin).href;
}
