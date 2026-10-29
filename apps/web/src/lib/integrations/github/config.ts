import { createPrivateKey } from 'node:crypto';
import { isLocalRuntime } from '../../comments/environment';
import { isSecretKeyConfigured } from '../secrets';

export const GITHUB_API_VERSION = '2026-03-10';
export const githubSecretConfig = () => ({ key: process.env.UIER_GITHUB_SETUP_KEY,
    keyId: process.env.UIER_GITHUB_SETUP_KEY_ID ?? 'k1',
    previousKeys: process.env.UIER_GITHUB_SETUP_KEY_PREVIOUS
        ? { [process.env.UIER_GITHUB_SETUP_KEY_PREVIOUS_ID ?? 'k1']: process.env.UIER_GITHUB_SETUP_KEY_PREVIOUS } : undefined });

export class GitHubError extends Error {
    constructor(public readonly code: string, public readonly status = 0, public readonly retryAt?: string,
        public readonly requestId?: string) {
        super('The GitHub integration could not complete this request.');
        this.name = 'GitHubError';
    }
}

export function githubId(value: unknown): string {
    const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : '';
    if (!/^[1-9][0-9]{0,18}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new GitHubError('invalid_id');
    return id;
}

function endpoint(name: string, fallback: string) {
    if (!isLocalRuntime() || !process.env[name]) return fallback;
    const url = new URL(process.env[name]!);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new GitHubError('invalid_configuration');
    return url.href.replace(/\/$/, '');
}

export function githubConfig() {
    if (process.env.VERCEL_ENV === 'preview' || process.env.UIER_DEPLOYMENT_ENV === 'preview') throw new GitHubError('not_configured');
    const appId = githubId(process.env.UIER_GITHUB_APP_ID);
    const slug = process.env.UIER_GITHUB_APP_SLUG ?? '';
    const clientId = process.env.UIER_GITHUB_CLIENT_ID ?? '';
    const clientSecret = process.env.UIER_GITHUB_CLIENT_SECRET ?? '';
    const privateKey = process.env.UIER_GITHUB_PRIVATE_KEY ?? '';
    const webhookSecret = process.env.UIER_GITHUB_WEBHOOK_SECRET ?? '';
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) || !/^[A-Za-z0-9_.-]{1,200}$/.test(clientId)
        || !clientSecret || !webhookSecret || !isSecretKeyConfigured(githubSecretConfig())) throw new GitHubError('not_configured');
    try { if (createPrivateKey(privateKey).asymmetricKeyType !== 'rsa') throw new Error(); }
    catch { throw new GitHubError('invalid_configuration'); }
    return { appId, slug, clientId, clientSecret, privateKey, webhookSecret,
        apiBase: endpoint('UIER_GITHUB_API_BASE_URL', 'https://api.github.com'),
        oauthBase: endpoint('UIER_GITHUB_OAUTH_BASE_URL', 'https://github.com') };
}

export function isGitHubConfigured() {
    try { githubConfig(); return true; } catch { return false; }
}

export function githubLabel(value: unknown, max = 100) {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max) : '';
}

export function githubRepositoryPath(owner: string, name: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) throw new GitHubError('invalid_repository');
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
