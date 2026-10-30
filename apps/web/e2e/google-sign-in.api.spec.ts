import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { keyedHash } from '../src/lib/comments/environment';
import { ApiError } from '../src/lib/comments/http';
import { getAppStore } from '../src/lib/app/store';
import { userPk, type DbSignInRequest } from '../src/lib/app/model';
import { confirmSignIn, confirmSignInCode, SIGN_IN_LINK_TTL_SECONDS } from '../src/lib/app/signIn';
import { signInRequestToken } from '../src/lib/app/signInCookie';
import { randomToken, sha256Hex, signToken } from '../src/lib/app/tokens';
import { findOrCreateUser, findUserByEmail, getUser } from '../src/lib/app/users';
import { SESSION_TTL_SECONDS, sessionSignedInAt } from '../src/lib/app/sessionIdentity';
import { googleConfig, googleRedirectUri, isGoogleSignInConfigured } from '../src/lib/app/google/config';
import { boundGoogleRecordId, googleBindingToken } from '../src/lib/app/google/cookie';
import { findUserByGoogleSubject, getGoogleAccount, linkGoogleAccount, unlinkGoogleAccount } from '../src/lib/app/google/identity';
import { getGoogleLink, googleLinkIdFor } from '../src/lib/app/google/link';
import { GOOGLE_ACCOUNT_ID, googleIdentityPk, googleLinkPk, googleSignInPk, type DbGoogleLink, type DbGoogleSignIn,
    type DbUserIdentity } from '../src/lib/app/google/model';
import { beginGoogleSignIn, finishGoogleSignIn, googleIdTokenClaims, googleIsAuthoritative, GOOGLE_SIGN_IN_TTL_SECONDS,
    type GoogleSignInOutcome } from '../src/lib/app/google/signIn';
import { PASSKEY_RECENT_SIGN_IN_SECONDS } from '../src/lib/app/passkeys';
import { googleSubject, startGoogleStub, type GoogleStub, type StubGoogleIdentity } from './support/googleStub';
import { uniqueEmail } from './support/app';

const baseUrl = 'http://localhost:4004';
const managedEnv = ['UIER_LOCAL', 'VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_AUTHORIZE_URL', 'GOOGLE_OAUTH_TOKEN_URL', 'GOOGLE_OAUTH_ISSUER'];

const test = base.extend<{ google: GoogleStub }>({ google: async ({}, use) => {
    const saved = Object.fromEntries(managedEnv.map(name => [name, process.env[name]]));
    const stub = await startGoogleStub();
    for (const name of ['VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV']) delete process.env[name];
    Object.assign(process.env, { UIER_LOCAL: '1', GOOGLE_CLIENT_ID: stub.clientId, GOOGLE_CLIENT_SECRET: stub.clientSecret,
        GOOGLE_OAUTH_AUTHORIZE_URL: `${stub.url}/o/oauth2/v2/auth`, GOOGLE_OAUTH_TOKEN_URL: `${stub.url}/token`, GOOGLE_OAUTH_ISSUER: stub.url });
    try { await use(stub); } finally {
        await stub.close();
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
} });

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = originalLocal;
});

type Session = { userId: string; signedInAt: number };
type Options = { next?: string; linkUserId?: string; signedInAt?: number; session?: Session | null; claims?: Record<string, unknown> };

const nowSeconds = () => Math.floor(Date.now() / 1000);
/** Google is authoritative for Gmail, so these sign in (or up) without an email code */
const gmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@gmail.com`;

/**
 * Starts a sign-in, approves it at the stub as `identity` and runs the callback with the browser's
 * binding. `linkUserId` links from Account with a session that signed in at `signedInAt` (now).
 */
async function viaGoogle(google: GoogleStub, identity: StubGoogleIdentity, options: Options = {}) {
    const link = options.linkUserId ? { userId: options.linkUserId, signedInAt: options.signedInAt ?? nowSeconds() } : undefined;
    const started = await beginGoogleSignIn({ next: options.next, link, baseUrl });
    const { code, state } = google.approve(started.url, identity, options.claims);
    const callback = { binding: started.binding, state, code, error: null, baseUrl, session: options.session !== undefined ? options.session : link ?? null };
    return { started, callback, outcome: await finishGoogleSignIn(callback) };
}

function confirmEmail(outcome: GoogleSignInOutcome) {
    expect(outcome.kind, JSON.stringify(outcome)).toBe('confirm_email');
    return (outcome as Extract<GoogleSignInOutcome, { kind: 'confirm_email' }>).binding;
}

function signedIn(outcome: GoogleSignInOutcome) {
    expect(outcome.kind, JSON.stringify(outcome)).toBe('signed_in');
    return outcome as Extract<GoogleSignInOutcome, { kind: 'signed_in' }>;
}

async function flowRecord(binding: string) {
    const id = boundGoogleRecordId('flow', binding)!;
    return await getAppStore().get<DbGoogleSignIn>(googleSignInPk(id), id);
}

/** An emailed sign-in request as `requestSignInLink` stores it (which needs a request context) */
async function emailRequest(email: string, googleLinkId?: string) {
    const token = randomToken();
    const requestId = sha256Hex(token);
    const code = '24681357';
    await getAppStore().create<DbSignInRequest>({ type: 'sign-in', id: requestId, pk: `sign-in:${requestId}`, email,
        codeHash: keyedHash('sign-in-code', `${requestId}:${code}`), next: '/app/projects', googleLinkId,
        createdAt: new Date().toISOString(), ttl: SIGN_IN_LINK_TTL_SECONDS });
    return { token, requestId, code, binding: signInRequestToken(requestId, SIGN_IN_LINK_TTL_SECONDS) };
}

test('the authorization request uses S256 PKCE, a nonce, the registered callback and only the OIDC scopes', async ({ google }) => {
    const started = await beginGoogleSignIn({ next: '/app/account', baseUrl });
    const url = new URL(started.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${google.url}/o/oauth2/v2/auth`);
    const params = url.searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ client_id: google.clientId, redirect_uri: `${baseUrl}/app/sign-in/google/callback`,
        response_type: 'code', scope: 'openid email profile', code_challenge_method: 'S256', prompt: 'select_account' });
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).not.toBe(params.get('nonce'));

    // The server keeps hashes only; the binding holds nothing but the record id
    const record = (await flowRecord(started.binding))!.doc;
    expect(record).toMatchObject({ type: 'google-sign-in', next: '/app/account', stateHash: sha256Hex(params.get('state')!),
        nonceHash: sha256Hex(params.get('nonce')!), ttl: GOOGLE_SIGN_IN_TTL_SECONDS });
    const stored = JSON.stringify(record);
    for (const secret of [params.get('state')!, params.get('nonce')!, params.get('code_challenge')!]) expect(stored).not.toContain(secret);
    expect(Object.keys(JSON.parse(Buffer.from(started.binding.split('.')[0]!, 'base64url').toString()) as object)).toEqual(['id', 'exp']);
});

test('rule 3: a new Gmail address creates the account with its Google name and links it', async ({ google }) => {
    const email = gmail('google-new');
    const sub = googleSubject();
    const { outcome } = await viaGoogle(google, { sub, email, name: 'Ada Lovelace' }, { next: '/app/projects?status=open' });
    const result = signedIn(outcome);
    expect(result.next).toBe('/app/projects?status=open');
    const user = (await getUser(result.userId))!;
    expect(user).toMatchObject({ email, name: 'Ada Lovelace' });
    expect(await getGoogleAccount(user.id)).toMatchObject({ sub, email });
    expect((await findUserByGoogleSubject(sub))?.id).toBe(user.id);
    expect((await getAppStore().get<DbUserIdentity>(googleIdentityPk(sub), sub))?.doc).toMatchObject({ userId: user.id, provider: 'google' });
});

test('rule 1: a linked account signs in by subject only, and a changed Google email never changes the uier email', async ({ google }) => {
    const email = gmail('google-linked');
    const sub = googleSubject();
    const first = signedIn((await viaGoogle(google, { sub, email })).outcome);

    const changed = uniqueEmail('google-changed');
    expect(signedIn((await viaGoogle(google, { sub, email: changed })).outcome).userId).toBe(first.userId);
    expect((await getUser(first.userId))?.email).toBe(email);
    expect((await getGoogleAccount(first.userId))?.email).toBe(changed);
    // An unverified or missing email does not matter once linked, and is never shown
    expect(signedIn((await viaGoogle(google, { sub, email: uniqueEmail('unverified'), email_verified: false })).outcome).userId).toBe(first.userId);
    expect(signedIn((await viaGoogle(google, { sub })).outcome).userId).toBe(first.userId);
    expect((await getGoogleAccount(first.userId))?.email).toBe(changed);

    // Other Google accounts never reach this user through an address: not the Google address on
    // record (not authoritative, so an email code first), and not the uier address (already linked)
    confirmEmail((await viaGoogle(google, { sub: googleSubject(), email: changed })).outcome);
    expect(await findUserByEmail(changed)).toBeNull();
    expect((await viaGoogle(google, { sub: googleSubject(), email })).outcome).toMatchObject({ kind: 'problem', problem: 'other_account' });
    expect((await getGoogleAccount(first.userId))?.sub).toBe(sub);
});

test('rule 2: an unverified address is refused and creates nothing', async ({ google }) => {
    const email = uniqueEmail('google-unverified');
    for (const email_verified of [false, 'false'] as const) {
        const { outcome } = await viaGoogle(google, { sub: googleSubject(), email, email_verified }, { next: '/app/account' });
        expect(outcome).toEqual({ kind: 'problem', problem: 'unverified', next: '/app/account', linking: false });
    }
    expect((await viaGoogle(google, { sub: googleSubject() })).outcome).toMatchObject({ kind: 'problem', problem: 'unverified' });
    expect(await findUserByEmail(email)).toBeNull();
});

test('rule 3: Gmail and a matching Workspace domain link an existing account at once', async ({ google }) => {
    const gmail = `google-${randomUUID().slice(0, 8)}@gmail.com`;
    const gmailUser = await findOrCreateUser(gmail);
    const gmailSub = googleSubject();
    expect(signedIn((await viaGoogle(google, { sub: gmailSub, email: gmail.toUpperCase() })).outcome).userId).toBe(gmailUser.id);
    expect((await getGoogleAccount(gmailUser.id))?.sub).toBe(gmailSub);
    expect((await getUser(gmailUser.id))?.name).toBe(gmailUser.name);

    const workspace = `ada-${randomUUID().slice(0, 8)}@acme.example`;
    const workspaceUser = await findOrCreateUser(workspace);
    expect(signedIn((await viaGoogle(google, { sub: googleSubject(), email: workspace, hd: 'ACME.example' })).outcome).userId).toBe(workspaceUser.id);

    expect(googleIsAuthoritative('ada@gmail.com', undefined)).toBe(true);
    expect(googleIsAuthoritative('ada@acme.example', 'acme.example')).toBe(true);
    for (const [email, hd] of [['ada@googlemail.com', undefined], ['ada@gmail.com.evil.example', undefined], ['ada@acme.example', 'other.example'],
        ['ada@sub.acme.example', 'acme.example'], ['ada@acme.example', undefined]] as const)
        expect(googleIsAuthoritative(email, hd), email).toBe(false);
});

test('rule 4: a new address Google is not authoritative for creates nothing before the email proof', async ({ google }) => {
    // Google's verification can be stale (a former employee, a re-registered domain): an account
    // created now, already linked, would be waiting for the address's real owner.
    const email = uniqueEmail('google-stale');
    const sub = googleSubject();
    const binding = confirmEmail((await viaGoogle(google, { sub, email, name: 'Not the owner' }, { next: '/app/account' })).outcome);
    for (const hd of ['example.org', 'gmail.com'])
        confirmEmail((await viaGoogle(google, { sub: googleSubject(), email, hd })).outcome);
    expect(await findUserByEmail(email)).toBeNull();
    expect(await findUserByGoogleSubject(sub)).toBeNull();
    expect(await getGoogleLink(binding)).toMatchObject({ sub, email, next: '/app/account' });

    // The inbox owner's code in that browser creates the account and links it
    const request = await emailRequest(email, await googleLinkIdFor(binding, email));
    const result = (await confirmSignInCode(request.requestId, request.code, request.binding))!;
    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe(email.split('@')[0]);
    expect((await findUserByGoogleSubject(sub))?.id).toBe(result.user.id);
});

test('rule 4: an existing address needs one browser-bound email proof before the account is linked', async ({ google }) => {
    const email = uniqueEmail('google-existing');
    const user = await findOrCreateUser(email);
    const sub = googleSubject();
    // A Workspace account of another domain is not authoritative for this address either
    const binding = confirmEmail((await viaGoogle(google, { sub, email, hd: 'example.org', name: 'Not used' }, { next: '/app/projects' })).outcome);
    expect(await findUserByGoogleSubject(sub)).toBeNull();
    expect(await getGoogleAccount(user.id)).toBeNull();
    expect(await getGoogleLink(binding)).toMatchObject({ sub, email, next: '/app/projects' });

    // The pending link rides only on an email for its own address, from its own browser
    const linkId = await googleLinkIdFor(binding, email);
    expect(linkId).toMatch(/^[a-f0-9]{64}$/);
    expect(await googleLinkIdFor(binding, uniqueEmail('someone-else'))).toBeUndefined();
    expect(await googleLinkIdFor(undefined, email)).toBeUndefined();
    expect(await googleLinkIdFor(googleBindingToken('flow', linkId!, 60), email)).toBeUndefined();

    // The emailed link opened in another browser signs in by email but links nothing
    const elsewhere = await emailRequest(email, linkId);
    expect(await confirmSignIn(elsewhere.token)).toMatchObject({ user: { id: user.id }, next: '/app/projects' });
    const foreign = await emailRequest(email, linkId);
    expect(await confirmSignIn(foreign.token, (await emailRequest(email)).binding)).toMatchObject({ user: { id: user.id } });
    expect(await findUserByGoogleSubject(sub)).toBeNull();

    // The code in the browser that asked links the account
    const here = await emailRequest(email, linkId);
    expect(await confirmSignInCode(here.requestId, here.code, here.binding)).toMatchObject({ user: { id: user.id }, next: '/app/projects' });
    expect((await findUserByGoogleSubject(sub))?.id).toBe(user.id);
    expect((await getUser(user.id))?.name).toBe(user.name);
    // The pending link is used up
    expect(await getGoogleLink(binding)).toBeNull();
    expect(signedIn((await viaGoogle(google, { sub, email })).outcome).userId).toBe(user.id);
});

test('rule 4: the bound link through the email link in the same browser links too, and a pending link expires', async ({ google }) => {
    const email = uniqueEmail('google-link-path');
    const user = await findOrCreateUser(email);
    const sub = googleSubject();
    const { outcome } = await viaGoogle(google, { sub, email });
    const linkId = await googleLinkIdFor((outcome as { binding: string }).binding, email);
    const request = await emailRequest(email, linkId);
    expect(await confirmSignIn(request.token, request.binding)).toMatchObject({ user: { id: user.id } });
    expect((await findUserByGoogleSubject(sub))?.id).toBe(user.id);

    const late = await findOrCreateUser(uniqueEmail('google-late'));
    const lateSub = googleSubject();
    const pending = await viaGoogle(google, { sub: lateSub, email: late.email });
    const lateBinding = (pending.outcome as { binding: string }).binding;
    const lateId = (await googleLinkIdFor(lateBinding, late.email))!;
    const stored = (await getAppStore().get<DbGoogleLink>(googleLinkPk(lateId), lateId))!;
    await getAppStore().replace({ ...stored.doc, createdAt: new Date(Date.now() - 16 * 60_000).toISOString() }, stored.etag);
    expect(await getGoogleLink(lateBinding)).toBeNull();
    const lateRequest = await emailRequest(late.email, lateId);
    expect(await confirmSignInCode(lateRequest.requestId, lateRequest.code, lateRequest.binding)).toMatchObject({ user: { id: late.id } });
    expect(await findUserByGoogleSubject(lateSub)).toBeNull();
});

test('rule 4: an email proof whose Google account was linked elsewhere meanwhile signs in and explains on Account', async ({ google }) => {
    const email = uniqueEmail('google-race');
    const user = await findOrCreateUser(email);
    const sub = googleSubject();
    const { outcome } = await viaGoogle(google, { sub, email });
    const linkId = await googleLinkIdFor((outcome as { binding: string }).binding, email);
    const other = await findOrCreateUser(uniqueEmail('google-race-other'));
    expect(await linkGoogleAccount(other.id, { sub, email })).toBe('linked');
    const request = await emailRequest(email, linkId);
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toEqual({ user: expect.objectContaining({ id: user.id }),
        next: '/app/account?google=taken' });
    expect((await findUserByGoogleSubject(sub))?.id).toBe(other.id);
    expect(await getGoogleAccount(user.id)).toBeNull();
});

test('rule 5: Account links and unlinks, and refuses an account that belongs to someone else', async ({ google }) => {
    const owner = await findOrCreateUser(uniqueEmail('google-owner'));
    const sub = googleSubject();
    // Linking needs no matching or verified address: the person is already signed in
    expect((await viaGoogle(google, { sub, email: uniqueEmail('other-address'), email_verified: false }, { linkUserId: owner.id })).outcome)
        .toEqual({ kind: 'linked' });
    expect((await findUserByGoogleSubject(sub))?.id).toBe(owner.id);

    const second = await findOrCreateUser(uniqueEmail('google-second'));
    expect((await viaGoogle(google, { sub, email: second.email }, { linkUserId: second.id })).outcome)
        .toEqual({ kind: 'problem', problem: 'taken', next: undefined, linking: true });
    expect(await getGoogleAccount(second.id)).toBeNull();
    expect((await viaGoogle(google, { sub: googleSubject(), email: owner.email }, { linkUserId: owner.id })).outcome)
        .toMatchObject({ problem: 'other_account', linking: true });
    expect((await getGoogleAccount(owner.id))?.sub).toBe(sub);

    // The flow continues only in the session that started it
    const hijack = await findOrCreateUser(uniqueEmail('google-hijack'));
    for (const session of [{ userId: owner.id, signedInAt: nowSeconds() }, null])
        expect((await viaGoogle(google, { sub: googleSubject() }, { linkUserId: hijack.id, session })).outcome)
            .toMatchObject({ problem: 'failed', linking: true });
    expect(await getGoogleAccount(hijack.id)).toBeNull();

    await unlinkGoogleAccount(owner.id);
    expect(await getGoogleAccount(owner.id)).toBeNull();
    expect(await findUserByGoogleSubject(sub)).toBeNull();
    expect(await getAppStore().get(googleIdentityPk(sub), sub)).toBeNull();
    await unlinkGoogleAccount(owner.id);
    // Unlinked, the Google account no longer reaches the owner: its address is not theirs
    expect((await viaGoogle(google, { sub, email: second.email }, { linkUserId: second.id })).outcome).toEqual({ kind: 'linked' });
});

test('rule 5: linking needs a sign-in from the last 10 minutes when it starts, rechecked at the callback', async ({ google }) => {
    // The rule for adding a passkey (`requireRecentSignIn`)
    const user = await findOrCreateUser(uniqueEmail('google-recent'));
    const stale = nowSeconds() - PASSKEY_RECENT_SIGN_IN_SECONDS - 60;
    await expect(beginGoogleSignIn({ link: { userId: user.id, signedInAt: stale }, baseUrl })).rejects.toMatchObject({ code: 'sign_in_again' });
    const started = await beginGoogleSignIn({ link: { userId: user.id, signedInAt: nowSeconds() - PASSKEY_RECENT_SIGN_IN_SECONDS + 30 }, baseUrl });
    expect((await flowRecord(started.binding))?.doc.linkUserId).toBe(user.id);

    // Another, older session of the same account cannot finish a link a recent one started
    expect((await viaGoogle(google, { sub: googleSubject() }, { linkUserId: user.id, session: { userId: user.id, signedInAt: stale } })).outcome)
        .toEqual({ kind: 'problem', problem: 'sign_in_again', next: undefined, linking: true });
    expect(await getGoogleAccount(user.id)).toBeNull();
    expect((await viaGoogle(google, { sub: googleSubject() }, { linkUserId: user.id })).outcome).toEqual({ kind: 'linked' });

    // The session's `iat`, or on older tokens without it the expiry minus the lifetime
    const iat = nowSeconds() - 120;
    const token = signToken('session', { uid: user.id, iat }, SESSION_TTL_SECONDS);
    expect(sessionSignedInAt(token)).toEqual({ userId: user.id, signedInAt: iat });
    expect(sessionSignedInAt(signToken('session', { uid: user.id }, SESSION_TTL_SECONDS - 3600))!.signedInAt).toBeLessThanOrEqual(nowSeconds() - 3599);
    for (const value of [undefined, '', signToken('review-sso', { uid: user.id }, 60), `${token}x`])
        expect(sessionSignedInAt(value)).toBeNull();
});

test('a claim left by an interrupted unlink never signs in and is replaced by the next link', async () => {
    const before = await findOrCreateUser(uniqueEmail('google-stale'));
    const after = await findOrCreateUser(uniqueEmail('google-fresh'));
    const sub = googleSubject();
    expect(await linkGoogleAccount(before.id, { sub, email: before.email })).toBe('linked');
    await getAppStore().delete(userPk(before.id), GOOGLE_ACCOUNT_ID);
    expect(await findUserByGoogleSubject(sub)).toBeNull();
    expect(await linkGoogleAccount(after.id, { sub, email: after.email })).toBe('linked');
    expect((await findUserByGoogleSubject(sub))?.id).toBe(after.id);
});

test('state, nonce and PKCE: replays, mismatches, expiry and parallel callbacks', async ({ google }) => {
    const identity = () => ({ sub: googleSubject(), email: gmail('google-replay') });
    const first = await viaGoogle(google, identity());
    signedIn(first.outcome);
    expect(await finishGoogleSignIn(first.callback)).toEqual({ kind: 'problem', problem: 'expired', linking: false });

    // A wrong state leaves the request for the right one
    const started = await beginGoogleSignIn({ baseUrl });
    const approval = google.approve(started.url, identity());
    for (const state of [randomToken(), 'short', null, approval.code])
        expect(await finishGoogleSignIn({ binding: started.binding, state, code: approval.code, error: null, baseUrl })).toMatchObject({ problem: 'expired' });
    signedIn(await finishGoogleSignIn({ binding: started.binding, state: approval.state, code: approval.code, error: null, baseUrl }));

    // Parallel callbacks: one winner exchanges the code
    const parallel = await beginGoogleSignIn({ baseUrl });
    const parallelApproval = google.approve(parallel.url, identity());
    const results = await Promise.all(Array.from({ length: 5 }, () =>
        finishGoogleSignIn({ binding: parallel.binding, ...parallelApproval, error: null, baseUrl })));
    expect(results.filter(result => result.kind === 'signed_in')).toHaveLength(1);

    // A code issued for another request's PKCE challenge does not redeem
    const a = await beginGoogleSignIn({ baseUrl });
    const b = await beginGoogleSignIn({ baseUrl });
    const codeForA = google.approve(a.url, identity());
    const stateB = new URL(b.url).searchParams.get('state');
    expect(await finishGoogleSignIn({ binding: b.binding, state: stateB, code: codeForA.code, error: null, baseUrl })).toMatchObject({ problem: 'failed' });
    expect(google.tokenCalls.at(-1)).toEqual({ code: codeForA.code, status: 400 });

    // The nonce must be this request's
    expect((await viaGoogle(google, identity(), { claims: { nonce: randomToken() } })).outcome).toMatchObject({ problem: 'failed' });

    // An expired request is used up and refused, even before TTL deletion
    const old = await beginGoogleSignIn({ baseUrl, next: '/app/account' });
    const oldApproval = google.approve(old.url, identity());
    const stored = (await flowRecord(old.binding))!;
    await getAppStore().replace({ ...stored.doc, createdAt: new Date(Date.now() - (GOOGLE_SIGN_IN_TTL_SECONDS + 1) * 1000).toISOString() }, stored.etag);
    expect(await finishGoogleSignIn({ binding: old.binding, ...oldApproval, error: null, baseUrl }))
        .toEqual({ kind: 'problem', problem: 'expired', next: '/app/account', linking: false });
    expect(await flowRecord(old.binding)).toBeNull();

    // A cancelled consent uses up the request too
    const denied = await beginGoogleSignIn({ baseUrl });
    const deniedState = new URL(denied.url).searchParams.get('state');
    expect(await finishGoogleSignIn({ binding: denied.binding, state: deniedState, code: null, error: 'access_denied', baseUrl })).toMatchObject({ problem: 'cancelled' });
    expect(await finishGoogleSignIn({ binding: denied.binding, state: deniedState, code: 'x', error: null, baseUrl })).toMatchObject({ problem: 'expired' });
});

test('a missing, forged, wrong-purpose or foreign browser binding is refused before the code is used', async ({ google }) => {
    const victim = await beginGoogleSignIn({ baseUrl });
    const approval = google.approve(victim.url, { sub: googleSubject(), email: gmail('google-binding') });
    const attacker = await beginGoogleSignIn({ baseUrl });
    const victimId = boundGoogleRecordId('flow', victim.binding)!;
    const calls = google.tokenCalls.length;
    for (const binding of [undefined, '', attacker.binding, googleBindingToken('link', victimId, 60),
        signToken('sign-in-request', { requestId: victimId }, 60), `${victim.binding.split('.')[0]}.forged`])
        expect(await finishGoogleSignIn({ binding, ...approval, error: null, baseUrl })).toEqual({ kind: 'problem', problem: 'expired', linking: false });
    expect(google.tokenCalls.length).toBe(calls);
    // Both requests are still usable by their own browsers
    signedIn(await finishGoogleSignIn({ binding: victim.binding, ...approval, error: null, baseUrl }));
    expect(await flowRecord(attacker.binding)).not.toBeNull();
});

test('return paths stay under /app when the request starts and again when it finishes', async ({ google }) => {
    for (const next of ['//evil.example/app', 'https://evil.example/app', '/app/../outside', '/application', '/app/%2e%2e/x'])
        expect(signedIn((await viaGoogle(google, { sub: googleSubject(), email: gmail('google-next') }, { next })).outcome).next, next).toBeUndefined();
    expect(signedIn((await viaGoogle(google, { sub: googleSubject(), email: gmail('google-next') }, { next: '/app/account?tab=x#y' })).outcome).next)
        .toBe('/app/account?tab=x');

    const started = await beginGoogleSignIn({ baseUrl, next: '/app' });
    const stored = (await flowRecord(started.binding))!;
    await getAppStore().replace({ ...stored.doc, next: '/app/../outside' }, stored.etag);
    const approval = google.approve(started.url, { sub: googleSubject(), email: gmail('google-next') });
    expect(signedIn(await finishGoogleSignIn({ binding: started.binding, ...approval, error: null, baseUrl })).next).toBeUndefined();
});

test('ID tokens: issuer, audience, authorized party, times, nonce and subject are all checked', () => {
    const nonce = randomToken();
    const expected = { clientId: 'client-a', issuers: ['https://accounts.google.com', 'accounts.google.com'], nonceHash: sha256Hex(nonce) };
    const now = Math.floor(Date.now() / 1000);
    const valid = { iss: 'https://accounts.google.com', aud: 'client-a', azp: 'client-a', sub: '10769150350006150715113082367',
        email: 'ada@example.com', email_verified: true, nonce, iat: now, exp: now + 3600 };
    const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
    expect(googleIdTokenClaims(jwt(valid), expected)).toEqual({ sub: valid.sub, email: valid.email, emailVerified: true, hd: undefined, name: undefined });
    expect(googleIdTokenClaims(jwt({ ...valid, iss: 'accounts.google.com', azp: undefined, hd: 'Acme.example' }), expected))
        .toMatchObject({ hd: 'acme.example' });
    expect(googleIdTokenClaims(jwt({ ...valid, aud: ['client-a', 'client-b'] }), expected)).not.toBeNull();
    for (const claims of [
        { iss: 'https://evil.example' }, { iss: 'https://accounts.google.com/' }, { aud: 'client-b' }, { aud: ['client-b'] },
        { azp: 'client-b' }, { aud: ['client-a', 'client-b'], azp: undefined }, { exp: now - 1 }, { exp: undefined },
        { iat: now + 3600 }, { iat: now - 3600 }, { iat: undefined }, { nonce: randomToken() }, { nonce: undefined },
        { sub: '' }, { sub: 'x'.repeat(256) }, { sub: 'a/b' }, { sub: 12 }
    ]) expect(googleIdTokenClaims(jwt({ ...valid, ...claims }), expected), JSON.stringify(claims)).toBeNull();
    for (const token of [undefined, '', 'a.b', `${jwt(valid)}.extra`, 'e30.bm90LWpzb24.c2ln', `e30.${Buffer.from('[]').toString('base64url')}.c2ln`,
        `e30.${'a'.repeat(16_385)}.c2ln`])
        expect(googleIdTokenClaims(token, expected)).toBeNull();
    expect(googleIdTokenClaims(jwt({ ...valid, email_verified: 'false' }), expected)?.emailVerified).toBe(false);
});

test('starts are limited per IP address', async ({ google }) => {
    expect(google.url).toBeTruthy();
    const ipBucket = `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
    for (let attempt = 0; attempt < 30; attempt++) await beginGoogleSignIn({ baseUrl, ipBucket });
    const error = await beginGoogleSignIn({ baseUrl, ipBucket }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('rate_limited');
});

test('Google sign-in is on only in production and local runtime, and endpoint overrides only locally', async ({ google }) => {
    expect(isGoogleSignInConfigured()).toBe(true);
    expect(googleConfig()).toMatchObject({ tokenUrl: `${google.url}/token`, issuers: [google.url] });
    expect(googleRedirectUri('http://localhost:4004/app?x=1')).toBe('http://localhost:4004/app/sign-in/google/callback');
    process.env.GOOGLE_OAUTH_TOKEN_URL = 'https://evil.example/token';
    expect(isGoogleSignInConfigured()).toBe(false);
    process.env.GOOGLE_OAUTH_TOKEN_URL = `${google.url}/token`;

    delete process.env.UIER_LOCAL;
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    expect(isGoogleSignInConfigured()).toBe(false);
    await expect(beginGoogleSignIn({ baseUrl: 'https://preview.example' })).rejects.toMatchObject({ code: 'not_configured' });
    process.env.VERCEL_ENV = 'production';
    expect(isGoogleSignInConfigured()).toBe(true);
    expect(googleConfig()).toMatchObject({ authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
        issuers: ['https://accounts.google.com', 'accounts.google.com'] });
    expect(googleRedirectUri('https://uier.io')).toBe('https://uier.io/app/sign-in/google/callback');
    expect(() => googleRedirectUri('http://uier.io')).toThrow();
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleSignInConfigured()).toBe(false);
});

test.describe('routes', () => {
    test('a cross-site or prefetched start sets nothing; a same-origin start binds the browser', async ({ request }) => {
        const starts: Record<string, string>[] = [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { purpose: 'prefetch' },
            { 'sec-purpose': 'prefetch;prerender' }];
        for (const headers of starts) {
            const response = await request.get('/app/sign-in/google?next=/app/account', { headers, maxRedirects: 0 });
            expect(response.status(), JSON.stringify(headers)).toBe(302);
            expect(new URL(response.headers().location!).pathname).toBe('/app/sign-in');
            expect(response.headers()['set-cookie'] ?? '').not.toContain('google_sign_in');
        }
        const response = await request.get('/app/sign-in/google?next=/app/account', { headers: { 'sec-fetch-site': 'same-origin' }, maxRedirects: 0 });
        expect(response.status()).toBe(302);
        const location = new URL(response.headers().location!);
        expect(location.pathname).toBe('/o/oauth2/v2/auth');
        expect(location.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\/sign-in\/google\/callback$/);
        const cookie = response.headersArray().find(header => header.name.toLowerCase() === 'set-cookie' && header.value.startsWith('uier_google_sign_in='))!.value;
        for (const attribute of [/^uier_google_sign_in=[^;]+;/, /; Path=\/(;|$)/, /; Max-Age=600(;|$)/, /; HttpOnly(;|$)/, /; SameSite=lax(;|$)/i])
            expect(cookie).toMatch(attribute);
    });

    test('linking from Account starts with a fresh session and needs one', async ({ playwright, baseURL }) => {
        // A stale session is refused in-process ('rule 5: linking needs a sign-in ...'): sessions minted here
        // would use this worker's server secret, which other API specs change, not the server's.
        const fresh = await playwright.request.newContext({ baseURL });
        try {
            const signedOut = await fresh.get('/app/sign-in/google?intent=link', { maxRedirects: 0 });
            const back = new URL(signedOut.headers().location!);
            expect(`${back.pathname}${back.search}`).toBe('/app/sign-in?next=%2Fapp%2Faccount');

            // A Gmail account signs up through the stub: the server has the user and a fresh session
            const start = await fresh.get('/app/sign-in/google', { maxRedirects: 0 });
            const authorize = start.headers().location!;
            const flow = /name="flow" value="([^"]+)"/.exec(await (await fresh.get(authorize)).text())![1]!;
            const decision = await fresh.post(new URL('/decision', authorize).href, { form: { flow, sub: googleSubject(),
                email: gmail('google-recent-route'), email_verified: 'true', decision: 'allow' }, maxRedirects: 0 });
            expect((await fresh.get(decision.headers().location!, { maxRedirects: 0 })).status()).toBe(302);

            const link = await fresh.get('/app/sign-in/google?intent=link', { maxRedirects: 0 });
            const google = new URL(link.headers().location!);
            expect(google.pathname).toBe('/o/oauth2/v2/auth');
            expect(google.searchParams.get('prompt')).toBe('select_account');
            expect(link.headersArray().some(header => header.name.toLowerCase() === 'set-cookie' && header.value.startsWith('uier_google_sign_in='))).toBe(true);
        } finally { await fresh.dispose(); }
    });

    test('the callback signs in once, returns to the stored path and never echoes the code or state', async ({ playwright, baseURL }) => {
        const request = await playwright.request.newContext({ baseURL });
        try {
            const start = await request.get('/app/sign-in/google?next=/app/account', { maxRedirects: 0 });
            const authorize = start.headers().location!;
            const consent = await (await request.get(authorize)).text();
            const flow = /name="flow" value="([^"]+)"/.exec(consent)![1]!;
            const email = gmail('google-route');
            const decision = await request.post(new URL('/decision', authorize).href, { form: { flow, sub: googleSubject(), email,
                email_verified: 'true', name: 'Route Test', decision: 'allow' }, maxRedirects: 0 });
            const callback = decision.headers().location!;
            const code = new URL(callback).searchParams.get('code')!;
            const state = new URL(callback).searchParams.get('state')!;

            const done = await request.get(callback, { maxRedirects: 0 });
            expect(done.status()).toBe(302);
            expect(new URL(done.headers().location!).pathname + new URL(done.headers().location!).search).toBe('/app/account');
            const cookies = done.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value);
            expect(cookies.some(value => /^uier_session=[^;]+/.test(value))).toBe(true);
            expect(cookies.some(value => /^uier_google_sign_in=;/.test(value))).toBe(true);
            const account = await request.get('/app/account');
            await expect(account.text()).resolves.toContain(email);

            // A replay, or the same callback in a browser without the binding, signs nobody in
            for (const context of [request, await playwright.request.newContext({ baseURL })]) {
                const replay = await context.get(callback, { maxRedirects: 0 });
                const location = replay.headers().location!;
                expect(new URL(location).pathname + new URL(location).search).toBe('/app/sign-in?google=expired');
                expect(location).not.toContain(code);
                expect(location).not.toContain(state);
                expect(replay.headers()['set-cookie'] ?? '').not.toContain('uier_session=');
            }
        } finally { await request.dispose(); }
    });
});
