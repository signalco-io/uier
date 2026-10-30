import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type AuthenticatorTransport,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { COSEALG, isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { brand } from '@uier/brand';
import { getCommentsStore } from '../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../comments/rateLimits';
import { cookieName, cookieNames } from '../cookieNames';
import { UserFacingError } from './actionErrors';
import { MAX_PASSKEY_NAME_LENGTH, MAX_PASSKEYS } from './limits';
import { getAppStore, updateDoc } from './store';
import { sha256Hex, signToken, verifyToken } from './tokens';
import { getUser } from './users';
import { userPk, type DbPasskey, type DbPasskeyChallenge, type DbPasskeyCredential, type DbUser } from './model';

// Passkeys (WebAuthn) for signing in to the app. People add them on Account and sign in with them
// on /app/sign-in. Every ceremony uses a single-use challenge record, bound to the browser by a
// signed cookie that holds only its id, and consumed by an atomic delete whose winner continues.

export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
/**
 * Adding a passkey needs a sign-in from the last 10 minutes on this browser (a code, a link or
 * another passkey). A stolen session cookie that is older can't add a passkey and so can't keep
 * access after the person signs out.
 */
export const PASSKEY_RECENT_SIGN_IN_SECONDS = 10 * 60;
export const PASSKEY_CHALLENGE_COOKIE_NAME = cookieName(cookieNames.passkeyChallenge);
export const PASSKEY_SIGN_IN_AGAIN = 'Sign in again to add a passkey. Adding one needs a sign-in from the last 10 minutes.';

/** A lookup older than this without its passkey was left by an interrupted registration or removal */
const ORPHANED_CREDENTIAL_SECONDS = 60;
const RATE_WINDOW_SECONDS = 10 * 60;
const OPTIONS_PER_IP = 60;
const VERIFICATIONS_PER_IP = 30;
const TOO_MANY = 'Too many passkey attempts. Try again in a few minutes.';
const CHALLENGE_PURPOSE = 'passkey-challenge';
/**
 * Ed25519, P-256 and RSA. Not the library's default ML-DSA: Node's support for it is experimental,
 * and its signatures are larger than the response limits below.
 */
const algorithms = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];
const knownTransports = new Set<string>(['ble', 'hybrid', 'internal', 'nfc', 'usb'] satisfies AuthenticatorTransport[]);
const isTransport = (value: string): value is AuthenticatorTransport => knownTransports.has(value);

const challengePk = (id: string) => `passkey-challenge:${id}` as const;
const credentialPk = (hash: string) => `passkey:${hash}` as const;
const passkeyDocId = (hash: string) => `passkey_${hash}`;

/** The relying party: the app's trusted base URL (`appBaseUrl()`), never a raw Host header */
export type PasskeyRelyingParty = { id: string; origin: string };

/** `null` where WebAuthn can't work: an IP address is never a valid RP ID (use localhost locally) */
export function relyingParty(baseUrl: string): PasskeyRelyingParty | null {
    const url = new URL(baseUrl);
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')))
        return null;
    return { id: url.hostname, origin: url.origin };
}

export type PasskeyCeremonyContext = {
    rp: PasskeyRelyingParty;
    /** IPv4 address or IPv6 /64; missing for local loopback requests (no limit) */
    ipBucket?: string;
};

export type PasskeyFailure = 'expired' | 'unknown_credential' | 'already_added' | 'failed';
export type PasskeyResult<T> = { ok: true; value: T } | { ok: false; reason: PasskeyFailure; credentialId?: string };

/** What Account shows; never the public key */
export type PasskeyView = Pick<DbPasskey, 'id' | 'name' | 'createdAt' | 'lastUsedAt' | 'backedUp'>;

const base64Url = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);
const credentialIdSchema = base64Url(1366);
export const passkeyIdSchema = z.string().regex(/^passkey_[a-f0-9]{64}$/);
export const passkeyNameSchema = z.string().trim()
    .min(1, 'Enter a name for the passkey.')
    .max(MAX_PASSKEY_NAME_LENGTH, `Use at most ${MAX_PASSKEY_NAME_LENGTH} characters.`);

const responseEnvelope = {
    id: credentialIdSchema,
    rawId: credentialIdSchema,
    type: z.literal('public-key'),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional()
};

/** Only the fields verification reads; extension results and anything else are dropped */
export const registrationResponseSchema = z.object({
    ...responseEnvelope,
    response: z.object({
        clientDataJSON: base64Url(4096),
        attestationObject: base64Url(16384),
        transports: z.array(z.string().max(32)).max(10).optional().transform(list => list?.filter(isTransport))
    })
}).transform((value): RegistrationResponseJSON => ({ ...value, clientExtensionResults: {} }));

export const authenticationResponseSchema = z.object({
    ...responseEnvelope,
    response: z.object({
        clientDataJSON: base64Url(4096),
        authenticatorData: base64Url(4096),
        signature: base64Url(1024),
        userHandle: base64Url(128).optional()
    })
}).transform((value): AuthenticationResponseJSON => ({ ...value, clientExtensionResults: {} }));

async function limit(kind: 'options' | 'verify', ipBucket: string | undefined) {
    if (!ipBucket)
        return;
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `passkey-${kind}-ip:${ipBucket}`,
        limit: kind === 'options' ? OPTIONS_PER_IP : VERIFICATIONS_PER_IP,
        windowSeconds: RATE_WINDOW_SECONDS, reason: 'too_fast', message: TOO_MANY
    });
}

/** The signed binding holds only the challenge record's id. Each new ceremony replaces it. */
export function passkeyChallengeToken(challengeId: string) {
    return signToken<{ challengeId: string }>(CHALLENGE_PURPOSE, { challengeId }, PASSKEY_CHALLENGE_TTL_SECONDS);
}

function boundChallengeId(binding: string | undefined) {
    const payload = verifyToken<{ challengeId: string }>(CHALLENGE_PURPOSE, binding);
    return typeof payload?.challengeId === 'string' && /^[a-f0-9]{64}$/.test(payload.challengeId) ? payload.challengeId : null;
}

async function saveChallenge(purpose: DbPasskeyChallenge['purpose'], challenge: string, userId?: string) {
    const id = randomBytes(32).toString('hex');
    await getAppStore().create<DbPasskeyChallenge>({
        type: 'passkey-challenge', id, pk: challengePk(id), purpose, challenge,
        ...(userId ? { userId } : {}),
        createdAt: new Date().toISOString(), ttl: PASSKEY_CHALLENGE_TTL_SECONDS
    });
    return passkeyChallengeToken(id);
}

/**
 * Uses up the browser's challenge. Only the winner of the delete continues, so a response can be
 * verified once; a challenge of the other purpose, or an expired one, is used up all the same.
 */
async function consumeChallenge(binding: string | undefined, purpose: DbPasskeyChallenge['purpose']) {
    const id = boundChallengeId(binding);
    if (!id)
        return null;
    const store = getAppStore();
    const stored = await store.get<DbPasskeyChallenge>(challengePk(id), id);
    if (!stored || !await store.delete(stored.doc.pk, stored.doc.id))
        return null;
    const challenge = stored.doc;
    if (challenge.purpose !== purpose || Date.parse(challenge.createdAt) + PASSKEY_CHALLENGE_TTL_SECONDS * 1000 <= Date.now())
        return null;
    return challenge;
}

/** Throws unless the session signed in recently enough, at `at` (ms) */
export function requireRecentSignIn(signedInAt: number, at = Date.now()) {
    if (at - signedInAt * 1000 > PASSKEY_RECENT_SIGN_IN_SECONDS * 1000)
        throw new UserFacingError(PASSKEY_SIGN_IN_AGAIN);
}

export async function listPasskeys(userId: string) {
    const passkeys = await getAppStore().query<DbPasskey>({ type: 'passkey', pk: userPk(userId) });
    return passkeys.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function passkeyView({ id, name, createdAt, lastUsedAt, backedUp }: DbPasskey): PasskeyView {
    return { id, name, createdAt, lastUsedAt, backedUp };
}

/** WebAuthn's user handle: the user id, which holds nothing personal */
function userHandle(userId: string) {
    return isoUint8Array.fromUTF8String(userId);
}

export async function passkeyRegistrationOptions(user: DbUser, signedInAt: number, { rp, ipBucket }: PasskeyCeremonyContext): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; binding: string }> {
    await limit('options', ipBucket);
    requireRecentSignIn(signedInAt);
    const existing = await listPasskeys(user.id);
    if (existing.length >= MAX_PASSKEYS)
        throw new UserFacingError(`You can add up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const options = await generateRegistrationOptions({
        rpName: brand.name,
        rpID: rp.id,
        userID: userHandle(user.id),
        userName: user.email,
        userDisplayName: user.name,
        timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
        attestationType: 'none',
        supportedAlgorithmIDs: algorithms,
        // Discoverable, so sign-in needs no email; user verification makes it two factors in one.
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: existing.map(passkey => ({ id: passkey.credentialId, transports: passkey.transports.filter(isTransport) }))
    });
    return { options, binding: await saveChallenge('register', options.challenge, user.id) };
}

export async function verifyPasskeyRegistration(user: DbUser, signedInAt: number, input: unknown, binding: string | undefined, { rp, ipBucket }: PasskeyCeremonyContext): Promise<PasskeyResult<PasskeyView>> {
    await limit('verify', ipBucket);
    const response = registrationResponseSchema.parse(input);
    const challenge = await consumeChallenge(binding, 'register');
    if (!challenge || challenge.userId !== user.id)
        return { ok: false, reason: 'expired' };
    // The session had to be recent when the challenge was issued, the same rule as for the options.
    requireRecentSignIn(signedInAt, Date.parse(challenge.createdAt));

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response, expectedChallenge: challenge.challenge,
            expectedOrigin: rp.origin, expectedRPID: rp.id,
            requireUserVerification: true, supportedAlgorithmIDs: algorithms
        });
    } catch {
        return { ok: false, reason: 'failed' };
    }
    if (!verification.verified)
        return { ok: false, reason: 'failed' };

    const existing = await listPasskeys(user.id);
    if (existing.length >= MAX_PASSKEYS)
        throw new UserFacingError(`You can add up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const { credential, aaguid, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const hash = sha256Hex(credential.id);
    const passkey: DbPasskey = {
        type: 'passkey',
        id: passkeyDocId(hash),
        pk: userPk(user.id),
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: response.response.transports ?? [],
        aaguid,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: defaultPasskeyName(existing),
        createdAt: new Date().toISOString()
    };

    // The lookup first, then the passkey: a lookup without its passkey is never used at sign-in
    // (and is replaced later), while a passkey without its lookup would show on Account and never work.
    if (!await claimCredential(hash, user.id))
        return { ok: false, reason: 'already_added' };
    if (!await getAppStore().create(passkey))
        return { ok: false, reason: 'already_added' };
    return { ok: true, value: passkeyView(passkey) };
}

/** "Passkey", then "Passkey 2", ...: the first name no other passkey of the user has */
function defaultPasskeyName(existing: DbPasskey[]) {
    const names = new Set(existing.map(passkey => passkey.name));
    for (let index = 1; ; index++) {
        const name = index === 1 ? 'Passkey' : `Passkey ${index}`;
        if (!names.has(name))
            return name;
    }
}

async function claimCredential(hash: string, userId: string) {
    const store = getAppStore();
    for (let attempt = 0; attempt < 2; attempt++) {
        if (await store.create<DbPasskeyCredential>({ type: 'passkey-credential', id: hash, pk: credentialPk(hash), userId, createdAt: new Date().toISOString() }))
            return true;
        const lookup = await store.get<DbPasskeyCredential>(credentialPk(hash), hash);
        if (!lookup)
            continue;
        if (!await isOrphaned(lookup.doc, hash))
            return false;
        await store.transact([{ kind: 'delete', pk: lookup.doc.pk, id: lookup.doc.id, etag: lookup.etag }]);
    }
    return false;
}

async function isOrphaned(lookup: DbPasskeyCredential, hash: string) {
    return Date.parse(lookup.createdAt) + ORPHANED_CREDENTIAL_SECONDS * 1000 <= Date.now()
        && !await getAppStore().get<DbPasskey>(userPk(lookup.userId), passkeyDocId(hash));
}

export async function passkeySignInOptions({ rp, ipBucket }: PasskeyCeremonyContext): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; binding: string }> {
    await limit('options', ipBucket);
    // No allowCredentials: the browser offers the passkeys it has for uier (discoverable credentials).
    const options = await generateAuthenticationOptions({
        rpID: rp.id, userVerification: 'required', timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000
    });
    return { options, binding: await saveChallenge('sign-in', options.challenge) };
}

/** The user of a valid response. Only the challenge's winner gets here; its passkey must still exist. */
export async function verifyPasskeySignIn(input: unknown, binding: string | undefined, { rp, ipBucket }: PasskeyCeremonyContext): Promise<PasskeyResult<DbUser>> {
    await limit('verify', ipBucket);
    const response = authenticationResponseSchema.parse(input);
    const challenge = await consumeChallenge(binding, 'sign-in');
    if (!challenge)
        return { ok: false, reason: 'expired' };

    const store = getAppStore();
    const hash = sha256Hex(response.id);
    const lookup = await store.get<DbPasskeyCredential>(credentialPk(hash), hash);
    const stored = lookup && await store.get<DbPasskey>(userPk(lookup.doc.userId), passkeyDocId(hash));
    if (!lookup || !stored) {
        if (lookup && await isOrphaned(lookup.doc, hash))
            await store.transact([{ kind: 'delete', pk: lookup.doc.pk, id: lookup.doc.id, etag: lookup.etag }]);
        return { ok: false, reason: 'unknown_credential', credentialId: response.id };
    }
    const passkey = stored.doc;
    // A discoverable credential returns the user handle it was created with.
    if (response.response.userHandle !== undefined && response.response.userHandle !== isoBase64URL.fromBuffer(userHandle(lookup.doc.userId)))
        return { ok: false, reason: 'failed' };

    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response, expectedChallenge: challenge.challenge,
            expectedOrigin: rp.origin, expectedRPID: rp.id,
            credential: { id: passkey.credentialId, publicKey: isoBase64URL.toBuffer(passkey.publicKey), counter: passkey.counter, transports: passkey.transports.filter(isTransport) },
            requireUserVerification: true
        });
    } catch {
        // Includes a signature counter that did not move forward: a cloned authenticator.
        return { ok: false, reason: 'failed' };
    }
    const { newCounter, credentialBackedUp } = verification.authenticationInfo;
    // The library allows equal counters only when both are zero (authenticators without a counter).
    if (!verification.verified || ((newCounter > 0 || passkey.counter > 0) && newCounter <= passkey.counter))
        return { ok: false, reason: 'failed' };

    // Conditional on the version read above: a passkey removed (or used) meanwhile fails here.
    const updated: DbPasskey = { ...passkey, counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: new Date().toISOString() };
    if (await store.replace(updated, stored.etag) !== 'ok')
        return { ok: false, reason: 'failed' };
    const user = await getUser(lookup.doc.userId);
    return user ? { ok: true, value: user } : { ok: false, reason: 'failed' };
}

export async function renamePasskey(userId: string, passkeyId: string, name: string) {
    const updated = await updateDoc<DbPasskey>(userPk(userId), passkeyId, passkey => {
        if (passkey.type !== 'passkey')
            throw new UserFacingError('This passkey was already removed.');
        return { ...passkey, name };
    });
    if (!updated)
        throw new UserFacingError('This passkey was already removed.');
    return passkeyView(updated);
}

/**
 * Removes the passkey first, which stops it at once (sign-in needs it), then its lookup. Returns the
 * credential id and RP ID so the browser can be told to forget it, or `null` when it was already gone.
 */
export async function removePasskey(userId: string, passkeyId: string) {
    const store = getAppStore();
    const stored = await store.get<DbPasskey>(userPk(userId), passkeyId);
    if (!stored || stored.doc.type !== 'passkey' || !await store.delete(stored.doc.pk, stored.doc.id))
        return null;
    const hash = sha256Hex(stored.doc.credentialId);
    const lookup = await store.get<DbPasskeyCredential>(credentialPk(hash), hash);
    if (lookup?.doc.userId === userId)
        await store.transact([{ kind: 'delete', pk: lookup.doc.pk, id: lookup.doc.id, etag: lookup.etag }]);
    return { credentialId: stored.doc.credentialId };
}
