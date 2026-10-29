import { configuredAppBaseUrl } from '../../app/deployment';
import { ApiError } from '../../comments/http';
import { consume } from '../../comments/rateLimits';
import { ipRateLimitBucket, isLoopbackIp, resolveClientIp } from '../../comments/visitor';
import { isLocalRuntime } from '../../comments/environment';
import { getCommentsStore } from '../../repo/commentsStore';
import { mcpOauthEnabled } from './config';
import { OAuthError, oauthErrorResponse } from './errors';

/**
 * The issuer: the app origin (https://uier.io in production, the preview or local origin elsewhere).
 * Same result as `appBaseUrl()`, which is loaded only when no base URL is configured: it reads the
 * request's Host through `next/headers`, which the API specs cannot load in process.
 */
export async function oauthIssuer() {
    const configured = configuredAppBaseUrl();
    if (configured) return new URL(configured).origin;
    const { appBaseUrl } = await import('../../app/request');
    return new URL(await appBaseUrl()).origin;
}

function ipBucket(request: Request) {
    const ip = resolveClientIp(request);
    if (!ip) return isLocalRuntime() ? undefined : 'unknown';
    if (isLocalRuntime() && isLoopbackIp(ip)) return undefined;
    return ipRateLimitBucket(ip);
}

async function consumeLimit(key: string, limit: number, windowSeconds: number) {
    try {
        await consume(getCommentsStore(), '$mcp', { key, limit, windowSeconds, reason: 'too_fast', message: 'Too many requests. Try again later.' });
    } catch (error) {
        if (error instanceof ApiError && error.status === 429)
            throw new OAuthError('temporarily_unavailable', error.message, 429, error.retryAfterSeconds);
        throw error;
    }
}

/** Counts one request per IP in a fixed window; local loopback requests are not limited. */
export async function limitByIp(request: Request, name: string, limit: number, windowSeconds = 3600) {
    const bucket = ipBucket(request);
    if (bucket) await consumeLimit(`oauth-${name}:${bucket}`, limit, windowSeconds);
}

/** Counts one request across all IPs in a fixed window; local loopback requests are not limited. */
export async function limitGlobally(request: Request, name: string, limit: number, windowSeconds = 3600) {
    if (ipBucket(request)) await consumeLimit(`oauth-${name}`, limit, windowSeconds);
}

/** Counts one request per subject (a user, a grant, a metadata host) in a fixed window. */
export async function limitByKey(name: string, subject: string, limit: number, windowSeconds = 3600) {
    await consumeLimit(`oauth-${name}:${subject}`, limit, windowSeconds);
}

/** Form bodies of the token and revocation endpoints: `application/x-www-form-urlencoded`, at most 16 KiB */
export async function readForm(request: Request) {
    if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get('content-type') ?? ''))
        throw new OAuthError('invalid_request', 'Send application/x-www-form-urlencoded.');
    const text = await request.text();
    if (Buffer.byteLength(text) > 16_384) throw new OAuthError('invalid_request', 'The request is too large.');
    return new URLSearchParams(text);
}

export function oauthNotFound() {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

/** Runs an OAuth endpoint: 404 while OAuth is off, RFC 6749 JSON errors otherwise */
export async function oauthEndpoint(action: () => Promise<Response>) {
    if (!mcpOauthEnabled()) return oauthNotFound();
    try { return await action(); } catch (error) { return oauthErrorResponse(error); }
}
