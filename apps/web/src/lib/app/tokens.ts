import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { keyedHash } from '../comments/environment';

/** 32 random bytes as base64url, for links that are sent by email (stored only as a hash) */
export function randomToken() {
    return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

const randomTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isRandomToken(value: unknown): value is string {
    return typeof value === 'string' && randomTokenPattern.test(value);
}

type TokenPayload = { exp: number };

/**
 * A signed, expiring token: `<base64url JSON payload>.<HMAC>`. The key is derived from the
 * server secret (see `keyedHash`) and the purpose, so a token of one kind is never valid as another.
 */
export function signToken<T extends object>(purpose: string, payload: T, ttlSeconds: number) {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${keyedHash(`token:${purpose}`, body)}`;
}

/** The payload of a valid, unexpired token of this purpose, otherwise `null` */
export function verifyToken<T extends object>(purpose: string, token: string | undefined | null): (T & TokenPayload) | null {
    if (!token || token.length > 2048)
        return null;

    const [body, signature, ...rest] = token.split('.');
    if (!body || !signature || rest.length)
        return null;

    const expected = Buffer.from(keyedHash(`token:${purpose}`, body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & TokenPayload;
        if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now())
            return null;
        return payload;
    } catch {
        return null;
    }
}
