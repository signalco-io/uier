import { createSign } from 'node:crypto';
import type { GitHubRepository } from './model';
import { GITHUB_API_VERSION, GitHubError, githubConfig, githubId, githubRepositoryPath } from './config';

const requestId = (value: string | null) => value && /^[A-Za-z0-9:-]{1,100}$/.test(value) ? value : undefined;

function retryAt(response: Response, now = Date.now()) {
    const retry = response.headers.get('retry-after');
    if (retry) {
        const seconds = Number(retry);
        const at = Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : Date.parse(retry);
        if (Number.isFinite(at) && at > now) return new Date(at).toISOString();
    }
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    return new Date(response.headers.get('x-ratelimit-remaining') === '0' && reset > now ? reset + 1000 : now + 60_000).toISOString();
}

/** Bounded response validation; provider bodies never become error strings or causes. */
async function parse(response: Response) {
    let value: unknown;
    try {
        const raw = await response.text();
        if (raw.length > 8 * 1024 * 1024) throw new Error();
        value = raw ? JSON.parse(raw) : null;
    } catch {
        if (response.status === 429 || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0')))
            throw new GitHubError('rate_limited', response.status, retryAt(response), requestId(response.headers.get('x-github-request-id')));
        throw new GitHubError('invalid_response', response.status, undefined, requestId(response.headers.get('x-github-request-id')));
    }
    const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : '';
    const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.has('retry-after')
        || response.headers.get('x-ratelimit-remaining') === '0' || /secondary rate limit|abuse detection|rate limit exceeded/i.test(message)));
    if (rateLimited) throw new GitHubError('rate_limited', response.status, retryAt(response), requestId(response.headers.get('x-github-request-id')));
    if (!response.ok) throw new GitHubError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
        : response.status === 404 || response.status === 410 ? 'not_found' : response.status === 422 ? 'validation_error'
            : response.status >= 500 ? 'unavailable' : 'request_failed', response.status, undefined, requestId(response.headers.get('x-github-request-id')));
    return value;
}

export async function githubRequest<T>(path: string, token: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n#]/.test(path)) throw new GitHubError('invalid_path');
    const config = githubConfig();
    let response: Response;
    try {
        response = await fetch(`${config.apiBase}${path}`, { method: options.method ?? 'GET', redirect: 'manual',
            headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION, 'User-Agent': 'uier-integrations',
                ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: options.signal ?? AbortSignal.timeout(20_000) });
    } catch { throw new GitHubError('network_error'); }
    return await parse(response) as T;
}

export function githubAppJwt(now = Date.now()) {
    const config = githubConfig();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 9 * 60, iss: config.clientId })).toString('base64url');
    try {
        const signer = createSign('RSA-SHA256');
        signer.update(`${header}.${payload}`);
        return `${header}.${payload}.${signer.sign(config.privateKey).toString('base64url')}`;
    } catch { throw new GitHubError('invalid_configuration'); }
}

export type InstallationToken = { token: string; expiresAt: string };
export async function mintGitHubInstallationToken(installationId: string, repositoryId: string, signal?: AbortSignal): Promise<InstallationToken> {
    const value = await githubRequest<{ token?: unknown; expires_at?: unknown; permissions?: { issues?: string }; repositories?: { id: number }[] }>(
        `/app/installations/${githubId(installationId)}/access_tokens`, githubAppJwt(), { method: 'POST', signal,
            body: { repository_ids: [Number(githubId(repositoryId))], permissions: { issues: 'write', metadata: 'read' } } });
    if (typeof value?.token !== 'string' || !value.token || value.token.length > 32_000 || typeof value.expires_at !== 'string'
        || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()
        || value.permissions?.issues !== 'write' || (value.repositories && (value.repositories.length !== 1 || githubId(value.repositories[0]!.id) !== repositoryId)))
        throw new GitHubError('invalid_token_response');
    return { token: value.token, expiresAt: value.expires_at };
}

export async function exchangeGitHubCode(code: string, verifier: string, redirectUri: string) {
    const config = githubConfig();
    if (!code || code.length > 1000 || !verifier) throw new GitHubError('invalid_code');
    let response: Response;
    try {
        response = await fetch(`${config.oauthBase}/login/oauth/access_token`, { method: 'POST', redirect: 'manual',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }),
            signal: AbortSignal.timeout(15_000) });
    } catch { throw new GitHubError('oauth_failed'); }
    const value = await parse(response) as { access_token?: unknown; token_type?: unknown; expires_in?: unknown; error?: unknown };
    if (value?.error || typeof value?.access_token !== 'string' || !value.access_token || value.access_token.length > 32_000
        || (value.token_type !== undefined && String(value.token_type).toLowerCase() !== 'bearer')
        || (value.expires_in !== undefined && (!Number.isSafeInteger(value.expires_in) || Number(value.expires_in) <= 0))) throw new GitHubError('oauth_failed');
    // Unused refresh credentials are deliberately never copied from the exchange response.
    return { accessToken: value.access_token, ...(typeof value.expires_in === 'number' ? { expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString() } : {}) };
}


export function validateGitHubRepository(value: unknown): GitHubRepository {
    if (!value || typeof value !== 'object') throw new GitHubError('invalid_response');
    const repository = value as GitHubRepository;
    githubId(repository.id);
    githubRepositoryPath(repository.owner?.login, repository.name);
    if (typeof repository.node_id !== 'string' || !repository.node_id || repository.node_id.length > 200
        || typeof repository.private !== 'boolean' || typeof repository.archived !== 'boolean'
        || typeof repository.disabled !== 'boolean' || typeof repository.has_issues !== 'boolean') throw new GitHubError('invalid_response');
    return repository;
}
