import { createHash, randomBytes } from 'node:crypto';
import { cookieName, cookieNames, readMigratingCookie } from '../cookieNames';
import { isLocalRuntime, keyedHash } from './environment';
import { VISITOR_COOKIE_MAX_AGE_SECONDS, VISITOR_TOKEN_BYTES } from './limits';

export type Visitor = {
    /** Account name for a signed-in reviewer on uier's own public project. */
    name?: string;
    member?: boolean;
    /**
     * sha256(token) hex - stored with comments; the raw token is never stored or returned.
     * Missing on reads by a visitor who never wrote anything (no cookie yet).
     */
    authorId?: string;
    hasCookie?: boolean;
    /** `Set-Cookie` value for a new identity (sent only with a successful write) */
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
    if (!isLocalRuntime())
        return true;

    const url = new URL(request.url);
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
    const host = request.headers.get('host') ?? url.host;
    const hostname = host.replace(/:\d+$/, '').toLowerCase();
    return !(protocol === 'http' && isLoopbackHostname(hostname));
}

function serializeVisitorCookie(token: string, secure: boolean, maxAgeSeconds = VISITOR_COOKIE_MAX_AGE_SECONDS, name = cookieName(cookieNames.visitor, secure)) {
    return [
        `${name}=${token}`,
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : [])
    ].join('; ');
}

/** `Set-Cookie` value that removes the visitor cookie from the browser (signing out) */
export function expiredVisitorCookies(request: Request) {
    const secure = shouldUseSecureCookie(request);
    return [...new Set([cookieName(cookieNames.visitor, secure), cookieNames.visitor.legacy])]
        .map(name => serializeVisitorCookie('', secure, 0, name));
}

/**
 * Resolves the anonymous visitor from the `__Host-uier_visitor` cookie. A new identity is created only
 * for writes (`createIfMissing`), including explicit Mark as read actions. GETs and anonymous
 * thread opening do not create one; the toolbar skips automatic reads without an identity.
 */
export function resolveVisitor(request: Request, createIfMissing: boolean): Visitor {
    const secure = shouldUseSecureCookie(request);
    const token = readMigratingCookie({ get: name => {
        const value = readCookie(request, name);
        return value === undefined ? undefined : { value };
    } }, cookieNames.visitor, secure);
    if (token && tokenPattern.test(token))
        return { authorId: sha256Hex(token), hasCookie: true,
            ...(createIfMissing && !readCookie(request, cookieName(cookieNames.visitor, secure))
                ? { setCookie: serializeVisitorCookie(token, secure) } : {})
        };

    const supplied = request.headers.get('x-uier-visitor');
    if (supplied && tokenPattern.test(supplied)) return {
        authorId: sha256Hex(supplied),
        ...(createIfMissing ? { setCookie: serializeVisitorCookie(supplied, shouldUseSecureCookie(request)) } : {})
    };
    if (!createIfMissing)
        return {};

    const newToken = randomBytes(VISITOR_TOKEN_BYTES).toString('base64url');
    return {
        authorId: sha256Hex(newToken),
        setCookie: serializeVisitorCookie(newToken, shouldUseSecureCookie(request))
    };
}

/** Client IP: Vercel's `x-vercel-forwarded-for`, then the first `x-forwarded-for` entry, then `x-real-ip` */
export function resolveClientIp(request: Request) {
    for (const header of ['x-vercel-forwarded-for', 'x-forwarded-for']) {
        const ip = request.headers.get(header)?.split(',')[0]?.trim();
        if (ip)
            return ip;
    }
    return request.headers.get('x-real-ip')?.trim() || undefined;
}

export function isLoopbackIp(ip: string) {
    return ip === '::1' || ip.startsWith('127.') || ip.toLowerCase() === '::ffff:127.0.0.1';
}

/** The eight 16-bit groups of an IPv6 address as hex strings, or `null` when it can't be parsed */
function ipv6Groups(ip: string) {
    const address = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
    const [head = '', tail, ...rest] = address.split('::');
    if (rest.length)
        return null;

    const toGroups = (part: string) => part ? part.split(':') : [];
    const headGroups = toGroups(head);
    const tailGroups = toGroups(tail ?? '');

    // An embedded IPv4 address (e.g. 64:ff9b::192.0.2.1) takes two groups
    const last = tailGroups.length ? tailGroups : headGroups;
    const ipv4 = last.at(-1)?.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
        const [a, b, c, d] = ipv4.slice(1).map(Number) as [number, number, number, number];
        last.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }

    const missing = 8 - headGroups.length - tailGroups.length;
    if (tail === undefined ? missing !== 0 : missing < 1)
        return null;

    const groups = [...headGroups, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...tailGroups];
    return groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))
        ? groups.map(group => group.toLowerCase().replace(/^0+(?=.)/, ''))
        : null;
}

/**
 * The address a rate limit applies to: an IPv4 address, or the /64 network of an IPv6 address
 * (one subscriber usually gets a whole /64, so single IPv6 addresses are free to rotate).
 */
export function ipRateLimitBucket(ip: string) {
    const mappedIpv4 = ip.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mappedIpv4)
        return mappedIpv4;

    const groups = ipv6Groups(ip);
    return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip.toLowerCase();
}

/**
 * "Guest XXXX" from a keyed hash of the author id, so a matching cookie can't be computed offline
 * to impersonate another visitor's name.
 */
export function displayName(authorId: string | undefined) {
    return authorId ? `Guest ${keyedHash('name', authorId).slice(0, 4).toUpperCase()}` : 'Guest';
}
