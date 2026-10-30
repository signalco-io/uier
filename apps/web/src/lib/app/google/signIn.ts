import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCommentsStore } from '../../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../../comments/rateLimits';
import { keyedHash } from '../../comments/environment';
import { getAppStore } from '../store';
import { isRandomToken, randomToken, sha256Hex } from '../tokens';
import { safeNextPath } from '../signIn';
import { requireRecentSignIn } from '../passkeys';
import { emailSchema, findOrCreateUserWithStatus, nameSchema, updateUserName } from '../users';
import { googleConfig, googleRedirectUri, isGoogleSignInConfigured } from './config';
import { boundGoogleRecordId, googleBindingToken } from './cookie';
import { findUserByGoogleSubject, isGoogleSubject, linkGoogleAccount, refreshGoogleAccountEmail } from './identity';
import { createGoogleLink } from './link';
import { googleSignInPk, type DbGoogleSignIn } from './model';

export const GOOGLE_SIGN_IN_TTL_SECONDS = 10 * 60;
export const GOOGLE_SCOPES = 'openid email profile';
const GOOGLE_STARTS_PER_IP = 30;
const HOUR = 60 * 60;
/** Allowed difference between Google's clock and ours for `iat` */
const CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Linking from Account follows the rule for adding a passkey (`requireRecentSignIn`): a sign-in
 * from the last 10 minutes, so a stolen session cannot attach a Google account that outlives it.
 */
function signedInRecently(signedInAt: number, at?: number) {
    try {
        requireRecentSignIn(signedInAt, at);
        return true;
    } catch {
        return false;
    }
}

export class GoogleSignInError extends Error {
    constructor(readonly code: 'not_configured' | 'sign_in_again' | 'token_exchange' | 'invalid_id_token') {
        super('Google sign-in did not work.');
        this.name = 'GoogleSignInError';
    }
}

/** The PKCE verifier is never stored: only the server key with the request id and its state can recreate it. */
function pkceVerifier(id: string, state: string) {
    return keyedHash('google-sign-in-pkce', `${id}:${state}`);
}

function sameHash(expected: string, actual: string) {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(actual, 'hex');
    return a.length === 32 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts the authorization code flow with PKCE and a nonce. Returns Google's address and the
 * browser binding (the route sets it as a cookie). `link` links Google to a recently signed-in user.
 */
export async function beginGoogleSignIn(input: { next?: string; link?: { userId: string; signedInAt: number }; baseUrl: string; ipBucket?: string }) {
    if (!isGoogleSignInConfigured())
        throw new GoogleSignInError('not_configured');
    if (input.link && !signedInRecently(input.link.signedInAt))
        throw new GoogleSignInError('sign_in_again');
    if (input.ipBucket)
        await consume(getCommentsStore(), APP_COUNTERS_PARTITION, { key: `google-sign-in-ip:${input.ipBucket}`, limit: GOOGLE_STARTS_PER_IP,
            windowSeconds: HOUR, reason: 'too_fast', message: 'Too many sign-in attempts. Try again later.' });

    const config = googleConfig();
    const id = randomBytes(32).toString('hex');
    const state = randomToken();
    const nonce = randomToken();
    await getAppStore().create<DbGoogleSignIn>({
        type: 'google-sign-in', id, pk: googleSignInPk(id), stateHash: sha256Hex(state), nonceHash: sha256Hex(nonce),
        next: safeNextPath(input.next), linkUserId: input.link?.userId, createdAt: new Date().toISOString(), ttl: GOOGLE_SIGN_IN_TTL_SECONDS
    });
    const url = new URL(config.authorizeUrl);
    url.search = new URLSearchParams({
        client_id: config.clientId, redirect_uri: googleRedirectUri(input.baseUrl), response_type: 'code', scope: GOOGLE_SCOPES,
        state, nonce, code_challenge: createHash('sha256').update(pkceVerifier(id, state)).digest('base64url'),
        code_challenge_method: 'S256', prompt: 'select_account'
    }).toString();
    return { url: url.href, binding: googleBindingToken('flow', id, GOOGLE_SIGN_IN_TTL_SECONDS) };
}

export type GoogleClaims = { sub: string; email?: string; emailVerified: boolean; hd?: string; name?: string };

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the ID token from the token endpoint: issuer, audience and authorized party, expiry, issue
 * time and nonce. The signature is not checked: the token comes straight from Google's token endpoint
 * over TLS, authenticated with the client secret (OpenID Connect Core 3.1.3.7, step 6), and it is
 * never passed on. See docs/google-sign-in.md.
 */
export function googleIdTokenClaims(token: unknown, expected: { clientId: string; issuers: string[]; nonceHash: string }, now = Date.now()): GoogleClaims | null {
    if (typeof token !== 'string' || token.length > 16_384)
        return null;
    const [, body, signature, ...rest] = token.split('.');
    if (!body || !signature || rest.length)
        return null;
    let claims: unknown;
    try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
    catch { return null; }
    if (!object(claims))
        return null;

    const { iss, aud, azp, exp, iat, nonce, sub, email, email_verified: emailVerified, hd, name } = claims;
    const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
    const seconds = now / 1000;
    if (typeof iss !== 'string' || !expected.issuers.includes(iss)
        || !audiences.includes(expected.clientId) || (azp !== undefined && azp !== expected.clientId)
        || (audiences.length > 1 && azp !== expected.clientId)
        || typeof exp !== 'number' || exp <= seconds
        || typeof iat !== 'number' || iat > seconds + CLOCK_SKEW_SECONDS || iat < seconds - GOOGLE_SIGN_IN_TTL_SECONDS - CLOCK_SKEW_SECONDS
        || typeof nonce !== 'string' || !sameHash(expected.nonceHash, sha256Hex(nonce))
        || !isGoogleSubject(sub))
        return null;
    return {
        sub,
        email: typeof email === 'string' ? email : undefined,
        // Google sends a boolean; older tokens used the string
        emailVerified: emailVerified === true || emailVerified === 'true',
        hd: typeof hd === 'string' ? hd.toLowerCase() : undefined,
        name: typeof name === 'string' ? name : undefined
    };
}

async function exchangeCode(code: string, verifier: string, redirectUri: string) {
    const config = googleConfig();
    const response = await fetch(config.tokenUrl, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
            redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    const text = await response.text();
    if (!response.ok || text.length > 65_536)
        throw new GoogleSignInError('token_exchange');
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new GoogleSignInError('token_exchange'); }
    if (!object(body))
        throw new GoogleSignInError('token_exchange');
    return body.id_token;
}

/** Google is authoritative for Gmail addresses and for a Workspace domain it names in `hd`. */
export function googleIsAuthoritative(email: string, hd: string | undefined) {
    const domain = email.split('@').pop();
    return domain === 'gmail.com' || (hd !== undefined && domain === hd);
}

export type GoogleProblem = 'cancelled' | 'unverified' | 'failed' | 'expired' | 'taken' | 'other_account' | 'sign_in_again';
export type GoogleSignInOutcome =
    | { kind: 'signed_in'; userId: string; next?: string }
    | { kind: 'confirm_email'; binding: string }
    | { kind: 'linked' }
    | { kind: 'problem'; problem: GoogleProblem; next?: string; linking: boolean };

/**
 * The callback. The browser binding, state and nonce must match one live request, which is used
 * up by a delete: only its winner exchanges the code. Then the linking rules decide who signs in.
 */
export async function finishGoogleSignIn(input: {
    binding: string | undefined; state: unknown; code: unknown; error: unknown; baseUrl: string;
    /** The browser's session (`getSessionSignIn`), for linking from Account */
    session?: { userId: string; signedInAt: number } | null;
}): Promise<GoogleSignInOutcome> {
    const expired = { kind: 'problem', problem: 'expired', linking: false } as const;
    const id = boundGoogleRecordId('flow', input.binding);
    if (!id || !isRandomToken(input.state))
        return expired;
    const store = getAppStore();
    const stored = await store.get<DbGoogleSignIn>(googleSignInPk(id), id);
    if (!stored || !sameHash(stored.doc.stateHash, sha256Hex(input.state)) || !await store.delete(stored.doc.pk, stored.doc.id))
        return expired;

    const flow = stored.doc;
    const createdAt = Date.parse(flow.createdAt);
    const linking = flow.linkUserId !== undefined;
    const next = safeNextPath(flow.next);
    const problem = (value: GoogleProblem) => ({ kind: 'problem', problem: value, next, linking }) as const;
    if (!Number.isFinite(createdAt) || createdAt > Date.now() || createdAt + GOOGLE_SIGN_IN_TTL_SECONDS * 1000 <= Date.now())
        return problem('expired');
    if (input.error !== null && input.error !== undefined)
        return problem(input.error === 'access_denied' ? 'cancelled' : 'failed');
    if (typeof input.code !== 'string' || !input.code || input.code.length > 2048)
        return problem('failed');
    // Linking from Account continues only in the session that started it, still recent when it started
    if (linking && input.session?.userId !== flow.linkUserId)
        return problem('failed');
    if (linking && !signedInRecently(input.session!.signedInAt, createdAt))
        return problem('sign_in_again');

    let claims: GoogleClaims | null;
    try {
        const config = googleConfig();
        claims = googleIdTokenClaims(await exchangeCode(input.code, pkceVerifier(flow.id, input.state), googleRedirectUri(input.baseUrl)),
            { clientId: config.clientId, issuers: config.issuers, nonceHash: flow.nonceHash });
    } catch {
        // Never log the code, the token response or the error: they can carry credentials
        claims = null;
    }
    if (!claims)
        return problem('failed');
    const parsedEmail = emailSchema.safeParse(claims.email);
    const email = claims.emailVerified && parsedEmail.success ? parsedEmail.data : undefined;

    if (linking) {
        const result = await linkGoogleAccount(flow.linkUserId!, { sub: claims.sub, email: parsedEmail.data ?? '' });
        return result === 'linked' ? { kind: 'linked' } : problem(result);
    }

    // 1. A linked Google account signs in as its user, whatever its address is now.
    const linked = await findUserByGoogleSubject(claims.sub);
    if (linked) {
        if (email)
            await refreshGoogleAccountEmail(linked.id, claims.sub, email);
        return { kind: 'signed_in', userId: linked.id, next };
    }
    // 2. Only an address Google verified can find or create an account.
    if (!email)
        return problem('unverified');

    // 3. Where Google is authoritative for the address (Gmail, a Workspace domain it names), it
    // finds or creates the account and links it at once.
    if (googleIsAuthoritative(email, claims.hd)) {
        const { user, created } = await findOrCreateUserWithStatus(email);
        const name = nameSchema.safeParse(claims.name);
        if (created && name.success)
            await updateUserName(user.id, name.data);
        const result = await linkGoogleAccount(user.id, { sub: claims.sub, email });
        return result === 'linked' ? { kind: 'signed_in', userId: user.id, next } : problem(result);
    }
    // 4. Any other address proves its inbox once with an email code, with or without an account:
    // Google's verification of it can be stale (a former employee, a re-registered domain), and an
    // account created for it now would be waiting, already linked, for its real owner.
    const pending = await createGoogleLink({ sub: claims.sub, email }, next);
    return { kind: 'confirm_email', binding: pending.binding };
}
