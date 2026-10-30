import { azureDevOpsConfig, azureDevOpsScopes, validOrganization } from './config';

export class AzureDevOpsApiError extends Error {
    /** `definitive` means the request certainly changed nothing, so a create may be planned again. */
    constructor(public readonly code: string, public readonly status = 0, public readonly retryAt?: string, public readonly definitive = false) {
        super('Azure DevOps could not complete this request.'); this.name = 'AzureDevOpsApiError';
    }
}

type Budget = { nextAt: number; pausedUntil: number };
const requestBudgets = new Map<string, Budget>();
/** One paced request at a time per grant. Reserve the slot before the core's final authority check. */
export async function withAzureDevOpsRequest<T>(key: string, signal: AbortSignal, send: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (requestBudgets.size > 1000) for (const [entry, value] of requestBudgets) if (value.nextAt < now && value.pausedUntil < now) requestBudgets.delete(entry);
    const budget = requestBudgets.get(key) ?? { nextAt: now, pausedUntil: 0 };
    requestBudgets.set(key, budget);
    if (budget.pausedUntil > now) throw new AzureDevOpsApiError('rate_limited', 429, new Date(budget.pausedUntil).toISOString(), true);
    const reservedAt = Math.max(now, budget.nextAt);
    budget.nextAt = reservedAt + 250;
    const delay = reservedAt - now;
    signal.throwIfAborted();
    if (delay > 0) await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(new AzureDevOpsApiError('request_aborted')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, delay);
        signal.addEventListener('abort', aborted, { once: true });
    });
    signal.throwIfAborted();
    return send();
}

export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Display names are untrusted labels: no control or format characters, bounded length. */
export function bounded(value: unknown, max = 100) {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max) : '';
}
const safeCode = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : fallback;
function retryTime(headers: Headers) {
    const after = headers.get('retry-after');
    const seconds = after && /^\d+(?:\.\d+)?$/.test(after) ? Number(after) : NaN;
    if (Number.isFinite(seconds)) return new Date(Date.now() + Math.min(Math.max(seconds, 1), 24 * 3600) * 1000).toISOString();
    if (after && Number.isFinite(Date.parse(after))) return new Date(Date.parse(after)).toISOString();
    return new Date(Date.now() + 60_000).toISOString();
}

/** `https://dev.azure.com/<organization>/<path>` with a pinned API version. */
export function azureDevOpsUrl(organization: string, path: string, query: Record<string, string> = {}, apiVersion = '7.1') {
    if (!validOrganization(organization)) throw new AzureDevOpsApiError('invalid_organization', 0, undefined, true);
    const url = new URL(`${azureDevOpsConfig().apiUrl}/${organization}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('api-version', apiVersion);
    return url.href;
}
export function azureDevOpsProfileUrl(path: string, query: Record<string, string> = {}) {
    const url = new URL(`${azureDevOpsConfig().profileUrl}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('api-version', '7.1');
    return url.href;
}

export type AzureDevOpsRequest = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; patch?: boolean;
    signal?: AbortSignal; bucketKey: string; paced?: boolean };
export type AzureDevOpsResponse = { body: unknown; continuation?: string };

/** Typed REST call. Provider messages and bodies never reach logs or user copy, only bounded codes. */
export async function azureDevOpsRequest<T>(token: string, url: string, request: AzureDevOpsRequest,
    decode: (response: AzureDevOpsResponse) => T): Promise<T> {
    const signal = request.signal ?? AbortSignal.timeout(20_000);
    if (!request.paced) return withAzureDevOpsRequest(request.bucketKey, signal, () => azureDevOpsRequest(token, url, { ...request, signal, paced: true }, decode));
    const method = request.method ?? 'GET';
    let response: Response;
    try {
        response = await fetch(url, { method, redirect: 'error', signal,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
                ...(request.body === undefined ? {} : { 'Content-Type': request.patch ? 'application/json-patch+json' : 'application/json' }) },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) });
    } catch (error) {
        if (error instanceof AzureDevOpsApiError) throw error;
        throw new AzureDevOpsApiError(signal.aborted ? 'timeout' : 'network_error');
    }
    if (response.status === 429) {
        const retryAt = retryTime(response.headers);
        const budget = requestBudgets.get(request.bucketKey);
        if (budget) budget.pausedUntil = Math.max(budget.pausedUntil, Date.parse(retryAt));
        await response.body?.cancel();
        throw new AzureDevOpsApiError('rate_limited', 429, retryAt, true);
    }
    // A 203 is Azure DevOps' sign-in page for a credential it does not accept.
    if (response.status === 401 || response.status === 203) { await response.body?.cancel(); throw new AzureDevOpsApiError('unauthenticated', response.status, undefined, true); }
    if (!response.ok) {
        await response.body?.cancel();
        throw new AzureDevOpsApiError(response.status === 403 ? 'forbidden' : response.status === 404 ? 'not_found'
            : response.status === 409 || response.status === 412 ? 'conflict' : response.status >= 500 ? 'server_error' : 'bad_request',
        response.status, undefined, response.status < 500);
    }
    let body: unknown = null;
    if (response.status !== 204) {
        try { body = await response.json(); }
        catch { throw new AzureDevOpsApiError('invalid_response', response.status); }
    }
    const continuation = response.headers.get('x-ms-continuationtoken') ?? undefined;
    try { return decode({ body, continuation: continuation && continuation.length <= 500 ? continuation : undefined }); }
    catch (error) { if (error instanceof AzureDevOpsApiError) throw error; throw new AzureDevOpsApiError('invalid_response', response.status); }
}

export type AzureDevOpsToken = { accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] };
/** Microsoft identity platform token endpoint for the authorization code and refresh grants. */
export async function azureDevOpsToken(parameters: Record<string, string>, signal = AbortSignal.timeout(20_000)): Promise<AzureDevOpsToken> {
    const config = azureDevOpsConfig();
    let response: Response;
    try {
        response = await fetch(config.tokenUrl, { method: 'POST', redirect: 'error', signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: azureDevOpsScopes.join(' '), ...parameters }) });
    } catch { throw new AzureDevOpsApiError(signal.aborted ? 'timeout' : 'network_error'); }
    if (response.status === 429) throw new AzureDevOpsApiError('rate_limited', 429, retryTime(response.headers), true);
    let body: unknown; try { body = await response.json(); } catch { throw new AzureDevOpsApiError('invalid_token_response', response.status); }
    if (!response.ok || !object(body) || body.error)
        throw new AzureDevOpsApiError(object(body) ? safeCode(body.error, 'oauth_failed') : 'oauth_failed', response.status, undefined, response.status < 500);
    const scopes = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [];
    // Entra can answer with full resource URIs or bare names; require both delegated permissions either way.
    const granted = (name: string) => scopes.some(scope => scope === name || scope.endsWith(`/${name}`));
    const expires = typeof body.expires_in === 'string' && /^\d+$/.test(body.expires_in) ? Number(body.expires_in) : body.expires_in;
    // A refresh normally rotates the token; keep the one just used if none is returned.
    const refresh = body.refresh_token ?? parameters.refresh_token;
    if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16_384
        || typeof refresh !== 'string' || !refresh || refresh.length > 16_384
        || typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0 || expires > 24 * 3600
        || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer' || !granted('vso.work_write') || !granted('vso.profile'))
        throw new AzureDevOpsApiError('invalid_token_response');
    return { accessToken: body.access_token, refreshToken: refresh, scopes,
        expiresAt: new Date(Date.now() + expires * 1000).toISOString() };
}
