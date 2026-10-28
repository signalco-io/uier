import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, updateDoc, type AppStore } from '../src/lib/app/store';
import { decryptSecret, encryptSecret, IntegrationSecretError, isSecretKeyConfigured, type SecretContext } from '../src/lib/integrations/secrets';
import { consumeOauthState, createOauthState, OAUTH_STATE_TTL_SECONDS, type IntegrationOauthState } from '../src/lib/integrations/oauthState';
import { acquireGrantLease, releaseGrantLease, saveGrantLease, type LeasedGrant } from '../src/lib/integrations/grants';
import { sha256Hex } from '../src/lib/app/tokens';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const key = { key: randomBytes(32).toString('base64'), keyId: 'k1' };
const context: SecretContext = { provider: 'linear', workspaceId: 'w_fixture', subjectId: 'grant_1', field: 'refresh', userId: 'u_fixture', projectId: 'project_1' };

function binding(provider = 'linear') {
    const id = randomUUID();
    return { provider, workspaceId: `w_${id}`, userId: `u_${id}`, projectId: `project_${id}`, intent: 'connect' };
}

async function stateRows(userId: string, provider: string) {
    return getAppStore().query<IntegrationOauthState>({ type: `${provider}-oauth-state`, pk: `user:${userId}` });
}

test('credentials authenticate every context field, use distinct IVs and do not expose crypto errors', () => {
    const first = encryptSecret('sensitive-refresh-value', context, key);
    const second = encryptSecret('sensitive-refresh-value', context, key);
    expect(first).toMatch(/^v1\.k1\./);
    expect(second).not.toBe(first);
    expect(first).not.toContain('sensitive-refresh-value');
    expect(decryptSecret(first, context, key)).toBe('sensitive-refresh-value');
    for (const changed of ['provider', 'workspaceId', 'subjectId', 'field', 'userId', 'projectId'] as const) {
        expect(() => decryptSecret(first, { ...context, [changed]: `${context[changed]}-different` }, key)).toThrow(IntegrationSecretError);
    }
    const parts = first.split('.');
    parts[4] = `${parts[4]!.startsWith('A') ? 'B' : 'A'}${parts[4]!.slice(1)}`;
    expect(() => decryptSecret(parts.join('.'), context, key)).toThrow('The integration credential could not be read or stored.');
    expect(() => decryptSecret(`${first}.extra`, context, key)).toThrow(IntegrationSecretError);
    expect(() => decryptSecret(first, context, { key: randomBytes(32).toString('base64') })).toThrow(IntegrationSecretError);
});

test('key rotation can read explicitly retained keys and rejects unknown or malformed keys', () => {
    const ciphertext = encryptSecret('old-access', context, key);
    const next = { key: randomBytes(32).toString('base64'), keyId: 'k2', previousKeys: { k1: key.key } };
    expect(decryptSecret(ciphertext, context, next)).toBe('old-access');
    expect(encryptSecret('new-access', context, next)).toMatch(/^v1\.k2\./);
    expect(() => decryptSecret(ciphertext, context, { ...next, previousKeys: {} })).toThrow(IntegrationSecretError);
    expect(() => encryptSecret('token', context, { key: 'not-a-key' })).toThrow(IntegrationSecretError);
    expect(isSecretKeyConfigured({ key: 'not-a-key' })).toBe(false);
});

test('fixed development encryption is unavailable on deployments even when UIER_LOCAL is set', () => {
    const environment = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL };
    try {
        delete process.env.VERCEL;
        delete process.env.VERCEL_ENV;
        delete process.env.VERCEL_URL;
        const local = encryptSecret('local-token', context);
        expect(decryptSecret(local, context)).toBe('local-token');
        process.env.VERCEL = '1';
        expect(isSecretKeyConfigured()).toBe(false);
        expect(() => encryptSecret('token', context)).toThrow(IntegrationSecretError);
        expect(() => decryptSecret(local, context)).toThrow(IntegrationSecretError);
        expect(isSecretKeyConfigured(key)).toBe(true);
    } finally {
        for (const [name, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});

test('OAuth state is random, hashed, PKCE-encrypted and consumed once under concurrent callbacks', async () => {
    const owner = binding();
    const created = await createOauthState({ ...owner, key, metadata: { installationId: '123' } });
    expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.state).not.toContain(owner.projectId);
    const rows = await stateRows(owner.userId, owner.provider);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).toBe(sha256Hex(created.state));
    expect(rows[0]!.verifier).toMatch(/^v1\.k1\./);
    expect(JSON.stringify(rows)).not.toContain(created.state);
    const results = await Promise.all([consumeOauthState({ ...owner, state: created.state, key }), consumeOauthState({ ...owner, state: created.state, key })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const consumed = results.find(Boolean)!;
    expect(consumed.workspaceId).toBe(owner.workspaceId);
    expect(consumed.metadata).toEqual({ installationId: '123' });
    expect(createHash('sha256').update(consumed.codeVerifier!).digest('base64url')).toBe(created.codeChallenge);
    expect((await stateRows(owner.userId, owner.provider))[0]!.verifier).toBeUndefined();
    expect((await stateRows(owner.userId, owner.provider))[0]!.consumedAt).toBeTruthy();
    expect(await consumeOauthState({ ...owner, state: created.state, key })).toBeNull();
});

test('OAuth user/provider/intent binding and explicit expiry do not rely on store TTL', async () => {
    const owner = binding();
    const now = Date.now();
    const created = await createOauthState({ ...owner, key }, getAppStore(), now);
    expect(await consumeOauthState({ ...owner, userId: 'u_foreign', state: created.state, key })).toBeNull();
    expect(await consumeOauthState({ ...owner, provider: 'github', state: created.state, key })).toBeNull();
    expect(await consumeOauthState({ ...owner, state: created.state, key, expected: { intent: 'install' } })).toBeNull();
    expect(await consumeOauthState({ ...owner, state: created.state, key })).toBeNull();
    const expires = await createOauthState({ ...owner, key }, getAppStore(), now);
    expect(await consumeOauthState({ ...owner, state: expires.state, key }, getAppStore(), now + OAUTH_STATE_TTL_SECONDS * 1000)).toBeNull();
    const restart = await createOauthState({ ...owner, key });
    expect(await consumeOauthState({ ...owner, state: restart.state, key, expected: { workspaceId: owner.workspaceId, projectId: owner.projectId, intent: owner.intent } })).not.toBeNull();
});

test('a callback racing with restart cannot consume or delete the newer state', async () => {
    const owner = binding();
    const first = await createOauthState({ ...owner, key });
    const store = getAppStore();
    let restarted: Awaited<ReturnType<typeof createOauthState>> | undefined;
    const racing: AppStore = { ...store, async replace(doc, etag) {
        if (doc.type === `${owner.provider}-oauth-state` && 'consumedAt' in doc && !restarted)
            restarted = await createOauthState({ ...owner, key }, store);
        return store.replace(doc, etag);
    } };
    expect(await consumeOauthState({ ...owner, state: first.state, key }, racing)).toBeNull();
    expect(restarted).toBeDefined();
    expect(await consumeOauthState({ ...owner, state: restarted!.state, key }, store)).not.toBeNull();
});

test('OAuth non-PKCE and denial use the same one-use consumption path without plaintext secrets', async () => {
    const owner = binding('notion');
    const created = await createOauthState({ ...owner, pkce: false });
    expect(created.codeChallenge).toBeUndefined();
    const consumed = await consumeOauthState({ ...owner, state: created.state });
    expect(consumed?.codeVerifier).toBeUndefined();
    expect(consumed?.projectId).toBe(owner.projectId);
    expect(await consumeOauthState({ ...owner, state: created.state })).toBeNull();
});

type FixtureGrant = LeasedGrant & { access: string; refresh: string };
async function grantFixture() {
    const id = randomUUID();
    const grant: FixtureGrant = { pk: `workspace:w_${id}`, id: `grant_${id}`, type: 'linear-grant', provider: 'linear', workspaceId: `w_${id}`,
        generation: 1, status: 'connected', access: 'encrypted-access-1', refresh: 'encrypted-refresh-1' };
    const store = getAppStore();
    await store.create(grant);
    return { grant, store, identity: { pk: grant.pk, id: grant.id, authorize: async () => true } };
}

test('one grant refresh lease wins and saves a token pair under its generation fence', async () => {
    const f = await grantFixture();
    const acquired = await acquireGrantLease<FixtureGrant>(f.identity, f.store);
    expect(acquired).not.toBeNull();
    await expect(acquireGrantLease<FixtureGrant>(f.identity, f.store)).rejects.toMatchObject({ code: 'busy' });
    const saved = await saveGrantLease<FixtureGrant>({ ...f.identity, lease: acquired!.lease,
        update: current => ({ ...current, access: 'encrypted-access-2', refresh: 'encrypted-refresh-2' }) }, f.store);
    expect(saved).toMatchObject({ generation: 2, access: 'encrypted-access-2', refresh: 'encrypted-refresh-2' });
    expect(saved!.refreshLease).toBeUndefined();
    expect(await saveGrantLease<FixtureGrant>({ ...f.identity, lease: acquired!.lease, update: current => current }, f.store)).toBeNull();
});

test('refresh save cannot recreate a deleted grant, revive a revocation, or outlive authority and expiry', async () => {
    const deleted = await grantFixture();
    const first = await acquireGrantLease<FixtureGrant>(deleted.identity, deleted.store);
    await deleted.store.delete(deleted.grant.pk, deleted.grant.id);
    expect(await saveGrantLease<FixtureGrant>({ ...deleted.identity, lease: first!.lease, update: current => current }, deleted.store)).toBeNull();
    expect(await deleted.store.get(deleted.grant.pk, deleted.grant.id)).toBeNull();

    const revoked = await grantFixture();
    const second = await acquireGrantLease<FixtureGrant>(revoked.identity, revoked.store);
    await updateDoc<FixtureGrant>(revoked.grant.pk, revoked.grant.id, current => ({ ...current, status: 'revoked', generation: current.generation + 1, access: '', refresh: '' }), revoked.store);
    expect(await saveGrantLease<FixtureGrant>({ ...revoked.identity, lease: second!.lease, update: current => ({ ...current, access: 'stale' }) }, revoked.store)).toBeNull();
    expect((await revoked.store.get<FixtureGrant>(revoked.grant.pk, revoked.grant.id))!.doc.access).toBe('');

    const expired = await grantFixture();
    const now = Date.now();
    const third = await acquireGrantLease<FixtureGrant>({ ...expired.identity, leaseMs: 1000 }, expired.store, now);
    expect(await saveGrantLease<FixtureGrant>({ ...expired.identity, lease: third!.lease, update: current => current }, expired.store, now + 1001)).toBeNull();
    expect(await saveGrantLease<FixtureGrant>({ ...expired.identity, authorize: async () => false, lease: third!.lease, update: current => current }, expired.store, now)).toBeNull();
});

test('an old holder cannot release another lease or move a grant between scopes', async () => {
    const f = await grantFixture();
    const now = Date.now();
    const first = await acquireGrantLease<FixtureGrant>({ ...f.identity, leaseMs: 1000 }, f.store, now);
    const next = await acquireGrantLease<FixtureGrant>(f.identity, f.store, now + 1001);
    expect(await releaseGrantLease({ pk: f.grant.pk, id: f.grant.id, lease: first!.lease }, f.store, now + 1001)).toBe(false);
    await expect(saveGrantLease<FixtureGrant>({ ...f.identity, lease: next!.lease, update: current => ({ ...current, workspaceId: 'w_foreign' }) }, f.store, now + 1001)).rejects.toMatchObject({ code: 'invalid_update' });
    await expect(saveGrantLease<FixtureGrant>({ ...f.identity, lease: next!.lease, update: current => { current.status = 'revoked'; return current; } }, f.store, now + 1001)).rejects.toMatchObject({ code: 'invalid_update' });
    expect(await releaseGrantLease({ pk: f.grant.pk, id: f.grant.id, lease: next!.lease }, f.store, now + 1001)).toBe(true);
});


test('concurrent refresh acquisition has one winner and a slow authority check cannot save an expired lease', async () => {
    const f = await grantFixture();
    const results = await Promise.allSettled([acquireGrantLease<FixtureGrant>(f.identity, f.store), acquireGrantLease<FixtureGrant>(f.identity, f.store)]);
    expect(results.filter(result => result.status === 'fulfilled' && result.value !== null)).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const short = await grantFixture();
    const acquired = await acquireGrantLease<FixtureGrant>({ ...short.identity, leaseMs: 1000 }, short.store);
    const saved = await saveGrantLease<FixtureGrant>({ ...short.identity, lease: acquired!.lease,
        authorize: async () => { await new Promise(resolve => setTimeout(resolve, 1050)); return true; },
        update: current => ({ ...current, access: 'too-late' }) }, short.store);
    expect(saved).toBeNull();
    expect((await short.store.get<FixtureGrant>(short.grant.pk, short.grant.id))!.doc.access).toBe('encrypted-access-1');
});
