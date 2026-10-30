import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { sessionSignedInAt, SESSION_TTL_SECONDS } from '../src/lib/app/sessionIdentity';
import { signToken, sha256Hex, verifyToken } from '../src/lib/app/tokens';
import { userPk, type DbPasskeyChallenge, type DbPasskeyCredential } from '../src/lib/app/model';
import {
    listPasskeys, PASSKEY_CHALLENGE_TTL_SECONDS, PASSKEY_RECENT_SIGN_IN_SECONDS, PASSKEY_SIGN_IN_AGAIN, passkeyRegistrationOptions,
    passkeySignInOptions, relyingParty, removePasskey, renamePasskey, verifyPasskeyRegistration, verifyPasskeySignIn
} from '../src/lib/app/passkeys';
import { softAuthenticator } from './support/passkeys';

const rp = { id: 'localhost', origin: 'http://localhost:4004' };
const context = { rp };
const ceremony = { rpId: rp.id, origin: rp.origin };
const now = () => Math.floor(Date.now() / 1000);

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = originalLocal;
});

async function newUser() {
    return await findOrCreateUser(`passkey-${randomUUID().slice(0, 8)}@example.com`);
}

/** A user with one registered passkey */
async function registered(options: Parameters<typeof softAuthenticator>[0] = {}) {
    const user = await newUser();
    const authenticator = softAuthenticator(options);
    const { options: creation, binding } = await passkeyRegistrationOptions(user, now(), context);
    const result = await verifyPasskeyRegistration(user, now(), authenticator.register(creation, ceremony), binding, context);
    expect(result).toMatchObject({ ok: true });
    return { user, authenticator };
}

async function challengeDoc(binding: string) {
    const id = verifyToken<{ challengeId: string }>('passkey-challenge', binding)!.challengeId;
    return (await getAppStore().get<DbPasskeyChallenge>(`passkey-challenge:${id}`, id))!;
}

test('the relying party comes from the trusted base URL, and IP addresses have none', () => {
    expect(relyingParty('https://uier.io')).toEqual({ id: 'uier.io', origin: 'https://uier.io' });
    expect(relyingParty('https://uier-git-branch.vercel.app/')).toEqual({ id: 'uier-git-branch.vercel.app', origin: 'https://uier-git-branch.vercel.app' });
    expect(relyingParty('http://localhost:4004')).toEqual({ id: 'localhost', origin: 'http://localhost:4004' });
    for (const url of ['http://127.0.0.1:4004', 'http://[::1]:4004'])
        expect(relyingParty(url)).toBeNull();
});

test('registration asks for a discoverable, verified credential and excludes the existing ones', async () => {
    const { user, authenticator } = await registered();
    const { options } = await passkeyRegistrationOptions(user, now(), context);
    expect(options.rp).toEqual({ name: 'uier', id: 'localhost' });
    expect(options.user).toMatchObject({ name: user.email, displayName: user.name });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    expect(options.attestation).toBe('none');
    // Ed25519, P-256 and RSA; not ML-DSA, which Node supports only experimentally
    expect(options.pubKeyCredParams.map(param => param.alg)).toEqual([-8, -7, -257]);
    expect(options.excludeCredentials?.map(credential => credential.id)).toEqual([authenticator.id]);

    const [passkey] = await listPasskeys(user.id);
    expect(passkey).toMatchObject({ name: 'Passkey', counter: 0, transports: ['internal'], backedUp: false, deviceType: 'singleDevice', aaguid: '00000000-0000-0000-0000-000000000000' });
    expect(passkey!.lastUsedAt).toBeUndefined();
    const lookup = await getAppStore().get<DbPasskeyCredential>(`passkey:${sha256Hex(authenticator.id)}`, sha256Hex(authenticator.id));
    expect(lookup?.doc.userId).toBe(user.id);
});

test('a passkey signs its user in, moves the counter forward and records its use', async () => {
    const { user, authenticator } = await registered({ synced: true });
    const { options, binding } = await passkeySignInOptions(context);
    expect(options.rpId).toBe('localhost');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials ?? []).toEqual([]);
    const result = await verifyPasskeySignIn(authenticator.authenticate(options, ceremony), binding, context);
    expect(result).toMatchObject({ ok: true, value: { id: user.id } });
    const [passkey] = await listPasskeys(user.id);
    expect(passkey).toMatchObject({ counter: 1, backedUp: true });
    expect(passkey!.lastUsedAt).toBeTruthy();
});

test('a challenge works once, even for parallel verifications', async () => {
    const { user, authenticator } = await registered();
    const { options, binding } = await passkeySignInOptions(context);
    const response = authenticator.authenticate(options, ceremony);
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyPasskeySignIn(response, binding, context)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => result.ok)).toMatchObject({ value: { id: user.id } });
    expect(await verifyPasskeySignIn(response, binding, context)).toEqual({ ok: false, reason: 'expired' });

    // A recorded response does not work with a newer challenge either.
    const next = await passkeySignInOptions(context);
    expect(await verifyPasskeySignIn(response, next.binding, context)).toEqual({ ok: false, reason: 'failed' });
});

test('an expired challenge is rejected and used up', async () => {
    const { authenticator } = await registered();
    const { options, binding } = await passkeySignInOptions(context);
    const stored = await challengeDoc(binding);
    const createdAt = new Date(Date.now() - PASSKEY_CHALLENGE_TTL_SECONDS * 1000 - 1).toISOString();
    expect(await getAppStore().replace({ ...stored.doc, createdAt }, stored.etag)).toBe('ok');
    expect(await verifyPasskeySignIn(authenticator.authenticate(options, ceremony), binding, context)).toEqual({ ok: false, reason: 'expired' });
    expect(await getAppStore().get(stored.doc.pk, stored.doc.id)).toBeNull();
});

test('a challenge belongs to the browser that asked for it', async () => {
    const { authenticator } = await registered();
    const victim = await passkeySignInOptions(context);
    const attacker = await passkeySignInOptions(context);
    const response = authenticator.authenticate(victim.options, ceremony);
    // Missing, tampered and other-purpose bindings never reach a challenge.
    for (const binding of [undefined, '', `${victim.binding}x`, signToken('session', { challengeId: (await challengeDoc(victim.binding)).doc.id }, 300)])
        expect(await verifyPasskeySignIn(response, binding, context)).toEqual({ ok: false, reason: 'expired' });
    // Another browser's binding uses up that browser's challenge, which the response was not signed for.
    expect(await verifyPasskeySignIn(response, attacker.binding, context)).toEqual({ ok: false, reason: 'failed' });
    expect(await verifyPasskeySignIn(response, victim.binding, context)).toMatchObject({ ok: true });
});

test('registration and sign-in challenges are not interchangeable', async () => {
    const { user, authenticator } = await registered();
    const registration = await passkeyRegistrationOptions(user, now(), context);
    const response = authenticator.authenticate(registration.options, ceremony);
    expect(await verifyPasskeySignIn(response, registration.binding, context)).toEqual({ ok: false, reason: 'expired' });

    const other = softAuthenticator();
    const signIn = await passkeySignInOptions(context);
    expect(await verifyPasskeyRegistration(user, now(), other.register({ ...signIn.options, user: { id: 'x' } }, ceremony), signIn.binding, context))
        .toEqual({ ok: false, reason: 'expired' });
    // A registration challenge is bound to the user who asked for it.
    const stranger = await newUser();
    const theirs = await passkeyRegistrationOptions(stranger, now(), context);
    expect(await verifyPasskeyRegistration(user, now(), other.register(theirs.options, ceremony), theirs.binding, context))
        .toEqual({ ok: false, reason: 'expired' });
    expect(await listPasskeys(user.id)).toHaveLength(1);
});

test('an unknown credential is reported so the browser can forget it', async () => {
    const stranger = softAuthenticator();
    const { options, binding } = await passkeySignInOptions(context);
    expect(await verifyPasskeySignIn(stranger.authenticate(options, ceremony), binding, context))
        .toEqual({ ok: false, reason: 'unknown_credential', credentialId: stranger.id });
});

test('a signature counter that does not move forward is rejected; all-zero counters are allowed', async () => {
    const { authenticator } = await registered();
    const signIn = async (counter?: number) => {
        const { options, binding } = await passkeySignInOptions(context);
        return await verifyPasskeySignIn(authenticator.authenticate(options, { ...ceremony, counter }), binding, context);
    };
    expect(await signIn(5)).toMatchObject({ ok: true });
    expect(await signIn(5)).toEqual({ ok: false, reason: 'failed' });
    expect(await signIn(3)).toEqual({ ok: false, reason: 'failed' });
    expect(await signIn(0)).toEqual({ ok: false, reason: 'failed' });
    expect(await signIn(6)).toMatchObject({ ok: true });

    const synced = await registered({ countUp: false });
    for (let attempt = 0; attempt < 2; attempt++) {
        const { options, binding } = await passkeySignInOptions(context);
        expect(await verifyPasskeySignIn(synced.authenticator.authenticate(options, ceremony), binding, context)).toMatchObject({ ok: true });
    }
});

test('responses for another origin or RP ID, without user verification or for another user are rejected', async () => {
    const { authenticator } = await registered();
    for (const wrong of [
        { ...ceremony, origin: 'https://evil.example' },
        { ...ceremony, origin: 'http://localhost:4005' },
        { ...ceremony, rpId: 'evil.example' },
        { ...ceremony, verified: false },
        { ...ceremony, userHandle: 'dV9zb21lb25lLWVsc2U' }
    ]) {
        const { options, binding } = await passkeySignInOptions(context);
        expect(await verifyPasskeySignIn(authenticator.authenticate(options, wrong), binding, context), JSON.stringify(wrong)).toEqual({ ok: false, reason: 'failed' });
    }
    // The same response for this server's own relying party, but checked against another one
    const { options, binding } = await passkeySignInOptions(context);
    expect(await verifyPasskeySignIn(authenticator.authenticate(options, ceremony), binding, { rp: { id: 'uier.io', origin: 'https://uier.io' } }))
        .toEqual({ ok: false, reason: 'failed' });

    const user = await newUser();
    for (const wrong of [{ ...ceremony, origin: 'https://evil.example' }, { ...ceremony, rpId: 'evil.example' }, { ...ceremony, verified: false }]) {
        const registration = await passkeyRegistrationOptions(user, now(), context);
        expect(await verifyPasskeyRegistration(user, now(), softAuthenticator().register(registration.options, wrong), registration.binding, context))
            .toEqual({ ok: false, reason: 'failed' });
    }
    expect(await listPasskeys(user.id)).toEqual([]);
});

test('adding a passkey needs a recent sign-in, both for the options and for the verification', async () => {
    const user = await newUser();
    const stale = now() - PASSKEY_RECENT_SIGN_IN_SECONDS - 1;
    await expect(passkeyRegistrationOptions(user, stale, context)).rejects.toThrow(PASSKEY_SIGN_IN_AGAIN);
    const { options, binding } = await passkeyRegistrationOptions(user, now() - PASSKEY_RECENT_SIGN_IN_SECONDS + 5, context);
    await expect(verifyPasskeyRegistration(user, stale, softAuthenticator().register(options, ceremony), binding, context))
        .rejects.toThrow(PASSKEY_SIGN_IN_AGAIN);
    expect(await listPasskeys(user.id)).toEqual([]);

    // Sessions carry their sign-in time; older tokens fall back to their expiry minus the lifetime.
    expect(sessionSignedInAt(signToken('session', { uid: user.id, iat: 1234 }, 60))).toEqual({ userId: user.id, signedInAt: 1234 });
    const legacy = signToken('session', { uid: user.id }, 60);
    expect(sessionSignedInAt(legacy)?.signedInAt).toBe(verifyToken<{ uid: string }>('session', legacy)!.exp - SESSION_TTL_SECONDS);
    expect(sessionSignedInAt(signToken('review-sso', { uid: user.id, iat: now() }, 60))).toBeNull();
});

test('a removed passkey stops working at once, including a sign-in already in progress', async () => {
    const { user, authenticator } = await registered();
    const [passkey] = await listPasskeys(user.id);
    const { options, binding } = await passkeySignInOptions(context);
    const response = authenticator.authenticate(options, ceremony);
    expect(await removePasskey(user.id, passkey!.id)).toEqual({ credentialId: authenticator.id });
    expect(await removePasskey(user.id, passkey!.id)).toBeNull();
    expect(await verifyPasskeySignIn(response, binding, context)).toEqual({ ok: false, reason: 'unknown_credential', credentialId: authenticator.id });
    expect(await getAppStore().get(`passkey:${sha256Hex(authenticator.id)}`, sha256Hex(authenticator.id))).toBeNull();
    expect(await listPasskeys(user.id)).toEqual([]);
});

test('only the owner can rename or remove a passkey', async () => {
    const { user } = await registered();
    const [passkey] = await listPasskeys(user.id);
    const stranger = await newUser();
    await expect(renamePasskey(stranger.id, passkey!.id, 'Mine now')).rejects.toThrow('This passkey was already removed.');
    expect(await removePasskey(stranger.id, passkey!.id)).toBeNull();
    expect(await renamePasskey(user.id, passkey!.id, 'Work laptop')).toMatchObject({ name: 'Work laptop' });
    expect((await listPasskeys(user.id))[0]).toMatchObject({ name: 'Work laptop' });
});

test('a lookup without its passkey never signs in, and an old one is replaced by a new registration', async () => {
    const user = await newUser();
    const authenticator = softAuthenticator();
    const hash = sha256Hex(authenticator.id);
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await getAppStore().create<DbPasskeyCredential>({ type: 'passkey-credential', id: hash, pk: `passkey:${hash}`, userId: user.id, createdAt: old });
    const { options, binding } = await passkeySignInOptions(context);
    expect(await verifyPasskeySignIn(authenticator.authenticate(options, ceremony), binding, context)).toMatchObject({ ok: false, reason: 'unknown_credential' });
    expect(await getAppStore().get(`passkey:${hash}`, hash)).toBeNull();

    // A fresh lookup of another user (a registration in progress) is never taken over.
    const other = await newUser();
    await getAppStore().create<DbPasskeyCredential>({ type: 'passkey-credential', id: hash, pk: `passkey:${hash}`, userId: other.id, createdAt: new Date().toISOString() });
    const registration = await passkeyRegistrationOptions(user, now(), context);
    expect(await verifyPasskeyRegistration(user, now(), authenticator.register(registration.options, ceremony), registration.binding, context))
        .toEqual({ ok: false, reason: 'already_added' });
    expect(await listPasskeys(user.id)).toEqual([]);

    const stored = (await getAppStore().get<DbPasskeyCredential>(`passkey:${hash}`, hash))!;
    expect(await getAppStore().replace({ ...stored.doc, createdAt: old }, stored.etag)).toBe('ok');
    const retry = await passkeyRegistrationOptions(user, now(), context);
    expect(await verifyPasskeyRegistration(user, now(), authenticator.register(retry.options, ceremony), retry.binding, context)).toMatchObject({ ok: true });
    expect((await getAppStore().get<DbPasskeyCredential>(`passkey:${hash}`, hash))?.doc.userId).toBe(user.id);
    expect(await getAppStore().get(userPk(user.id), `passkey_${hash}`)).not.toBeNull();
});

test('malformed responses are rejected before a challenge is used', async () => {
    const { authenticator } = await registered();
    const { options, binding } = await passkeySignInOptions(context);
    const response = authenticator.authenticate(options, ceremony);
    for (const input of [null, {}, { ...response, type: 'password' }, { ...response, id: 'not base64url!' },
        { ...response, response: { ...response.response, signature: 'a'.repeat(2000) } }])
        await expect(verifyPasskeySignIn(input, binding, context)).rejects.toThrow();
    expect(await verifyPasskeySignIn({ ...response, clientExtensionResults: { evil: true }, extra: 1 }, binding, context)).toMatchObject({ ok: true });
});

test('options and verifications are rate-limited per IP', async () => {
    const limited = { rp, ipBucket: `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID()}` };
    for (let attempt = 0; attempt < 60; attempt++)
        await passkeySignInOptions(limited);
    await expect(passkeySignInOptions(limited)).rejects.toMatchObject({ code: 'rate_limited' });

    const { authenticator } = await registered();
    const { options } = await passkeySignInOptions(context);
    const response = authenticator.authenticate(options, ceremony);
    for (let attempt = 0; attempt < 30; attempt++)
        await verifyPasskeySignIn(response, undefined, limited);
    await expect(verifyPasskeySignIn(response, undefined, limited)).rejects.toMatchObject({ code: 'rate_limited' });
});
