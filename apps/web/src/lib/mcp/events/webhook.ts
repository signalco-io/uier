import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isLocalRuntime } from '../../comments/environment';
import { publicLookup } from '../publicNetwork';

/*
 * MCP event webhooks: Standard Webhooks signatures (`v1,` HMAC-SHA256 over `id.timestamp.body`)
 * plus `X-MCP-Subscription-Id`. Requests go only to public HTTPS addresses on the default port,
 * checked on each connection's own DNS lookup, never follow redirects and read at most 4 KiB.
 */

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 4096;
const MAX_URL_LENGTH = 2048;
const REQUEST_TIMEOUT_MS = 10_000;

/** Fixed categories only: never a response body, header or status line (no response oracle). */
export type CallbackFailure = 'connection_refused' | 'timeout' | 'tls_error' | 'http_4xx' | 'http_5xx' | 'challenge_failed';
export type WebhookResponse = { status: number; body: string } | { failure: CallbackFailure };
export type WebhookRequest = { url: string; webhookId: string; subscriptionId: string; body: string; secrets: string[]; timeoutMs?: number };
/** Injectable for tests; production uses `postWebhook`. */
export type WebhookPost = (request: WebhookRequest) => Promise<WebhookResponse>;

/** Local test runs only: `UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` accepts http://localhost callbacks on any port. */
function testCallbackUrl(url: URL) {
    return isLocalRuntime() && process.env.UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS === '1'
        && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** The normalized callback URL, or `null` when it is not an acceptable public HTTPS endpoint. */
export function callbackUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.username || url.password || url.hash || value.includes('#')) return null;
    if (testCallbackUrl(url)) return url;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && !url.port && !isIP(host) && host.includes('.') && !host.endsWith('.') ? url : null;
}

/** A Standard Webhooks symmetric secret: `whsec_` and the base64 of 24–64 random bytes. */
export function webhookSecretBytes(value: unknown) {
    const match = typeof value === 'string' ? /^whsec_([A-Za-z0-9+/]{32,88}={0,2})$/.exec(value) : null;
    if (!match) return null;
    const bytes = Buffer.from(match[1]!, 'base64');
    return bytes.length >= 24 && bytes.length <= 64 && bytes.toString('base64') === match[1] ? bytes : null;
}

/** One `v1,` signature per secret, space-separated (secret rotation). */
export function webhookSignature(secrets: string[], webhookId: string, timestamp: number, body: string) {
    return secrets.map(secret => {
        const key = webhookSecretBytes(secret);
        if (!key) throw new Error('Invalid webhook secret.');
        return `v1,${createHmac('sha256', key).update(`${webhookId}.${timestamp}.${body}`).digest('base64')}`;
    }).join(' ');
}

function failureOf(error: unknown): CallbackFailure {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ESOCKETTIMEDOUT' || code === 'timeout') return 'timeout';
    if (/^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL|HOSTNAME_MISMATCH)/.test(code)) return 'tls_error';
    // A non-public address (`BLOCKED_ADDRESS_CODE`) is reported like an unreachable host: no
    // address or resolution detail reaches the client.
    return 'connection_refused';
}

/** Signs once per attempt (fresh timestamp) and POSTs the exact body bytes. */
export const postWebhook: WebhookPost = request => new Promise(resolve => {
    const url = callbackUrl(request.url);
    if (!url) { resolve({ failure: 'connection_refused' }); return; }
    if (Buffer.byteLength(request.body) > MAX_WEBHOOK_BODY_BYTES) { resolve({ failure: 'http_4xx' }); return; }
    const timestamp = Math.floor(Date.now() / 1000);
    const timeout = Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, request.timeoutMs ?? REQUEST_TIMEOUT_MS));
    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(request.body)),
        'User-Agent': 'uier-mcp-events/1.0',
        'webhook-id': request.webhookId,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': webhookSignature(request.secrets, request.webhookId, timestamp, request.body),
        'X-MCP-Subscription-Id': request.subscriptionId
    };
    let settled = false;
    const finish = (result: WebhookResponse) => { if (!settled) { settled = true; resolve(result); } };
    const onResponse = (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
            else response.destroy();
        });
        const done = () => finish({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES) });
        response.on('end', done);
        response.on('close', done);
        response.on('error', done);
    };
    const options = { method: 'POST', headers, timeout };
    const outgoing = testCallbackUrl(url) ? httpRequest(url, options, onResponse)
        : httpsRequest(url, { ...options, lookup: publicLookup as never }, onResponse);
    // `timeout` is an idle timeout; the deadline also bounds a slowly dripping response.
    const deadline = setTimeout(() => { outgoing.destroy(); finish({ failure: 'timeout' }); }, timeout);
    outgoing.on('timeout', () => { outgoing.destroy(); finish({ failure: 'timeout' }); });
    outgoing.on('error', error => finish({ failure: failureOf(error) }));
    outgoing.on('close', () => clearTimeout(deadline));
    outgoing.end(request.body);
});

export function responseFailure(status: number): CallbackFailure | null {
    if (status >= 200 && status < 300) return null;
    return status >= 500 ? 'http_5xx' : 'http_4xx';
}

/**
 * Endpoint verification before any delivery: a signed, single-use challenge the endpoint must
 * echo as `{"challenge": "..."}` in a 2xx response, compared in constant time.
 */
export async function verifyCallback(post: WebhookPost, url: string, subscriptionId: string, secret: string): Promise<CallbackFailure | null> {
    const challenge = randomBytes(24).toString('base64url');
    const response = await post({ url, subscriptionId, webhookId: `msg_verification_${randomBytes(12).toString('base64url')}`,
        body: JSON.stringify({ type: 'verification', challenge }), secrets: [secret] });
    if ('failure' in response) return response.failure;
    const failure = responseFailure(response.status);
    if (failure) return failure;
    let echoed: unknown;
    try { echoed = (JSON.parse(response.body) as { challenge?: unknown } | null)?.challenge; } catch { return 'challenge_failed'; }
    if (typeof echoed !== 'string') return 'challenge_failed';
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(echoed);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? null : 'challenge_failed';
}
