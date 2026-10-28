import { createHash } from 'node:crypto';
import { isLocalRuntime } from '../../comments/environment';
import { linearConfig } from './config';

export class LinearApiError extends Error {
    constructor(public readonly code: string, public readonly status = 0, public readonly retryAt?: string,
        public readonly requestId?: string, public readonly definitive = false) {
        super('Linear could not complete this request.'); this.name = 'LinearApiError';
    }
}
type Budget = { nextAt: number; pausedUntil: number };
const requestBudgets = new Map<string, Budget>();
/** Reserve the provider slot before the core's final authority/projection check. */
export async function withLinearRequest<T>(key: string, signal: AbortSignal, send: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (requestBudgets.size > 1000) for (const [entry, value] of requestBudgets) if (value.nextAt < now && value.pausedUntil < now) requestBudgets.delete(entry);
    const budget = requestBudgets.get(key) ?? { nextAt: now, pausedUntil: 0 };
    requestBudgets.set(key, budget);
    if (budget.pausedUntil > now) throw new LinearApiError('rate_limited', 429, new Date(budget.pausedUntil).toISOString(), undefined, true);
    const reservedAt = Math.max(now, budget.nextAt);
    budget.nextAt = reservedAt + 250;
    const delay = reservedAt - now;
    signal.throwIfAborted();
    if (delay > 0) await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(new LinearApiError('request_aborted')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, delay);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
    });
    signal.throwIfAborted();
    if (budget.pausedUntil > Date.now()) throw new LinearApiError('rate_limited', 429, new Date(budget.pausedUntil).toISOString(), undefined, true);
    return send();
}
function observeBudget(key: string, headers: Headers) {
    const budget = requestBudgets.get(key) ?? { nextAt: Date.now() + 250, pausedUntil: 0 };
    for (const kind of ['requests', 'complexity', 'endpoint-requests']) {
        const remaining = headers.get(`x-ratelimit-${kind}-remaining`);
        const reset = Number(headers.get(`x-ratelimit-${kind}-reset`));
        if (remaining !== null && Number(remaining) <= 0 && Number.isFinite(reset) && reset > Date.now()) budget.pausedUntil = Math.max(budget.pausedUntil, reset);
    }
    requestBudgets.set(key, budget);
}

export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function bounded(value: unknown, max = 100) {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max) : '';
}
const safeCode = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : fallback;
function retryTime(headers: Headers) {
    const after = headers.get('retry-after');
    const seconds = after && /^\d+(?:\.\d+)?$/.test(after) ? Number(after) : NaN;
    if (Number.isFinite(seconds)) return new Date(Date.now() + Math.min(seconds, 24 * 3600) * 1000).toISOString();
    if (after && Number.isFinite(Date.parse(after))) return new Date(Date.parse(after)).toISOString();
    const resets = ['x-ratelimit-requests-reset', 'x-ratelimit-complexity-reset', 'x-ratelimit-endpoint-requests-reset']
        .map(name => Number(headers.get(name))).filter(value => Number.isFinite(value) && value > Date.now());
    return new Date(resets.length ? Math.max(...resets) : Date.now() + 60_000).toISOString();
}

export async function linearGraphql<T>(token: string, operationName: string, query: string, variables: Record<string, unknown>,
    decode: (data: Record<string, unknown>) => T, signal = AbortSignal.timeout(20_000), options: { paced?: boolean; bucketKey?: string } = {}): Promise<T> {
    const bucketKey = options.bucketKey ?? createHash('sha256').update(`${linearConfig().apiUrl}:${token}`).digest('hex');
    if (!options.paced) return withLinearRequest(bucketKey, signal, () => linearGraphql(token, operationName, query, variables, decode, signal, { ...options, paced: true, bucketKey }));
    const response = await fetch(linearConfig().apiUrl, { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ operationName, query, variables }) });
    const requestId = bounded(response.headers.get('x-request-id'), 100) || undefined;
    observeBudget(bucketKey, response.headers);
    let body: unknown;
    try { body = await response.json(); } catch { throw new LinearApiError('invalid_response', response.status, undefined, requestId); }
    const errors = object(body) && Array.isArray(body.errors) ? body.errors : [];
    const first = errors[0];
    const code = object(first) && object(first.extensions) ? safeCode(first.extensions.code, 'graphql_error') : 'graphql_error';
    if (response.status === 429 || code === 'RATELIMITED') {
        const retryAt = retryTime(response.headers);
        const budget = requestBudgets.get(bucketKey)!; budget.pausedUntil = Math.max(budget.pausedUntil, Date.parse(retryAt));
        throw new LinearApiError('rate_limited', response.status, retryAt, requestId, true);
    }
    if (!response.ok || errors.length) throw new LinearApiError(response.status === 401 || code === 'UNAUTHENTICATED' ? 'unauthenticated'
        : response.status === 403 || code === 'FORBIDDEN' ? 'forbidden' : code === 'ENTITY_NOT_FOUND' || code === 'NOT_FOUND' ? 'not_found'
            : response.status >= 500 ? 'server_error' : safeCode(code, 'graphql_error'), response.status, undefined, requestId,
        response.status < 500 && !(errors.length && object(body) && object(body.data) && Object.values(body.data).some(value => value !== null)));
    if (!object(body) || !object(body.data)) throw new LinearApiError('invalid_response', response.status, undefined, requestId);
    try { return decode(body.data); }
    catch (error) { if (error instanceof LinearApiError) throw error; throw new LinearApiError('invalid_response', response.status, undefined, requestId); }
}

export function field(data: Record<string, unknown>, name: string) {
    const value = data[name]; if (!object(value)) throw new LinearApiError('invalid_response'); return value;
}
export function mutation(data: Record<string, unknown>, name: string) {
    const value = field(data, name); if (value.success !== true) throw new LinearApiError('mutation_rejected', 200, undefined, undefined, true); return value;
}

export type LinearToken = { accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] };
export async function linearToken(parameters: Record<string, string>, signal = AbortSignal.timeout(20_000)): Promise<LinearToken> {
    const config = linearConfig();
    const response = await fetch(config.tokenUrl, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }) });
    let body: unknown; try { body = await response.json(); } catch { throw new LinearApiError('invalid_token_response', response.status); }
    if (response.status === 429) throw new LinearApiError('rate_limited', 429, retryTime(response.headers), undefined, true);
    if (!response.ok || !object(body) || body.error) throw new LinearApiError(object(body) ? safeCode(body.error, 'oauth_failed') : 'oauth_failed', response.status,
        response.status === 429 ? retryTime(response.headers) : undefined, undefined, response.status < 500);
    const scopes = typeof body.scope === 'string' ? body.scope.split(/[ ,]+/).filter(Boolean) : Array.isArray(body.scope) ? body.scope.filter((value): value is string => typeof value === 'string') : [];
    if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16_384
        || typeof body.refresh_token !== 'string' || !body.refresh_token || body.refresh_token.length > 16_384
        || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 30 * 24 * 3600
        || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer' || !scopes.includes('read') || !scopes.includes('write'))
        throw new LinearApiError('invalid_token_response');
    return { accessToken: body.access_token, refreshToken: body.refresh_token, scopes,
        expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
}

export function validLinearAsset(value: unknown, upload = false): value is string {
    if (typeof value !== 'string' || value.length > 5000) return false;
    try {
        const url = new URL(value);
        if (url.username || url.password || url.hash) return false;
        if (isLocalRuntime() && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return ['http:', 'https:'].includes(url.protocol);
        if (url.protocol !== 'https:' || (!upload && url.search)) return false;
        return url.hostname === 'uploads.linear.app' || (upload && (url.hostname.endsWith('.s3.amazonaws.com')
            || /^[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)));
    } catch { return false; }
}
