import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { keyedHash } from '../src/lib/comments/environment';
import { getAppStore } from '../src/lib/app/store';
import type { DbSignInRequest } from '../src/lib/app/model';
import { confirmSignIn, confirmSignInCode, SIGN_IN_LINK_TTL_SECONDS } from '../src/lib/app/signIn';
import { signInRequestToken } from '../src/lib/app/signInCookie';
import { randomToken, sha256Hex } from '../src/lib/app/tokens';
import { findOrCreateUser, findUserByEmail, getUser } from '../src/lib/app/users';
import { isMicrosoftSignInConfigured, microsoftConfig, microsoftRedirectUri } from '../src/lib/app/microsoft/config';
import { boundMicrosoftRecordId } from '../src/lib/app/microsoft/cookie';
import { findUserByMicrosoftSubject, getMicrosoftAccount, linkMicrosoftAccount, unlinkMicrosoftAccount } from '../src/lib/app/microsoft/identity';
import { getMicrosoftLink, microsoftLinkIdFor, MICROSOFT_LINK_TTL_SECONDS } from '../src/lib/app/microsoft/link';
import { microsoftSignInPk, microsoftLinkPk, type DbMicrosoftSignIn, type DbMicrosoftLink } from '../src/lib/app/microsoft/model';
import { beginMicrosoftSignIn, finishMicrosoftSignIn, microsoftIdTokenClaims, MICROSOFT_SIGN_IN_TTL_SECONDS, type MicrosoftSignInOutcome } from '../src/lib/app/microsoft/signIn';
import { PASSKEY_RECENT_SIGN_IN_SECONDS } from '../src/lib/app/passkeys';
import { microsoftTenant, startMicrosoftStub, type MicrosoftStub, type StubMicrosoftIdentity } from './support/microsoftStub';
import { uniqueEmail } from './support/app';
import { getAvatarImage, normalizeAvatar, saveUserAvatar, type AvatarImage } from '../src/lib/app/avatars';
import { stubPicturePng } from './support/microsoftStub';

const baseUrl = 'http://localhost:4004';
const managedEnv = ['UIER_LOCAL', 'VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
    'MICROSOFT_OAUTH_AUTHORIZE_URL', 'MICROSOFT_OAUTH_TOKEN_URL', 'MICROSOFT_OAUTH_AUTHORITY', 'MICROSOFT_GRAPH_PHOTO_URL'];
const test = base.extend<{ microsoft: MicrosoftStub }>({ microsoft: async ({}, use) => {
    const saved = Object.fromEntries(managedEnv.map(name => [name, process.env[name]]));
    const stub = await startMicrosoftStub();
    for (const name of ['VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV']) delete process.env[name];
    Object.assign(process.env, { UIER_LOCAL: '1', MICROSOFT_CLIENT_ID: stub.clientId, MICROSOFT_CLIENT_SECRET: stub.clientSecret,
        MICROSOFT_OAUTH_AUTHORIZE_URL: `${stub.url}/common/oauth2/v2.0/authorize`, MICROSOFT_OAUTH_TOKEN_URL: `${stub.url}/token`, MICROSOFT_OAUTH_AUTHORITY: stub.url,
        MICROSOFT_GRAPH_PHOTO_URL: stub.photoUrl });
    try { await use(stub); } finally {
        await stub.close();
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    }
} });

type Session = { userId: string; signedInAt: number };
async function viaMicrosoft(microsoft: MicrosoftStub, identity: StubMicrosoftIdentity, options: {
    next?: string; link?: Session; session?: Session | null; claims?: Record<string, unknown>;
} = {}) {
    const started = await beginMicrosoftSignIn({ next: options.next, link: options.link, baseUrl });
    const { code, state } = microsoft.approve(started.url, identity, options.claims);
    const callback = { binding: started.binding, state, code, error: null, baseUrl, session: options.session === undefined ? options.link : options.session };
    return { started, callback, outcome: await finishMicrosoftSignIn(callback) };
}

function pending(outcome: MicrosoftSignInOutcome) {
    expect(outcome.kind).toBe('confirm_email');
    return (outcome as Extract<MicrosoftSignInOutcome, { kind: 'confirm_email' }>).binding;
}
async function emailRequest(email: string, microsoftLinkId: string) {
    const token = randomToken(); const requestId = sha256Hex(token); const code = '24681357';
    await getAppStore().create<DbSignInRequest>({ type: 'sign-in', id: requestId, pk: `sign-in:${requestId}`, email,
        codeHash: keyedHash('sign-in-code', `${requestId}:${code}`), next: '/app/account', microsoftLinkId,
        createdAt: new Date().toISOString(), ttl: SIGN_IN_LINK_TTL_SECONDS });
    return { token, requestId, code, binding: signInRequestToken(requestId, SIGN_IN_LINK_TTL_SECONDS) };
}

test('authorization uses PKCE, nonce and only OIDC scopes, storing no credentials', async ({ microsoft }) => {
    const started = await beginMicrosoftSignIn({ baseUrl, next: '/app/account?from=microsoft' });
    const params = new URL(started.url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ client_id: microsoft.clientId, redirect_uri: `${baseUrl}/app/sign-in/microsoft/callback`,
        response_type: 'code', scope: 'openid email profile', code_challenge_method: 'S256', prompt: 'select_account' });
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const id = boundMicrosoftRecordId('flow', started.binding)!;
    const stored = (await getAppStore().get<DbMicrosoftSignIn>(microsoftSignInPk(id), id))!.doc;
    expect(stored).toMatchObject({ stateHash: sha256Hex(params.get('state')!), nonceHash: sha256Hex(params.get('nonce')!), ttl: MICROSOFT_SIGN_IN_TTL_SECONDS });
    for (const secret of [params.get('state'), params.get('nonce'), microsoft.clientSecret]) expect(JSON.stringify(stored)).not.toContain(secret);
});

test('first sign-in proves a chosen inbox; linked sign-in follows tenant and subject, never email', async ({ microsoft }) => {
    const suggestion = uniqueEmail('microsoft-claim'); const email = uniqueEmail('microsoft-inbox'); const sub = randomUUID();
    const outcome = (await viaMicrosoft(microsoft, { sub, email: suggestion }, { next: '/app/account' })).outcome;
    expect(await findUserByEmail(suggestion)).toBeNull();
    const binding = pending(outcome); const link = (await getMicrosoftLink(binding))!;
    expect(await microsoftLinkIdFor(binding)).toBe(link.id);
    expect(await microsoftLinkIdFor(undefined)).toBeUndefined();
    const request = await emailRequest(email, link.id);
    const result = await confirmSignInCode(request.requestId, request.code, request.binding);
    expect(result?.user.email).toBe(email);
    expect(result?.next).toBe('/app/account');
    expect(result?.method).toBe('microsoft');
    const account = (await getMicrosoftAccount(result!.user.id))!;
    expect(account).toMatchObject({ subject: sha256Hex(`${microsoft.url}/${microsoftTenant}/v2.0\n${sub}`), email: suggestion });
    expect((await viaMicrosoft(microsoft, { sub, email: uniqueEmail('changed') })).outcome).toMatchObject({ kind: 'signed_in', userId: result!.user.id });
    expect((await viaMicrosoft(microsoft, { sub })).outcome).toMatchObject({ kind: 'signed_in', userId: result!.user.id });
    expect((await getUser(result!.user.id))?.email).toBe(email);
    expect((await viaMicrosoft(microsoft, { sub }, { claims: { tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
        iss: `${microsoft.url}/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` } })).outcome.kind).toBe('confirm_email');
    await unlinkMicrosoftAccount(result!.user.id);
    expect(await findUserByMicrosoftSubject(account.subject)).toBeNull();
    expect((await viaMicrosoft(microsoft, { sub, email })).outcome.kind).toBe('confirm_email');
});

test('the Microsoft photo is read with the sign-in access token on a first sign-in or when connecting, never stored with it', async ({ microsoft }) => {
    // A first sign-in: the photo waits with the pending link, the access token does not
    const email = uniqueEmail('microsoft-photo');
    const binding = pending((await viaMicrosoft(microsoft, { sub: randomUUID(), photo: true })).outcome);
    const link = (await getMicrosoftLink(binding))!;
    expect(link.picture).toMatchObject({ size: 32 });
    expect(JSON.stringify(link)).not.toContain('microsoft-test-access');
    expect(microsoft.photoCalls.at(-1)).toEqual({ authorized: true });
    const proof = await emailRequest(email, link.id);
    const result = (await confirmSignInCode(proof.requestId, proof.code, proof.binding))!;
    const avatar = (await getUser(result.user.id))!.avatar!;
    expect(avatar.source).toBe('microsoft');
    expect(await getAvatarImage(result.user.id, avatar.version)).toMatchObject({ size: 32 });

    // Connecting from Account: only an account without a picture takes the photo; no photo leaves initials
    const recent = { signedInAt: Math.floor(Date.now() / 1000) };
    const owner = await findOrCreateUser(uniqueEmail('microsoft-photo-owner'));
    await saveUserAvatar(owner.id, await normalizeAvatar(stubPicturePng) as AvatarImage, 'upload');
    expect((await viaMicrosoft(microsoft, { photo: true }, { link: { ...recent, userId: owner.id } })).outcome).toEqual({ kind: 'linked' });
    expect((await getUser(owner.id))!.avatar?.source).toBe('upload');
    const plain = await findOrCreateUser(uniqueEmail('microsoft-photo-plain'));
    expect((await viaMicrosoft(microsoft, { photo: true }, { link: { ...recent, userId: plain.id } })).outcome).toEqual({ kind: 'linked' });
    expect((await getUser(plain.id))!.avatar?.source).toBe('microsoft');
    const none = await findOrCreateUser(uniqueEmail('microsoft-photo-none'));
    expect((await viaMicrosoft(microsoft, {}, { link: { ...recent, userId: none.id } })).outcome).toEqual({ kind: 'linked' });
    expect((await getUser(none.id))!.avatar).toBeUndefined();
});

test('Microsoft email never grants an existing account, including personal Microsoft addresses', async ({ microsoft }) => {
    for (const domain of ['outlook.com', 'example.test']) {
        const email = `microsoft-${randomUUID()}@${domain}`; const user = await findOrCreateUser(email);
        const outcome = (await viaMicrosoft(microsoft, { email })).outcome;
        const link = (await getMicrosoftLink(pending(outcome)))!;
        const foreign = await emailRequest(email, link.id);
        expect(await confirmSignIn(foreign.token)).toMatchObject({ user: { id: user.id }, method: 'email' });
        expect(await getMicrosoftAccount(user.id)).toBeNull();
        const own = await emailRequest(email, link.id);
        expect(await confirmSignInCode(own.requestId, own.code, 'foreign')).toBeNull();
        expect(await getMicrosoftAccount(user.id)).toBeNull();
        await confirmSignIn(own.token, own.binding);
        expect((await getMicrosoftAccount(user.id))?.subject).toBe(link.subject);
    }
    expect((await viaMicrosoft(microsoft, {})).outcome.kind).toBe('confirm_email');
});

test('callbacks require the browser, matching state, lifetime and a single delete winner', async ({ microsoft }) => {
    const { callback, outcome } = await viaMicrosoft(microsoft, { email: uniqueEmail('once') });
    pending(outcome); const count = microsoft.tokenCalls.length;
    expect((await finishMicrosoftSignIn(callback))).toMatchObject({ kind: 'problem', problem: 'expired' });
    expect(microsoft.tokenCalls).toHaveLength(count);
    const start = await beginMicrosoftSignIn({ baseUrl }); const approved = microsoft.approve(start.url, {});
    for (const binding of [undefined, 'foreign']) expect(await finishMicrosoftSignIn({ ...approved, binding, error: null, baseUrl })).toMatchObject({ problem: 'expired' });
    expect(await finishMicrosoftSignIn({ ...approved, state: randomToken(), binding: start.binding, error: null, baseUrl })).toMatchObject({ problem: 'expired' });
    const results = await Promise.all([1, 2].map(() => finishMicrosoftSignIn({ ...approved, binding: start.binding, error: null, baseUrl })));
    expect(results.map(result => result.kind).sort()).toEqual(['confirm_email', 'problem']);
    const expiring = await beginMicrosoftSignIn({ baseUrl }); const id = boundMicrosoftRecordId('flow', expiring.binding)!;
    const stored = (await getAppStore().get<DbMicrosoftSignIn>(microsoftSignInPk(id), id))!;
    await getAppStore().replace({ ...stored.doc, createdAt: new Date(Date.now() - 11 * 60_000).toISOString() }, stored.etag);
    expect(await finishMicrosoftSignIn({ ...microsoft.approve(expiring.url, {}), binding: expiring.binding, error: null, baseUrl })).toMatchObject({ problem: 'expired' });
});

test('ID tokens require a valid signature, exact issuer/tenant/audience, lifetime and nonce', async ({ microsoft }) => {
    const nonce = randomToken(); const now = Math.floor(Date.now() / 1000);
    const claims = { iss: `${microsoft.url}/${microsoftTenant}/v2.0`, tid: microsoftTenant, ver: '2.0', sub: randomUUID(), aud: microsoft.clientId,
        iat: now, exp: now + 3600, nonce };
    const expected = { clientId: microsoft.clientId, authority: microsoft.url, nonceHash: sha256Hex(nonce) };
    expect(await microsoftIdTokenClaims(await microsoft.issueToken(claims), expected, now * 1000)).not.toBeNull();
    for (const override of [{ iss: 'https://evil.example/v2.0' }, { tid: randomUUID() }, { tid: '../common' }, { aud: 'other-client' },
        { aud: [microsoft.clientId, 'other-client'] }, { azp: 'other-client' }, { exp: now - 1 }, { iat: now + 301 }, { iat: now - 901 },
        { nbf: now + 60 }, { nonce: 'wrong' }, { sub: '' }, { ver: '1.0' }])
        expect(await microsoftIdTokenClaims(await microsoft.issueToken({ ...claims, ...override }), expected, now * 1000), JSON.stringify(override)).toBeNull();
    const token = await microsoft.issueToken(claims); const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'tampered' })).toString('base64url');
    expect(await microsoftIdTokenClaims(parts.join('.'), expected, now * 1000)).toBeNull();
    expect(await microsoftIdTokenClaims('invalid', expected, now * 1000)).toBeNull();
});

test('Account linking requires the initiating recent session; identity conflicts never switch users', async ({ microsoft }) => {
    const user = await findOrCreateUser(uniqueEmail('ms-account')); const other = await findOrCreateUser(uniqueEmail('ms-other'));
    const link = { userId: user.id, signedInAt: Math.floor(Date.now() / 1000) };
    await expect(beginMicrosoftSignIn({ baseUrl, link: { ...link, signedInAt: link.signedInAt - PASSKEY_RECENT_SIGN_IN_SECONDS - 1 } })).rejects.toMatchObject({ code: 'sign_in_again' });
    expect((await viaMicrosoft(microsoft, {}, { link, session: null })).outcome).toMatchObject({ problem: 'failed' });
    expect((await viaMicrosoft(microsoft, {}, { link, session: { ...link, userId: other.id } })).outcome).toMatchObject({ problem: 'failed' });
    const sub = randomUUID();
    expect((await viaMicrosoft(microsoft, { sub }, { link })).outcome).toEqual({ kind: 'linked' });
    expect((await viaMicrosoft(microsoft, { sub }, { link: { ...link, userId: other.id } })).outcome).toMatchObject({ problem: 'taken' });
    expect(await getMicrosoftAccount(other.id)).toBeNull();
    expect((await viaMicrosoft(microsoft, { sub: randomUUID() }, { link })).outcome).toMatchObject({ problem: 'other_account' });
    const pendingSub = randomUUID();
    const pendingLink = (await getMicrosoftLink(pending((await viaMicrosoft(microsoft, { sub: pendingSub })).outcome)))!;
    await linkMicrosoftAccount(other.id, { subject: pendingLink.subject, email: '' });
    const proof = await emailRequest(uniqueEmail('ms-conflict-proof'), pendingLink.id);
    const confirmed = await confirmSignIn(proof.token, proof.binding);
    expect(confirmed?.next).toBe('/app/account/sign-in?microsoft=taken');
    expect(await getMicrosoftAccount(confirmed!.user.id)).toBeNull();

});

test('expired mailbox proof does not link and callback cannot proceed after disabling the provider', async ({ microsoft }) => {
    const binding = pending((await viaMicrosoft(microsoft, {})).outcome); const link = (await getMicrosoftLink(binding))!;
    const stored = (await getAppStore().get<DbMicrosoftLink>(microsoftLinkPk(link.id), link.id))!;
    await getAppStore().replace({ ...stored.doc, createdAt: new Date(Date.now() - (MICROSOFT_LINK_TTL_SECONDS + 1) * 1000).toISOString() }, stored.etag);
    expect(await getMicrosoftLink(binding)).toBeNull();
    const request = await emailRequest(uniqueEmail('ms-expired'), link.id);
    const result = await confirmSignIn(request.token, request.binding);
    expect(await getMicrosoftAccount(result!.user.id)).toBeNull();
    const started = await beginMicrosoftSignIn({ baseUrl }); delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(await finishMicrosoftSignIn({ ...microsoft.approve(started.url, {}), binding: started.binding, error: null, baseUrl })).toMatchObject({ problem: 'expired' });
});

test('production ignores endpoint overrides and previews disable sign-in', async ({ microsoft }) => {
    expect(isMicrosoftSignInConfigured()).toBe(true);
    expect(microsoftRedirectUri(baseUrl)).toBe(`${baseUrl}/app/sign-in/microsoft/callback`);
    process.env.UIER_LOCAL = '0'; process.env.VERCEL = '1'; process.env.UIER_DEPLOYMENT_ENV = 'production';
    expect(microsoftConfig()).toMatchObject({ authority: 'https://login.microsoftonline.com',
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' });
    expect(isMicrosoftSignInConfigured()).toBe(true);
    expect(() => microsoftRedirectUri('http://uier.io')).toThrow();
    process.env.UIER_DEPLOYMENT_ENV = 'preview'; expect(isMicrosoftSignInConfigured()).toBe(false);
    void microsoft;
});

test('routes reject cross-site and prefetch starts and strip callback secrets', async ({ request }) => {
    const blockedStarts: Record<string, string>[] = [{ 'sec-fetch-site': 'cross-site' }, { purpose: 'prefetch' }];
    for (const headers of blockedStarts) {
        const response = await request.get('/app/sign-in/microsoft?next=/app/account', { headers, maxRedirects: 0 });
        expect(response.status()).toBe(302); expect(response.headers()['set-cookie']).toBeUndefined();
        expect(new URL(response.headers().location!).pathname).toBe('/app/sign-in');
    }
    const response = await request.get('/app/sign-in/microsoft/callback?code=secret-code&state=secret-state', { maxRedirects: 0 });
    expect(response.status()).toBe(302); expect(response.headers().location).not.toMatch(/secret-code|secret-state/);
    expect(new URL(response.headers().location!).searchParams.get('microsoft')).toBe('expired');
    expect(response.headers()['cache-control']).toBe('no-store');
});
