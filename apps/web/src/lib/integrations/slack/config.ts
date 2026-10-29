import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured } from '../secrets';

export const slackScopes = ['chat:write', 'channels:read', 'groups:read'] as const;
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
export const slackId = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9]{2,79}$/.test(value);
export const slackTimestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value);
export const slackLabel = (value: unknown) => typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
