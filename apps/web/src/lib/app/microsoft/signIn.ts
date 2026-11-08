import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCommentsStore } from '../../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../../comments/rateLimits';
import { keyedHash } from '../../comments/environment';
import { getAppStore } from '../store';
import { isRandomToken, randomToken, sha256Hex } from '../tokens';
import { safeNextPath } from '../signIn';
import { requireRecentSignIn } from '../passkeys';
import { emailSchema } from '../users';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { microsoftConfig, microsoftRedirectUri, isMicrosoftSignInConfigured, isMicrosoftTenantId } from './config';
import { boundMicrosoftRecordId, microsoftBindingToken } from './cookie';
import { findUserByMicrosoftSubject, linkMicrosoftAccount, refreshMicrosoftAccountEmail } from './identity';
import { createMicrosoftLink } from './link';
import { fetchProviderPicture, importProviderAvatar, pendingPicture } from '../avatars';
import { microsoftSignInPk, type DbMicrosoftSignIn } from './model';

export const MICROSOFT_SIGN_IN_TTL_SECONDS = 10 * 60;
export const MICROSOFT_SCOPES = 'openid email profile';
const MICROSOFT_STARTS_PER_IP = 30;
const HOUR = 60 * 60;
/** Allowed difference between Microsoft's clock and ours for `iat` */
const CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Linking from Account follows the rule for adding a passkey (`requireRecentSignIn`): a sign-in
 * from the last 10 minutes, so a stolen session cannot attach a Microsoft account that outlives it.
 */
function signedInRecently(signedInAt: number, at?: number) {
    try {
        requireRecentSignIn(signedInAt, at);
        return true;
    } catch {
        return false;
    }
}

export class MicrosoftSignInError extends Error {
    constructor(readonly code: 'not_configured' | 'sign_in_again' | 'token_exchange' | 'invalid_id_token') {
        super('Microsoft sign-in did not work.');
        this.name = 'MicrosoftSignInError';
    }
}

/** The PKCE verifier is never stored: only the server key with the request id and its state can recreate it. */
function pkceVerifier(id: string, state: string) {
    return keyedHash('microsoft-sign-in-pkce', `${id}:${state}`);
}

function sameHash(expected: string, actual: string) {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(actual, 'hex');
    return a.length === 32 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts the authorization code flow with PKCE and a nonce. Returns Microsoft's address and the
 * browser binding (the route sets it as a cookie). `link` links Microsoft to a recently signed-in user.
 */
export async function beginMicrosoftSignIn(input: { next?: string; link?: { userId: string; signedInAt: number }; baseUrl: string; ipBucket?: string }) {
    if (!isMicrosoftSignInConfigured())
        throw new MicrosoftSignInError('not_configured');
    if (input.link && !signedInRecently(input.link.signedInAt))
        throw new MicrosoftSignInError('sign_in_again');
    if (input.ipBucket)
        await consume(getCommentsStore(), APP_COUNTERS_PARTITION, { key: `microsoft-sign-in-ip:${input.ipBucket}`, limit: MICROSOFT_STARTS_PER_IP,
            windowSeconds: HOUR, reason: 'too_fast', message: 'Too many sign-in attempts. Try again later.' });

    const config = microsoftConfig();
    const id = randomBytes(32).toString('hex');
    const state = randomToken();
    const nonce = randomToken();
    await getAppStore().create<DbMicrosoftSignIn>({
        type: 'microsoft-sign-in', id, pk: microsoftSignInPk(id), stateHash: sha256Hex(state), nonceHash: sha256Hex(nonce),
        next: safeNextPath(input.next), linkUserId: input.link?.userId, createdAt: new Date().toISOString(), ttl: MICROSOFT_SIGN_IN_TTL_SECONDS
    });
    const url = new URL(config.authorizeUrl);
    url.search = new URLSearchParams({
        client_id: config.clientId, redirect_uri: microsoftRedirectUri(input.baseUrl), response_type: 'code', scope: MICROSOFT_SCOPES,
        state, nonce, code_challenge: createHash('sha256').update(pkceVerifier(id, state)).digest('base64url'),
        code_challenge_method: 'S256', prompt: 'select_account'
    }).toString();
    return { url: url.href, binding: microsoftBindingToken('flow', id, MICROSOFT_SIGN_IN_TTL_SECONDS) };
}

export type MicrosoftClaims = { subject: string; email?: string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verify RS256 with the tenant's Microsoft keys, then issuer, audience, lifetime and nonce.
 * The unverified tenant only selects a fixed-host key endpoint; it grants no identity.
 * Email and preferred_username are suggestions, never proof of mailbox ownership.
 */
export async function microsoftIdTokenClaims(token: unknown, expected: { clientId: string; authority: string; nonceHash: string }, now = Date.now()): Promise<MicrosoftClaims | null> {
    if (typeof token !== 'string' || token.length > 16_384) return null;
    try {
        const tenant = decodeJwt(token).tid;
        if (!isMicrosoftTenantId(tenant)) return null;
        const issuer = `${expected.authority}/${tenant}/v2.0`;
        const keysUrl = `${expected.authority}/${tenant}/discovery/v2.0/keys`;
        let keys = keySets.get(keysUrl);
        if (!keys) {
            keys = createRemoteJWKSet(new URL(keysUrl), { timeoutDuration: 10_000 });
            if (keySets.size >= 20) keySets.delete(keySets.keys().next().value!);
            keySets.set(keysUrl, keys);
        }
        const { payload: claims } = await jwtVerify(token, async (header, jws) => {
            const key = await keys(header, jws);
            // Entra's key issuer must agree with the token's tenant, including templated issuers.
            const candidates = keys.jwks()?.keys.filter(jwk => jwk.kid === header.kid && jwk.kty === 'RSA');
            if (!candidates?.length || candidates.some(jwk => {
                const keyIssuer = (jwk as { issuer?: unknown }).issuer;
                return typeof keyIssuer !== 'string' || keyIssuer.replace('{tenantid}', tenant) !== issuer;
            })) throw new Error('Invalid key issuer');
            return key;
        }, {
            algorithms: ['RS256'], issuer, audience: expected.clientId, currentDate: new Date(now),
            requiredClaims: ['exp', 'iat', 'sub', 'tid', 'nonce'],
        });
        const { sub, aud, azp, iat, nonce } = claims;
        if (claims.ver !== '2.0' || claims.tid !== tenant || typeof sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(sub)
            || aud !== expected.clientId || (azp !== undefined && azp !== expected.clientId)
            || typeof iat !== 'number' || iat > now / 1000 + CLOCK_SKEW_SECONDS
            || iat < now / 1000 - MICROSOFT_SIGN_IN_TTL_SECONDS - CLOCK_SKEW_SECONDS
            || typeof nonce !== 'string' || !sameHash(expected.nonceHash, sha256Hex(nonce))) return null;
        const email = emailSchema.safeParse(claims.email);
        const username = emailSchema.safeParse(claims.preferred_username);
        return { subject: sha256Hex(`${issuer}\n${sub}`), email: email.success ? email.data : username.success ? username.data : undefined };
    } catch { return null; }
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exchangeCode(code: string, verifier: string, redirectUri: string) {
    const config = microsoftConfig();
    const response = await fetch(config.tokenUrl, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
            redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    const text = await response.text();
    if (!response.ok || text.length > 65_536)
        throw new MicrosoftSignInError('token_exchange');
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new MicrosoftSignInError('token_exchange'); }
    if (!object(body))
        throw new MicrosoftSignInError('token_exchange');
    // The access token only reads the person's photo (`microsoftPhoto`) during this callback; it is never stored
    const accessToken = typeof body.access_token === 'string' && body.access_token.length > 0 && body.access_token.length <= 16_384
        ? body.access_token : undefined;
    return { idToken: body.id_token, accessToken };
}

/** The Microsoft Graph photo of the person who just signed in, or `null` (none, or the token cannot read it) */
function microsoftPhoto(accessToken: string | undefined) {
    return accessToken ? fetchProviderPicture(microsoftConfig().photoUrl, { Authorization: `Bearer ${accessToken}` }) : Promise.resolve(null);
}

export type MicrosoftProblem = 'cancelled' | 'failed' | 'expired' | 'taken' | 'other_account' | 'sign_in_again';
export type MicrosoftSignInOutcome =
    | { kind: 'signed_in'; userId: string; next?: string }
    | { kind: 'confirm_email'; binding: string }
    | { kind: 'linked' }
    | { kind: 'problem'; problem: MicrosoftProblem; next?: string; linking: boolean };

/**
 * The callback. The browser binding, state and nonce must match one live request, which is used
 * up by a delete: only its winner exchanges the code. Then the linking rules decide who signs in.
 */
export async function finishMicrosoftSignIn(input: {
    binding: string | undefined; state: unknown; code: unknown; error: unknown; baseUrl: string;
    /** The browser's session (`getSessionSignIn`), for linking from Account */
    session?: { userId: string; signedInAt: number } | null;
}): Promise<MicrosoftSignInOutcome> {
    const expired = { kind: 'problem', problem: 'expired', linking: false } as const;
    if (!isMicrosoftSignInConfigured()) return expired;
    const id = boundMicrosoftRecordId('flow', input.binding);
    if (!id || !isRandomToken(input.state))
        return expired;
    const store = getAppStore();
    const stored = await store.get<DbMicrosoftSignIn>(microsoftSignInPk(id), id);
    if (!stored || !sameHash(stored.doc.stateHash, sha256Hex(input.state)) || !await store.delete(stored.doc.pk, stored.doc.id))
        return expired;

    const flow = stored.doc;
    const createdAt = Date.parse(flow.createdAt);
    const linking = flow.linkUserId !== undefined;
    const next = safeNextPath(flow.next);
    const problem = (value: MicrosoftProblem) => ({ kind: 'problem', problem: value, next, linking }) as const;
    if (!Number.isFinite(createdAt) || createdAt > Date.now() || createdAt + MICROSOFT_SIGN_IN_TTL_SECONDS * 1000 <= Date.now())
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

    let claims: MicrosoftClaims | null;
    let accessToken: string | undefined;
    try {
        const config = microsoftConfig();
        const tokens = await exchangeCode(input.code, pkceVerifier(flow.id, input.state), microsoftRedirectUri(input.baseUrl));
        accessToken = tokens.accessToken;
        claims = await microsoftIdTokenClaims(tokens.idToken,
            { clientId: config.clientId, authority: config.authority, nonceHash: flow.nonceHash });
    } catch {
        // Never log the code, the token response or the error: they can carry credentials
        claims = null;
    }
    if (!claims)
        return problem('failed');
    if (linking) {
        const result = await linkMicrosoftAccount(flow.linkUserId!, { subject: claims.subject, email: claims.email ?? '' });
        // Connecting Microsoft brings its photo to an account without a picture
        if (result === 'linked') await importProviderAvatar(flow.linkUserId!, 'microsoft', () => microsoftPhoto(accessToken));
        return result === 'linked' ? { kind: 'linked' } : problem(result);
    }
    // Only the linked tenant + subject identifies a user. Claims never grant email access.
    const linked = await findUserByMicrosoftSubject(claims.subject);
    if (linked) {
        if (claims.email) await refreshMicrosoftAccountEmail(linked.id, claims.subject, claims.email);
        return { kind: 'signed_in', userId: linked.id, next };
    }
    // First sign-in always proves a user-chosen inbox, even for outlook.com addresses.
    // The account is chosen later, so the photo is read now and waits with the link
    const pending = await createMicrosoftLink({ subject: claims.subject, email: claims.email ?? '', picture: pendingPicture(await microsoftPhoto(accessToken)) }, next);
    return { kind: 'confirm_email', binding: pending.binding };
}
