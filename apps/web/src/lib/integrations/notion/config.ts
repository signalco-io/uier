import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured, type SecretKeyConfig } from '../secrets';

export const NOTION_API_VERSION = '2026-03-11';
export function notionKey(): SecretKeyConfig {
    const keyId = process.env.NOTION_TOKEN_KEY_ID ?? 'k1';
    const previousId = process.env.NOTION_TOKEN_KEY_PREVIOUS_ID ?? (keyId === 'k1' ? 'k0' : 'k1');
    return { key: process.env.NOTION_TOKEN_KEY, keyId,
        previousKeys: process.env.NOTION_TOKEN_KEY_PREVIOUS ? { [previousId]: process.env.NOTION_TOKEN_KEY_PREVIOUS } : undefined };
}
export function isNotionConfigured() {
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return false;
    return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET && isSecretKeyConfigured(notionKey()));
}
function localOverride(value: string | undefined, fallback: string) {
    if (!isLocalRuntime() || !value) return fallback;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)
        throw new Error('The local Notion endpoint is not valid.');
    return url.href.replace(/\/$/, '');
}
export function notionApiBaseUrl() { return localOverride(process.env.NOTION_API_BASE_URL, 'https://api.notion.com'); }
export function notionAuthorizeUrl() { return localOverride(process.env.NOTION_OAUTH_AUTHORIZE_URL, 'https://api.notion.com/v1/oauth/authorize'); }
export function notionRedirectUri(baseUrl: string) {
    const base = new URL(baseUrl);
    const local = isLocalRuntime() && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((!local && (base.protocol !== 'https:' || base.origin !== 'https://uier.io')) || base.username || base.password)
        throw new Error('The Notion callback address is not valid.');
    return new URL('/app/notion/callback', base.origin).href;
}
