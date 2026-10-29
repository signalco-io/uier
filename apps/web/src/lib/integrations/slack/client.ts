import { slackApiBaseUrl } from './config';

export class SlackApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, public readonly retryAfter?: number,
        public readonly definitive = true, public readonly method?: SlackMethod) {
        super('Slack could not complete the request.');
        this.name = 'SlackApiError';
    }
}

export const slackMethods = ['oauth.v2.access', 'auth.test', 'conversations.list', 'conversations.info',
    'chat.postMessage', 'chat.update', 'chat.delete', 'chat.getPermalink'] as const;
export type SlackMethod = typeof slackMethods[number];

const safeCode = (value: unknown) => typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : 'unknown_error';
const maxRatePause = Date.parse('9999-12-31T23:59:59.999Z');

/** Provider responses are data, never errors containing message text or authentication material. */
export async function slackRequest(method: SlackMethod, payload: Record<string, unknown>, options: {
    token?: string; oauth?: boolean; signal?: AbortSignal; fetcher?: typeof fetch;
} = {}): Promise<Record<string, unknown>> {
    const base = slackApiBaseUrl();
    const endpoint = new URL(method, base.endsWith('/') ? base : `${base}/`);
    const read = ['auth.test', 'conversations.list', 'conversations.info', 'chat.getPermalink'].includes(method);
    const headers: Record<string, string> = { ...(!read ? { 'Content-Type': options.oauth ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) };
    if (options.oauth) headers.Authorization = `Basic ${Buffer.from(`${process.env.SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`).toString('base64')}`;
    else if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
        if (read) for (const [key, value] of Object.entries(payload)) endpoint.searchParams.set(key, String(value));
        response = await (options.fetcher ?? fetch)(endpoint, { method: read ? 'GET' : 'POST', redirect: 'error', headers,
            ...(!read ? { body: options.oauth ? new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])) : JSON.stringify(payload) } : {}),
            signal: options.signal ?? AbortSignal.timeout(20_000) });
    } catch { throw new SlackApiError(0, 'transport_uncertain', undefined, false, method); }
    const retryHeader = response.headers.get('retry-after');
    const retry = retryHeader === null ? undefined : Number(retryHeader);
    const invalidRetry = retryHeader !== null && (!/^\d+(?:\.\d+)?$/.test(retryHeader.trim()) || !Number.isFinite(retry)
        || retry! <= 0 || !Number.isSafeInteger(Math.ceil(retry! * 1000)) || Date.now() + retry! * 1000 > maxRatePause);
    const retryAfter = invalidRetry ? undefined : retry;
    if (response.status === 429) throw new SlackApiError(429, invalidRetry ? 'rate_limit_requires_review' : 'ratelimited', retryAfter ?? (invalidRetry ? undefined : 60), true, method);
    if (!response.ok) throw new SlackApiError(response.status, 'http_error', retryAfter, response.status < 500, method);
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new SlackApiError(response.status, 'response_uncertain', undefined, false, method); }
    if (!result || typeof result !== 'object' || !('ok' in result)) throw new SlackApiError(response.status, 'response_uncertain', undefined, false, method);
    const data = result as Record<string, unknown>;
    if (data.ok !== true) {
        const code = safeCode(data.error);
        if (code === 'ratelimited' && invalidRetry) throw new SlackApiError(response.status, 'rate_limit_requires_review', undefined, true, method);
        throw new SlackApiError(response.status, code, code === 'ratelimited' ? retryAfter ?? 60 : undefined,
            !['internal_error', 'fatal_error', 'request_timeout', 'unknown_error'].includes(code), method);
    }
    return data;
}
