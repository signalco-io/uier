import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured } from '../secrets';

export const slackScopes = ['chat:write', 'channels:read', 'groups:read'] as const;
export const slackReplyScopes = ['channels:history', 'groups:history'] as const;
/** Requested with reply access so imported replies show Slack names. Optional: reply sync works without it. */
export const slackNameScopes = ['users:read'] as const;
/** Verifies Events API requests. Without it the endpoint refuses events and the worker's poll imports replies. */
export const slackSigningSecret = () => process.env.SLACK_SIGNING_SECRET ?? '';
/** Optional: sharing a thread's screenshots and recordings as files under its message. */
export const slackFileScopes = ['files:write'] as const;
export const slackOptionalScopes: readonly string[] = [...slackReplyScopes, ...slackNameScopes, ...slackFileScopes];
export const slackSecretKey = () => ({ key: process.env.SLACK_TOKEN_KEY, keyId: process.env.SLACK_TOKEN_KEY_ID ?? 'k1',
    ...(process.env.SLACK_TOKEN_KEY_PREVIOUS ? { previousKeys: { [process.env.SLACK_TOKEN_KEY_PREVIOUS_ID ?? 'k1']: process.env.SLACK_TOKEN_KEY_PREVIOUS } } : {}) });

export function isSlackConfigured() {
    return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_APP_ID)
        && isSecretKeyConfigured(slackSecretKey())
        && (isLocalRuntime() || (process.env.UIER_DEPLOYMENT_ENV === 'production' && process.env.SLACK_DISTRIBUTION_APPROVED === '1'));
}

function localOverride(name: 'SLACK_API_BASE_URL' | 'SLACK_OAUTH_AUTHORIZE_URL', fallback: string) {
    const configured = process.env[name];
    if (!configured || !isLocalRuntime()) return fallback;
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)
        throw new Error('Invalid local Slack endpoint');
    return url.href;
}

export const slackApiBaseUrl = () => localOverride('SLACK_API_BASE_URL', 'https://slack.com/api/');
export const slackAuthorizeUrl = () => localOverride('SLACK_OAUTH_AUTHORIZE_URL', 'https://slack.com/oauth/v2/authorize');
/** Slack names the upload target itself. Bytes go only to Slack's own hosts, or to the local stand-in. */
export function slackUploadUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.username || url.password) return null;
    const api = new URL(slackApiBaseUrl());
    if (api.hostname !== 'slack.com') return url.origin === api.origin ? url : null;
    return url.protocol === 'https:' && !url.port && /^(?:[a-z0-9-]+\.)*slack\.com$/.test(url.hostname) ? url : null;
}
export const slackId = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9]{2,79}$/.test(value);
export const slackTimestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value);
export const slackLabel = (value: unknown) => typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
