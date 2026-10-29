import { NOTION_API_VERSION, notionApiBaseUrl } from './config';

export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const uuidPattern = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notionId(value: unknown): string {
    if (typeof value !== 'string' || !uuidPattern.test(value)) throw new NotionApiError(400, 'invalid_notion_id');
    return value;
}
export const normalizedId = (value: string) => value.replaceAll('-', '').toLowerCase();
export function sameId(a: unknown, b: unknown) { return typeof a === 'string' && typeof b === 'string' && normalizedId(a) === normalizedId(b); }
export function propertyId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9!~*'().%:_-]{1,128}$/.test(value)) throw new NotionApiError(400, 'invalid_property_id');
    return value;
}
export function boundedName(value: unknown, fallback = '') {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 80) : fallback;
}
export function richText(value: unknown) {
    return array(value).map(part => {
        const item = object(part);
        return typeof item.plain_text === 'string' ? item.plain_text : typeof object(item.text).content === 'string' ? object(item.text).content : '';
    }).join('');
}
export class NotionApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, public readonly retryAfter?: number,
        public readonly requestId?: string, public readonly rateLimitReason?: string) {
        super('Notion could not complete this request.');
        this.name = 'NotionApiError';
    }
}
const safeCode = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : fallback;

/** Explicit requests only: retries belong to the durable adapter, not an in-process fetch loop. */
export class NotionClient {
    constructor(private readonly fetcher: typeof fetch = fetch) {}
    async request<T = JsonObject>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string,
        options: { token?: string; basic?: boolean; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
        if (!/^\/v1\/[A-Za-z0-9_/?%=&.:-]+$/.test(path) || path.includes('..')) throw new NotionApiError(400, 'invalid_path');
        const form = options.body instanceof FormData;
        const encoded = options.body === undefined ? undefined : form ? options.body as FormData : JSON.stringify(options.body);
        if (typeof encoded === 'string' && Buffer.byteLength(encoded) > 490_000) throw new NotionApiError(400, 'payload_too_large');
        const authorization = options.basic
            ? `Basic ${Buffer.from(`${process.env.NOTION_CLIENT_ID ?? ''}:${process.env.NOTION_CLIENT_SECRET ?? ''}`).toString('base64')}`
            : `Bearer ${options.token ?? ''}`;
        let response: Response;
        try {
            response = await this.fetcher(`${notionApiBaseUrl()}${path}`, { method, redirect: 'error',
                headers: { authorization, 'Notion-Version': NOTION_API_VERSION, ...(form ? {} : { 'Content-Type': 'application/json' }) },
                body: encoded, signal: options.signal ?? AbortSignal.timeout(20_000) });
        } catch { throw new NotionApiError(0, 'transport_error'); }
        let body: JsonObject;
        try {
            const text = await response.text();
            if (Buffer.byteLength(text) > 4_000_000) throw new Error();
            body = object(JSON.parse(text));
        } catch { throw new NotionApiError(response.status >= 400 ? response.status : 0, 'invalid_response'); }
        if (!response.ok) {
            const additional = object(body.additional_data);
            const rawDelay = response.headers.get('retry-after') ?? additional.retry_after;
            const seconds = typeof rawDelay === 'number' ? rawDelay : typeof rawDelay === 'string' && /^\d+$/.test(rawDelay) ? Number(rawDelay) : undefined;
            throw new NotionApiError(response.status, safeCode(body.code ?? body.error, 'provider_error'),
                seconds !== undefined && Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 31_536_000 ? seconds * 1000 : undefined,
                typeof body.request_id === 'string' && uuidPattern.test(body.request_id) ? body.request_id : undefined,
                typeof additional.rate_limit_reason === 'string' ? safeCode(additional.rate_limit_reason, 'rate_limited') : undefined);
        }
        return body as T;
    }
    oauth(body: Record<string, unknown>, signal?: AbortSignal) { return this.request('POST', '/v1/oauth/token', { basic: true, body, signal }); }
}
export function pageProperty(page: JsonObject, id: string) {
    const properties = object(page.properties);
    return object(properties[id] ?? Object.values(properties).find(value => object(value).id === id));
}
export function isNotionPageUrl(value: string) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
        && ['notion.so', 'www.notion.so', 'app.notion.com', 'notion.com', 'www.notion.com'].includes(url.hostname); }
    catch { return false; }
}
