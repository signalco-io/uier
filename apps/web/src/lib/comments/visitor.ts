import { createHash, randomBytes } from 'node:crypto';
import { VISITOR_COOKIE_MAX_AGE_SECONDS, VISITOR_COOKIE_NAME, VISITOR_TOKEN_BYTES } from './limits';

export type Visitor = {
    /** sha256(token) hex - stored with comments; the raw token is never stored or returned */
    authorId: string;
    /** `Set-Cookie` value when the visitor did not have a (valid) cookie yet */
    setCookie?: string;
};

// 32 random bytes as base64url (no padding) = 43 characters
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

function readCookie(request: Request, name: string) {
    const header = request.headers.get('cookie');
    if (!header)
        return undefined;

    for (const part of header.split(';')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex < 0)
            continue;
        if (part.slice(0, separatorIndex).trim() === name)
            return part.slice(separatorIndex + 1).trim();
    }

    return undefined;
}

const loopbackHostnames = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHostname(hostname: string) {
    return loopbackHostnames.has(hostname) || hostname.endsWith('.localhost');
}

/** `Secure` everywhere except plain http on a loopback host (local development and tests) */
function shouldUseSecureCookie(request: Request) {
    if (process.env.VERCEL)
        return true;

    const url = new URL(request.url);
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
    const host = request.headers.get('host') ?? url.host;
    const hostname = host.replace(/:\d+$/, '').toLowerCase();
    return !(protocol === 'http' && isLoopbackHostname(hostname));
}

function serializeVisitorCookie(token: string, secure: boolean) {
    return [
        `${VISITOR_COOKIE_NAME}=${token}`,
        'Path=/',
        `Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : [])
    ].join('; ');
}

/** Resolves the anonymous visitor from the `uier_visitor` cookie, creating a new identity when missing or invalid */
export function resolveVisitor(request: Request): Visitor {
    const token = readCookie(request, VISITOR_COOKIE_NAME);
    if (token && tokenPattern.test(token))
        return { authorId: sha256Hex(token) };

    const newToken = randomBytes(VISITOR_TOKEN_BYTES).toString('base64url');
    return {
        authorId: sha256Hex(newToken),
        setCookie: serializeVisitorCookie(newToken, shouldUseSecureCookie(request))
    };
}

/** Client IP: first `x-forwarded-for` entry, then `x-real-ip` (both set by Vercel) */
export function resolveClientIp(request: Request) {
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwardedFor)
        return forwardedFor;
    return request.headers.get('x-real-ip')?.trim() || undefined;
}

export function isLoopbackIp(ip: string) {
    return ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}

/** sha256(ip + ':' + domain) - used for IP rate limiting only and never returned */
export function hashIp(ip: string, domain: string) {
    return sha256Hex(`${ip}:${domain}`);
}

export function displayName(authorId: string | undefined) {
    return authorId ? `Guest ${authorId.slice(0, 4).toUpperCase()}` : 'Guest';
}
