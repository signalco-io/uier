import { expect, test } from '@playwright/test';
import { NextRequest, NextResponse } from 'next/server.js';
import { GET, POST } from '../app/api/account/sessions/route';
import { GET as appTicket } from '../app/api/realtime/ticket/route';
import { projectLinkAccounts } from '../src/lib/app/projectLinkAccounts';
import { createWorkspace } from '../src/lib/app/workspaces';
import { loadAppContext } from '../src/lib/app/requestContext';
import { proxy } from '../proxy';
import { addBrowserSession, browserSessions, switchBrowserAccount, removeBrowserAccount, writeBrowserSessions, MAX_BROWSER_ACCOUNTS,
    ACCOUNT_LIMIT_MESSAGE, type AccountCookieWriter } from '../src/lib/app/browserAccounts';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { appCookieOptions } from '../src/lib/app/appCookies';
import { sessionToken, sessionSignedInAt, sessionEmailProof, requestSessionUser } from '../src/lib/app/sessionIdentity';
import { isReviewSignedOut, readReviewSsoSession, REVIEW_SSO_COOKIE_NAME } from '../src/lib/app/reviewSsoCookie';
import { signToken, verifyToken } from '../src/lib/app/tokens';
import { findOrCreateUser, finishWelcome } from '../src/lib/app/users';
import { getAppStore } from '../src/lib/app/store';
import { freshlyProvenEmail } from '../src/lib/app/emailProof';
import { requireRecentSignIn } from '../src/lib/app/passkeys';
import { createProject } from '../src/lib/app/projects';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import type { AppContext } from '../src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { uniqueEmail } from './support/app';

const origin = 'http://localhost:4104';
const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = originalLocal;
});

test('document preflight leaves action and flight redirects to Next, including internal fetches without the rsc header', async () => {
    const variants: HeadersInit[] = [{ Accept: 'text/x-component' }, { 'Next-Action': 'action-id' }, { RSC: '1' }];
    for (const headers of variants) {
        const response = await proxy(new NextRequest(`${origin}/app`, { headers: { ...Object.fromEntries(new Headers(headers)), Cookie: 'uier_session=invalid' } }));
        expect(response.headers.get('x-middleware-next')).toBe('1');
        expect(response.headers.get('location')).toBeNull();
    }
    const document = await proxy(new NextRequest(`${origin}/app/projects/private`, { headers: { Accept: 'text/html' } }));
    expect(document.status).toBe(307);
    expect(new URL(document.headers.get('location')!).searchParams.get('next')).toBe('/app/projects/private');
});

class Jar {
    values = new Map<string, string>();
    writes = new Map<string, Parameters<AccountCookieWriter['set']>[2]>();
    get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { value }; }
    set: AccountCookieWriter['set'] = (name, value, options) => {
        this.writes.set(name, options);
        if (!options.maxAge) this.values.delete(name); else this.values.set(name, value);
    };
    header() { return [...this.values].map(([name, value]) => `${name}=${value}`).join('; '); }
    apply(response: Response) {
        for (const cookie of new NextResponse(null, { headers: response.headers }).cookies.getAll()) {
            if (cookie.maxAge === 0) this.values.delete(cookie.name); else this.values.set(cookie.name, cookie.value);
        }
    }
}
const primary = () => cookieName(cookieNames.session);
async function account(jar: Jar, label: string, proof = true) {
    const user = await findOrCreateUser(uniqueEmail(label));
    const { token } = sessionToken(user.id, proof ? user.email : undefined);
    await addBrowserSession(jar, token);
    return { user, token };
}
function request(jar: Jar, input?: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(`${origin}/api/account/sessions`, {
        method: input ? 'POST' : 'GET', headers: { host: 'localhost:4104', origin, 'sec-fetch-site': 'same-origin',
            cookie: jar.header(), 'content-type': 'application/json', ...headers }, body: input ? JSON.stringify(input) : undefined
    });
}

test('switching preserves each original credential, sign-in time, expiry and account-bound email proof', async () => {
    const jar = new Jar();
    const a = await account(jar, 'account-a');
    const b = await account(jar, 'account-b', false);
    expect((await requestSessionUser(request(jar)))?.id).toBe(b.user.id);
    expect(sessionEmailProof(b.token, a.user)).toBeNull();
    expect(sessionEmailProof(b.token, b.user)).toBeNull();
    const previousNow = Date.now;
    try {
        Date.now = () => previousNow() + 11 * 60_000;
        await switchBrowserAccount(jar, a.user.id);
        expect(jar.get(primary())?.value).toBe(a.token);
        expect(sessionSignedInAt(jar.get(primary())?.value)).toEqual(sessionSignedInAt(a.token));
        expect(() => requireRecentSignIn(sessionSignedInAt(jar.get(primary())?.value)!.signedInAt)).toThrow();
        expect(sessionEmailProof(jar.get(primary())?.value, a.user)).toEqual(sessionEmailProof(a.token, a.user));
        expect(freshlyProvenEmail(a.user.email, sessionEmailProof(jar.get(primary())?.value, a.user))).toBeNull();
        expect(jar.writes.get(primary())?.maxAge).toBeLessThan(cookieNames.session.lifetime);
        expect(readReviewSsoSession(jar.get(REVIEW_SSO_COOKIE_NAME)?.value)).toMatchObject({ uid: a.user.id, exp: verifyToken('session', a.token)!.exp });
        await switchBrowserAccount(jar, b.user.id);
        expect(jar.get(primary())?.value).toBe(b.token);
        expect(sessionEmailProof(jar.get(primary())?.value, b.user)).toBeNull();
    } finally { Date.now = previousNow; }
});

test('document preflight keeps repeated-query semantics and public-workspace staff redirects', async () => {
    const jar = new Jar();
    const { user } = await account(jar, 'page-preflight');
    const get = (path: string) => proxy(new NextRequest(`${origin}${path}`, { headers: { cookie: jar.header() } }));
    const repeated = await get('/app/sign-in?add=1&add=1&next=/app/account&next=/app/projects');
    expect(new URL(repeated.headers.get('location')!).pathname).toBe('/app');
    const adding = await get('/app/sign-in?add=1');
    expect(adding.headers.get('x-middleware-next')).toBe('1');

    const previousStaff = process.env.UIER_STAFF_EMAILS;
    process.env.UIER_STAFF_EMAILS = user.email;
    jar.values.set(cookieName(cookieNames.workspace), PUBLIC_WORKSPACE_ID);
    try {
        for (const path of ['/app/projects/new', '/app/workspace/users', '/app/workspace/settings']) {
            const response = await get(path);
            expect(response.status).toBe(307);
            expect(new URL(response.headers.get('location')!).pathname).toBe('/app/projects');
        }
    } finally {
        if (previousStaff === undefined) delete process.env.UIER_STAFF_EMAILS;
        else process.env.UIER_STAFF_EMAILS = previousStaff;
    }
});

test('redirect-only app documents keep HTTP redirects before a shell streams', async () => {
    const jar = new Jar();
    const { user } = await account(jar, 'document-redirects');
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Legacy install', urls: ['https://reviewed.example'], clientName: 'Document client' });
    await finishWelcome(user.id);
    const paths = [
        ['/app/workspace', '/app/workspace/users'],
        ['/app/welcome', '/app'],
        ['/app/join?next=/app/account', '/app/account'],
        [`/app/projects/${project.id}/install`, `/app/projects/${project.id}/settings/installation`],
        ['/app/projects?client=name:Document%20client&status=done', `/app/projects?status=done&client=${project.clientId}`]
    ];
    for (const [path, target] of paths) {
        const response = await proxy(new NextRequest(`${origin}${path}`, { headers: { cookie: jar.header() } }));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe(`${origin}${target}`);
    }
});

test('expired, forged, wrong-purpose and deleted accounts cannot be selected or rescue an invalid active session', async () => {
    const jar = new Jar();
    const a = await account(jar, 'live');
    const b = await account(jar, 'removed');
    await getAppStore().delete(b.user.pk, b.user.id);
    jar.values.set(primary(), 'forged');
    jar.values.set(cookieName(cookieNames.account2), signToken('session', { uid: a.user.id }, -1));
    jar.values.set(cookieName(cookieNames.account3), signToken('review-sso', { uid: b.user.id }, 300));
    expect(await requestSessionUser(request(jar))).toBeNull();
    expect(await browserSessions(jar)).toMatchObject([{ user: { id: a.user.id }, active: false }]);
    const before = jar.header();
    for (const userId of [b.user.id, 'not-held-in-this-browser']) {
        expect((await POST(request(jar, { action: 'switch', userId }))).status).toBe(400);
        expect(jar.header()).toBe(before);
    }
    // Recovery is an explicit selection, including when the active session has ended.
    const selected = await POST(request(jar, { action: 'switch', userId: a.user.id }));
    expect(selected.status).toBe(200);
    jar.apply(selected);
    expect((await requestSessionUser(request(jar)))?.id).toBe(a.user.id);
});

test('the five-account cap fails without changing any session; signing in again replaces only that account', async () => {
    const jar = new Jar();
    const accounts = [];
    for (let i = 0; i < MAX_BROWSER_ACCOUNTS; i++) accounts.push(await account(jar, `cap-${i}`));
    const before = jar.header();
    const extra = await findOrCreateUser(uniqueEmail('sixth'));
    await expect(addBrowserSession(jar, sessionToken(extra.id).token)).rejects.toThrow(ACCOUNT_LIMIT_MESSAGE);
    expect(jar.header()).toBe(before);
    const first = accounts[0]!;
    const renewed = signToken('session', { uid: first.user.id, iat: Math.floor(Date.now() / 1000) }, 1000);
    await addBrowserSession(jar, renewed);
    expect(jar.get(primary())?.value).toBe(renewed);
    const sessions = await browserSessions(jar);
    expect(sessions).toHaveLength(MAX_BROWSER_ACCOUNTS);
    expect(sessions.filter(session => session.user.id === first.user.id)).toHaveLength(1);
    for (const other of accounts.slice(1)) expect(sessions.find(s => s.user.id === other.user.id)?.token).toBe(other.token);
    await removeBrowserAccount(jar);
    await addBrowserSession(jar, sessionToken(extra.id).token);
    expect(await browserSessions(jar)).toHaveLength(MAX_BROWSER_ACCOUNTS);
});

test('sign out selects only another live account and sign out all clears current, parked and legacy authorization', async () => {
    const jar = new Jar();
    const a = await account(jar, 'signout-a');
    const b = await account(jar, 'signout-b');
    let response = await POST(request(jar, { action: 'sign-out' }));
    expect(await response.json()).toEqual({ next: '/app' });
    jar.apply(response);
    expect(await browserSessions(jar)).toMatchObject([{ user: { id: a.user.id }, token: a.token }]);
    expect(readReviewSsoSession(jar.get(REVIEW_SSO_COOKIE_NAME)?.value)?.uid).toBe(a.user.id);
    expect((await POST(request(jar, { action: 'switch', userId: b.user.id }))).status).toBe(400);
    response = await POST(request(jar, { action: 'sign-out-all' }));
    expect(await response.json()).toEqual({ next: '/app/sign-in' });
    jar.apply(response);
    expect(await requestSessionUser(request(jar))).toBeNull();
    expect(await browserSessions(jar)).toEqual([]);
    expect(readReviewSsoSession(jar.get(REVIEW_SSO_COOKIE_NAME)?.value)).toBeNull();
    expect(isReviewSignedOut(jar.get(REVIEW_SSO_COOKIE_NAME)?.value)).toBe(true);
    expect(verifyToken('session', jar.get(REVIEW_SSO_COOKIE_NAME)?.value)).toBeNull();
});

test('expiry of a parked credential leaves the active session intact and frees its slot', async () => {
    const jar = new Jar();
    const a = await account(jar, 'expiring');
    const short = signToken('session', { uid: a.user.id }, 5);
    await addBrowserSession(jar, short);
    const b = await account(jar, 'longer');
    const previousNow = Date.now;
    try {
        Date.now = () => previousNow() + 6000;
        expect(await browserSessions(jar)).toMatchObject([{ token: b.token, active: true }]);
        await expect(switchBrowserAccount(jar, a.user.id)).rejects.toThrow();
        expect(jar.get(primary())?.value).toBe(b.token);
    } finally { Date.now = previousNow; }
});

for (const change of ['sign-out-all', 'switch'] as const) {
    test(`a late app response cannot restore the former review identity after ${change}`, async () => {
        const jar = new Jar();
        const b = await account(jar, 'late-other');
        const a = await account(jar, 'late-original');
        // A browser does not send Path=/api/review cookies to /app, including on prefetches.
        const appCookies = jar.header().split('; ').filter(cookie => !cookie.startsWith(`${REVIEW_SSO_COOKIE_NAME}=`));
        const late = await proxy(new NextRequest(`${origin}/app/account`, {
            headers: { cookie: appCookies.join('; '), purpose: 'prefetch' }
        }));
        expect(late.headers.get('set-cookie')).toBeNull();
        const changed = await POST(request(jar, change === 'switch' ? { action: change, userId: b.user.id } : { action: change }));
        expect(changed.status).toBe(200);
        jar.apply(changed);
        const companion = jar.get(REVIEW_SSO_COOKIE_NAME)?.value;
        // Apply the old request's headers last, as a delayed response would arrive in the browser.
        jar.apply(late);
        expect(jar.get(REVIEW_SSO_COOKIE_NAME)?.value).toBe(companion);
        if (change === 'switch') {
            expect(readReviewSsoSession(companion)?.uid).toBe(b.user.id);
            expect((await requestSessionUser(request(jar)))?.id).toBe(b.user.id);
        } else {
            expect(isReviewSignedOut(companion)).toBe(true);
            expect(await requestSessionUser(request(jar))).toBeNull();
        }
        expect(readReviewSsoSession(jar.get(REVIEW_SSO_COOKIE_NAME)?.value)?.uid).not.toBe(a.user.id);
    });
}

test('cross-site or malformed selections mutate no cookies and never return credentials', async () => {
    const jar = new Jar();
    const a = await account(jar, 'csrf');
    const crossSiteHeaders: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }];
    for (const headers of crossSiteHeaders) {
        const response = await POST(request(jar, { action: 'switch', userId: a.user.id }, headers));
        expect(response.status).toBe(403);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.text()).not.toContain(a.token);
    }
    for (const input of [{ action: 'switch' }, { action: 'switch', userId: a.user.id, token: a.token }, { action: 'sign-out-all', userId: a.user.id }])
        expect((await POST(request(jar, input))).status).toBe(400);
    const response = await GET(request(jar));
    expect(await response.json()).toEqual({ userId: a.user.id });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await GET(request(jar, undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    const switched = await POST(request(jar, { action: 'switch', userId: a.user.id, next: 'https://evil.example' }));
    expect(await switched.json()).toEqual({ next: '/app' });
});

test('HTTPS credentials keep Host, Secure, HttpOnly and legacy non-resurrection rules', async () => {
    const jar = new Jar();
    const a = await account(jar, 'secure-a');
    const b = await account(jar, 'secure-b');
    const sessions = await browserSessions(jar);
    process.env.UIER_LOCAL = '0';
    try {
        jar.values.set(cookieNames.session.name, 'invalid');
        // New parked cookies deliberately have no unprefixed fallback on HTTPS.
        expect((await browserSessions(jar)).some(session => session.user.id === a.user.id)).toBe(false);
        writeBrowserSessions(jar, sessions);
        for (const cookie of [cookieNames.session, cookieNames.account1]) {
            expect(cookie.name).toMatch(/^__Host-/);
            expect(jar.writes.get(cookie.name)).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
        }
        expect(jar.get(cookieNames.session.legacy)).toBeUndefined();
        await removeBrowserAccount(jar, true);
        expect(jar.get(cookieNames.session.name)).toBeUndefined();
        expect(jar.get(cookieNames.session.legacy)).toBeUndefined();
        expect(await browserSessions(jar)).toEqual([]);
        expect(appCookieOptions(10)).toMatchObject({ secure: true, httpOnly: true });
    } finally { process.env.UIER_LOCAL = '1'; }
});

test('app APIs authorize only the active account even when another project owner is parked in the same browser', async () => {
    const jar = new Jar();
    const a = await account(jar, 'owner');
    const member = await ensureOwnWorkspace(a.user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user: a.user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Only owner A', urls: ['https://reviewed.example'] });
    const ticketRequest = () => new Request(`${origin}/api/realtime/ticket?projectId=${project.id}`, { headers: { cookie: jar.header() } });
    expect((await appTicket(ticketRequest())).status).toBe(200);
    await account(jar, 'other-account');
    expect((await appTicket(ticketRequest())).status).toBe(404);
    await switchBrowserAccount(jar, a.user.id);
    expect((await appTicket(ticketRequest())).status).toBe(200);
    jar.values.set(primary(), 'invalid');
    expect((await appTicket(ticketRequest())).status).toBe(401);
});


test('project links offer only live signed-in accounts with access, including another workspace of the active account', async () => {
    const jar = new Jar();
    const a = await account(jar, 'link-owner');
    const own = await loadAppContext(a.user);
    const project = await createProject(own!, { name: 'Private link target', urls: ['https://example.com'] });
    const next = `/app/projects/${project.id}?comment=comment_test&view=board`;
    expect(await projectLinkAccounts(jar, next)).toEqual([]);
    const secondWorkspace = await createWorkspace(a.user, 'Another workspace');
    jar.values.set(cookieName(cookieNames.workspace), secondWorkspace.id);
    expect(await projectLinkAccounts(jar, next)).toMatchObject([{ userId: a.user.id, workspaceId: project.workspaceId }]);
    await account(jar, 'link-other');
    expect(await projectLinkAccounts(jar, next)).toMatchObject([{ userId: a.user.id, workspaceId: project.workspaceId }]);
    const response = await proxy(new NextRequest(`${origin}${next}`, { headers: { cookie: jar.header() } }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(next);
    const review = await proxy(new NextRequest(`${origin}/app/review/${project.id}?url=https%3A%2F%2Fexample.com&comment=comment_test`, { headers: { cookie: jar.header() } }));
    expect(new URL(review.headers.get('location')!).pathname).toBe('/app/switch-project-account');
    for (const invalid of ['/app/projects/missing00000', '//outside.example/app/projects/test', '/app/account', '/app/projects/new'])
        expect(await projectLinkAccounts(jar, invalid)).toEqual([]);
    await getAppStore().delete(own!.member.pk, own!.member.id);
    expect(await projectLinkAccounts(jar, next)).toEqual([]);
    // Restore the same session's access to test invalid credentials independently.
    await getAppStore().create(own!.member);
    // A forged or expired parked identity cannot reveal even this known project's existence.
    for (const token of ['invalid', signToken('session', { uid: a.user.id }, -1)]) {
        jar.values.set(cookieName(cookieNames.account1), token);
        expect(await projectLinkAccounts(jar, next)).toEqual([]);
        const denied = await proxy(new NextRequest(`${origin}${next}`, { headers: { cookie: jar.header() } }));
        expect(denied.status).toBe(404);
        expect(denied.headers.get('location')).toBeNull();
    }
});
