import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { issueExtensionCode, exchangeExtensionCode, extensionSession, readScope, validateAuthorization } from '../src/lib/extension/auth';
import { createScope, extensionReviewContext, matchingProjects } from '../src/lib/extension/review';
import { extensionHandler } from '../src/lib/extension/http';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { createProject, updateProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import type { AppContext } from '../src/lib/app/context';
import { assertVerifiedWrite } from '../src/lib/review/verification';
import { signToken } from '../src/lib/app/tokens';
import { memberId, workspacePk } from '../src/lib/app/model';
import { actorAuthorId, assertCanUseComments } from '../src/lib/review/actor';
import { refreshExtensionSession, revokeExtensionSession, extensionAccessSeconds, extensionIdleSeconds, extensionAbsoluteSeconds } from '../src/lib/extension/sessions';
import { extensionClients, extensionFrameAncestors } from '../src/lib/extension/config';
import { latestExtensionVersion } from '../src/lib/extension/release';
import { GET as extensionOperation } from '../app/api/extension/[operation]/route';
import { readFileSync } from 'node:fs';

const clientId = 'abcdefghijklmnopabcdefghijklmnop';
const redirectUri = `https://${clientId}.chromiumapp.org/uier`;
const original = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_EXTENSION_CLIENT_IDS: process.env.UIER_EXTENSION_CLIENT_IDS, UIER_EXTENSION_CLIENTS: process.env.UIER_EXTENSION_CLIENTS };
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; process.env.UIER_EXTENSION_CLIENT_IDS = clientId; process.env.UIER_EXTENSION_CLIENTS = ''; });
test.afterAll(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const random = () => randomBytes(32).toString('base64url');
async function fixture(renewable = false, registration: { clientId: string; redirectUri: string; extensionOrigin?: string } = { clientId, redirectUri }) {
    const user = await findOrCreateUser(`${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Extension project', urls: ['https://reviewed.example'] });
    const verifier = random(), state = random();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorization = { ...registration, state, challenge, ...(renewable ? { renewable: 'true' as const } : {}) };
    const callback = new URL(await issueExtensionCode(user.id, authorization));
    const exchange = { clientId: registration.clientId, redirectUri: registration.redirectUri, code: callback.searchParams.get('code'), verifier };
    return { user, project, authorization, callback, exchange };
}
const request = (path: string, token?: string, body?: unknown) => new Request(`https://uier.io/api/extension/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
});
async function renewableFixture() {
    const f = await fixture(true);
    const credentials = await exchangeExtensionCode({ ...f.exchange, renewable: true });
    if (!('refreshToken' in credentials)) throw new Error('Expected renewable extension credentials');
    return { ...f, credentials };
}

test('renewable sessions use short access, recover the same rotation and renew after access expiry', async () => {
    const f = await renewableFixture();
    expect(f.credentials.expiresAt - Date.now()).toBeLessThanOrEqual(extensionAccessSeconds * 1000);
    expect(f.credentials.refreshExpiresAt - Date.now()).toBeGreaterThan((extensionIdleSeconds - 5) * 1000);
    const session = await extensionSession(request('projects', f.credentials.token));
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    await expect(extensionSession(request('projects', f.credentials.refreshToken))).rejects.toMatchObject({ status: 401 });
    await expect(extensionReviewContext(request('review/info', f.credentials.refreshToken))).rejects.toMatchObject({ status: 401 });
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    const [first, concurrent] = await Promise.all([refreshExtensionSession(input), refreshExtensionSession(input)]);
    expect(first.refreshToken).not.toBe(f.credentials.refreshToken);
    expect(concurrent.refreshToken).toBe(first.refreshToken);
    const retained = await getAppStore().query<any>({ type: 'extension-refresh-token', pk: session.pk });
    expect(JSON.stringify(retained)).not.toContain(f.credentials.refreshToken);
    expect(JSON.stringify(retained)).not.toContain(first.refreshToken);
    expect(JSON.stringify(retained)).not.toContain(input.attempt);
    const now = Date.now;
    try {
        const later = now() + 2 * 24 * 3600 * 1000;
        Date.now = () => later;
        await expect(extensionSession(request('projects', first.token))).rejects.toMatchObject({ status: 401 });
        // A delayed/lost response can still recover, without extending the inactivity deadline.
        const recovered = await refreshExtensionSession(input);
        expect(recovered.refreshToken).toBe(first.refreshToken);
        expect(recovered.refreshExpiresAt).toBe(first.refreshExpiresAt);
        const next = await refreshExtensionSession({ clientId, refreshToken: recovered.refreshToken, attempt: random() });
        expect(next.refreshExpiresAt).toBeGreaterThan(first.refreshExpiresAt);
        expect((await extensionSession(request('projects', next.token))).userId).toBe(f.user.id);
        await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 });
        // A delayed receipt from an earlier rotation does not revoke its successor.
        await extensionSession(request('projects', next.token));
        await revokeExtensionSession(request('session', next.refreshToken));
        await expect(extensionSession(request('projects', next.token))).rejects.toMatchObject({ status: 401 });
        await expect(refreshExtensionSession({ clientId, refreshToken: next.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
});

test('refresh replay with a new attempt revokes access and scopes; wrong clients cannot revoke', async () => {
    const f = await renewableFixture();
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    process.env.UIER_EXTENSION_CLIENT_IDS = `${clientId},${'a'.repeat(32)}`;
    try {
        await expect(refreshExtensionSession({ ...input, clientId: 'a'.repeat(32) })).rejects.toMatchObject({ status: 401 });
    } finally { process.env.UIER_EXTENSION_CLIENT_IDS = clientId; }
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const next = await refreshExtensionSession(input);
    await expect(refreshExtensionSession({ ...input, attempt: random() })).rejects.toMatchObject({ status: 401 });
    await expect(extensionSession(request('projects', next.token))).rejects.toMatchObject({ status: 401 });
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
});

test('renewal expires after 30 idle days or one year even with regular use', async () => {
    const idle = await renewableFixture(), active = await renewableFixture();
    const start = Date.now(), now = Date.now;
    let current = active.credentials;
    try {
        let time = start;
        Date.now = () => time;
        time = start + (extensionIdleSeconds + 1) * 1000;
        await expect(refreshExtensionSession({ clientId, refreshToken: idle.credentials.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
        for (let day = 20; day <= 360; day += 20) {
            time = start + day * 24 * 3600 * 1000;
            current = await refreshExtensionSession({ clientId, refreshToken: current.refreshToken, attempt: random() });
        }
        expect(current.refreshExpiresAt).toBeLessThanOrEqual(start + extensionAbsoluteSeconds * 1000);
        time = start + extensionAbsoluteSeconds * 1000 + 1;
        await expect(refreshExtensionSession({ clientId, refreshToken: current.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
});

test('logout after access expiry, removed clients/users and forged refresh credentials fail closed', async () => {
    const f = await renewableFixture();
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    await expect(refreshExtensionSession({ ...input, refreshToken: input.refreshToken.slice(0, -43) + random() })).rejects.toMatchObject({ status: 401 });
    process.env.UIER_EXTENSION_CLIENT_IDS = '';
    try { await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 }); }
    finally { process.env.UIER_EXTENSION_CLIENT_IDS = clientId; }
    const now = Date.now;
    try {
        const later = now() + 3600 * 1000;
        Date.now = () => later;
        await revokeExtensionSession(request('session', input.refreshToken));
        await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
    const removed = await renewableFixture();
    await getAppStore().delete(removed.user.pk, removed.user.id);
    await expect(refreshExtensionSession({ clientId, refreshToken: removed.credentials.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
});

test('concurrent refresh and logout cannot recreate a revoked session', async () => {
    const f = await renewableFixture();
    const results = await Promise.allSettled([
        refreshExtensionSession({ clientId, refreshToken: f.credentials.refreshToken, attempt: random() }),
        revokeExtensionSession(request('session', f.credentials.refreshToken))
    ]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'fulfilled')
        await expect(extensionSession(request('projects', results[0].value.token))).rejects.toMatchObject({ status: 401 });
    await expect(extensionSession(request('projects', f.credentials.token))).rejects.toMatchObject({ status: 401 });
});

test('exact callback, client registration, state, PKCE and atomic one-use handoff', async () => {
    const f = await fixture();
    expect(f.callback.searchParams.get('state')).toBe(f.authorization.state);
    for (const override of [{ redirectUri: `${redirectUri}/extra` }, { clientId: 'a'.repeat(32) }, { challenge: '' }, { state: 'short' }])
        expect(() => validateAuthorization({ ...f.authorization, ...override })).toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, verifier: random() })).rejects.toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, redirectUri: `${redirectUri}?evil=1` })).rejects.toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, renewable: true })).rejects.toThrow();
    const results = await Promise.allSettled([exchangeExtensionCode(f.exchange), exchangeExtensionCode(f.exchange)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ token: string }>;
    expect((await extensionSession(request('projects', winner.value.token))).userId).toBe(f.user.id);
    expect(winner.value).not.toHaveProperty('refreshToken');
    // An app/embed/MCP purpose never authenticates the extension API.
    for (const purpose of ['session', 'review', 'mcp-access'])
        await expect(extensionSession(request('projects', signToken(purpose, { uid: f.user.id }, 60)))).rejects.toThrow();
});
test('expired handoff is rejected before session creation', async () => {
    const f = await fixture();
    const hash = createHash('sha256').update(f.exchange.code!).digest('hex');
    const entry = (await getAppStore().get<any>(`extension-code:${hash}`, hash))!;
    await getAppStore().replace({ ...entry.doc, expiresAt: Date.now() - 1 }, entry.etag);
    await expect(exchangeExtensionCode(f.exchange)).rejects.toThrow();
});
test('scoped access derives the origin and rechecks address removal, comments off and revocation', async () => {
    const f = await fixture();
    const credentials = await exchangeExtensionCode(f.exchange);
    const matches = await (await matchingProjects(request('projects?origin=https://reviewed.example', credentials.token))).json() as { projects: { projectId: string }[] };
    expect(matches.projects.map((p: any) => p.projectId)).toContain(f.project.id);
    const noMatch = await (await matchingProjects(request('projects?origin=https://reviewed.example.evil.test', credentials.token))).json() as { projects: unknown[] };
    expect(noMatch.projects).toEqual([]);
    await expect(createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://evil.test' }))).rejects.toThrow();
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const scopedRequest = request('review/info', scoped.token);
    expect(readScope(scopedRequest).origin).toBe('https://reviewed.example');
    const context = await extensionReviewContext(scopedRequest);
    expect(context.actor.kind).toBe('member');
    await expect(assertVerifiedWrite(context)).rejects.toThrow();
    const proof = signToken('review-verification', { projectId: f.project.id, origin: context.siteOrigin, authorId: actorAuthorId(context.actor) }, 300);
    await assertVerifiedWrite({ ...context, request: new Request(scopedRequest, { headers: { 'X-Uier-Verification': proof } }) });
    await expect(assertVerifiedWrite({ ...context, siteOrigin: 'https://evil.test', request: new Request(scopedRequest, { headers: { 'X-Uier-Verification': proof } }) })).rejects.toThrow();
    await updateProject(f.project.workspaceId, f.project.id, { urls: ['https://elsewhere.example'] });
    await expect(extensionReviewContext(scopedRequest)).rejects.toThrow();
    const session = await extensionSession(request('session', credentials.token));
    await getAppStore().delete(session.pk, session.id);
    await expect(extensionSession(request('projects', credentials.token))).rejects.toThrow();
    await expect(extensionReviewContext(scopedRequest)).rejects.toThrow();
});
test('the public version matches every browser package and needs no credentials', async () => {
    const versions = ['extension', 'extension-firefox'].map(app => (JSON.parse(readFileSync(new URL(`../../${app}/package.json`, import.meta.url), 'utf8')) as { version: string }).version);
    expect(versions).toEqual([latestExtensionVersion, latestExtensionVersion]);
    for (const origin of [undefined, `chrome-extension://${clientId}`]) {
        const response = await extensionOperation(new Request('https://uier.io/api/extension/version', { headers: origin ? { Origin: origin } : {} }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ version: latestExtensionVersion });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin ?? null);
    }
    const foreign = await extensionOperation(new Request('https://uier.io/api/extension/version', { headers: { Origin: 'https://evil.test' } }));
    expect(foreign.status).toBe(403);
});

test('extension CORS cannot grant identity and leaves embed policy separate', async () => {
    const handler = extensionHandler(async request => { await extensionSession(request); return Response.json({ ok: true }); });
    for (const origin of [undefined, `chrome-extension://${clientId}`, 'https://evil.test']) {
        const response = await handler(new Request('https://uier.io/api/extension/projects', { headers: origin ? { Origin: origin } : {} }));
        expect(response.ok).toBe(false);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin?.startsWith('chrome-extension:') ? origin : null);
    }
});

test('Firefox uses exact registered callbacks and binds renewable scopes to its current extension origin', async () => {
    const id = 'uier@signalco.io';
    const callback = 'https://1234567890abcdef.extensions.allizom.org/';
    const scheme = 'moz-extension';
    const extensionOrigin = `${scheme}://12345678-1234-1234-1234-123456789abc`;
    const nextOrigin = `${scheme}://abcdefab-1234-1234-1234-123456789abc`;
    process.env.UIER_EXTENSION_CLIENTS = JSON.stringify([{ id, browser: 'firefox', redirectUri: callback }]);
    try {
        const f = await fixture(true, { clientId: id, redirectUri: callback, extensionOrigin });
        expect(f.callback.href.startsWith(callback)).toBe(true);
        for (const override of [
            { extensionOrigin: undefined }, { extensionOrigin: 'https://evil.test' },
            { extensionOrigin: `${extensionOrigin}/` }, { extensionOrigin: `chrome-extension://${clientId}` },
            { redirectUri: `${callback}?redirect=https://evil.test` }, { clientId: `${id}.unknown` }
        ]) expect(() => validateAuthorization({ ...f.authorization, ...override })).toThrow();
        const credentials = await exchangeExtensionCode({ ...f.exchange, renewable: true });
        if (!('refreshToken' in credentials)) throw new Error('Expected renewable session');
        expect((await extensionSession(request('projects', credentials.token))).extensionOrigin).toBe(extensionOrigin);
        const scope = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
        expect(readScope(request('review/info', scope.token)).extensionOrigin).toBe(extensionOrigin);
        const refresh = { clientId: id, refreshToken: credentials.refreshToken, attempt: random() };
        await expect(refreshExtensionSession(refresh)).rejects.toMatchObject({ status: 401 });
        await expect(refreshExtensionSession({ ...refresh, extensionOrigin: 'https://evil.test' })).rejects.toMatchObject({ status: 401 });
        const renewed = await refreshExtensionSession({ ...refresh, extensionOrigin: nextOrigin });
        expect((await extensionSession(request('projects', renewed.token))).extensionOrigin).toBe(nextOrigin);
        await expect(extensionSession(request('projects', credentials.token))).rejects.toMatchObject({ status: 401 });
        await expect(extensionReviewContext(request('review/info', scope.token))).rejects.toMatchObject({ status: 401 });
        // A lost refresh response recovers the same successor while rebinding the origin.
        const recovered = await refreshExtensionSession({ ...refresh, extensionOrigin });
        expect(recovered.refreshToken).toBe(renewed.refreshToken);
        expect(recovered.refreshExpiresAt).toBe(renewed.refreshExpiresAt);
        expect((await extensionSession(request('projects', recovered.token))).extensionOrigin).toBe(extensionOrigin);
        const handler = extensionHandler(async request => { await extensionSession(request); return Response.json({ ok: true }); });
        const unauthenticated = await handler(new Request('https://uier.io/api/extension/projects', { headers: { Origin: extensionOrigin } }));
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe(extensionOrigin);
        const helper = new URL('https://uier.io/extension-verification');
        helper.searchParams.set('clientId', id); helper.searchParams.set('extensionOrigin', extensionOrigin);
        expect(extensionFrameAncestors(helper)).toEqual([extensionOrigin]);
        helper.searchParams.set('extensionOrigin', 'https://evil.test');
        expect(extensionFrameAncestors(helper)).toEqual([]);
        expect(extensionFrameAncestors(new URL('https://uier.io/extension-verification'))).toEqual([`chrome-extension://${clientId}`]);
        process.env.UIER_EXTENSION_CLIENTS = '[]';
        await expect(extensionSession(request('projects', recovered.token))).rejects.toMatchObject({ status: 401 });
    } finally { process.env.UIER_EXTENSION_CLIENTS = ''; }
});

test('additional browser registrations fail closed on malformed or duplicate configuration', async () => {
    for (const value of ['{', '{}', JSON.stringify([{ id: 'uier@signalco.io', browser: 'firefox', redirectUri: 'https://evil.test/' }]),
        JSON.stringify([{ id: clientId, browser: 'firefox', redirectUri: 'https://1234567890abcdef.extensions.allizom.org/' }]),
        JSON.stringify([{ id: 'uier@signalco.io', browser: 'unsupported', redirectUri: 'https://1234567890abcdef.extensions.allizom.org/' }])]) {
        process.env.UIER_EXTENSION_CLIENTS = value;
        expect(extensionClients().map(client => client.id)).toEqual([clientId]);
    }
    process.env.UIER_EXTENSION_CLIENTS = '';
});

test('live membership and comments-off checks apply to extension review contexts', async () => {
    const f = await fixture();
    const credentials = await exchangeExtensionCode(f.exchange);
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    await updateProject(f.project.workspaceId, f.project.id, { access: 'disabled' });
    const disabled = await extensionReviewContext(request('review/comments', scoped.token));
    expect(() => assertCanUseComments(disabled.project, disabled.actor)).toThrow('Comments are turned off');
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
    // A forged/expired scoped token cannot fall back to anonymous access on a guest project.
    const expired = signToken('extension-review-v1', { projectId: f.project.id, origin: 'https://reviewed.example' }, -1);
    await expect(extensionReviewContext(request('review/info', expired))).rejects.toMatchObject({ status: 401 });
});

test('priority uses scoped extension identity and the shared proof and member authority', async () => {
    const { prioritizeReviewComment } = await import('../src/lib/review/routes');
    const { createProjectComment } = await import('../src/lib/review/comments');
    const { memberActor } = await import('../src/lib/review/actor');
    const f = await fixture();
    const actor = (await memberActor(f.project, f.user.id))!;
    const comment = await createProjectComment(new Request('https://uier.io'), f.project, actor, {
        origin: 'https://reviewed.example', path: '/', position: { type: 'page' }, kind: 'feedback', text: 'Extension priority'
    });
    const credentials = await exchangeExtensionCode(f.exchange);
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const url = `https://uier.io/api/extension/review/comments/${comment.id}/priority`;
    const headers = { Authorization: `Bearer ${scoped.token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ priority: 'urgent', idempotencyKey: randomUUID() });
    const unverified = await extensionReviewContext(new Request(url, { method: 'PATCH', headers, body }));
    await expect(assertVerifiedWrite(unverified)).rejects.toMatchObject({ status: 403 });
    const proof = signToken('review-verification', { projectId: f.project.id, origin: 'https://reviewed.example', authorId: actorAuthorId(actor) }, 300);
    const verified = new Request(url, { method: 'PATCH', headers: { ...headers, 'X-Uier-Verification': proof }, body });
    const context = await extensionReviewContext(verified);
    await assertVerifiedWrite(context);
    const response = await prioritizeReviewComment(context, { id: comment.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ priority: 'urgent', permissions: { priority: true } });
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    await expect(extensionReviewContext(verified)).rejects.toMatchObject({ status: 401 });
});

test('extension reply image reads use the closed broker route and current thread authority', async () => {
    const { getReviewScreenshot } = await import('../src/lib/review/routes');
    const { allowedExtensionOperation, extensionOperation } = await import('@uier/toolbar/extension-contract');
    const { getMemoryCommentsStore } = await import('../src/lib/repo/memoryCommentsStore');
    const { screenshotSchema } = await import('../src/lib/comments/validation');
    const { screenshotDocument, screenshotInfo } = await import('../src/lib/comments/service');
    const { pngImage } = await import('./support/images');
    const f = await renewableFixture();
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const screenshot = await screenshotSchema.parseAsync(pngImage);
    const id = `comment_${randomUUID()}`, itemId = `item_${randomUUID()}`;
    const comment = { id, domain: `project:${f.project.id}`, path: '/', position: { type: 'page' as const }, authorId: `user:${f.user.id}`,
        private: true, thread: { items: [{ id: 'first', text: 'Original' }, { id: itemId, text: 'Reply evidence', screenshot: screenshotInfo(screenshot) }] } };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    await store.createScreenshot(screenshotDocument(comment, screenshot, itemId));
    const path = `comments/${id}/replies/${itemId}/screenshot`;
    const GET = extensionHandler(async request => getReviewScreenshot(await extensionReviewContext(request), { id, itemId }));
    expect(extensionOperation(`https://uier.io/api/review/${f.project.id}/${path}`, 'https://uier.io', f.project.id, 'GET').path).toBe(path);
    for (const method of ['POST', 'PATCH', 'DELETE']) expect(allowedExtensionOperation(path, method)).toBe(false);
    const response = await GET(request(`review/${path}`, scoped.token));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(screenshot.data);
    expect((await store.get(comment.domain, id))!.comment.thread.items).toHaveLength(2);
    expect((await GET(request(`review/${path}`))).status).toBe(401);
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    expect((await GET(request(`review/${path}`, scoped.token))).status).toBe(401);
});


test('extension comment lists forward archive filters while unknown query keys stay closed', async () => {
    const { extensionOperation } = await import('@uier/toolbar/extension-contract');
    const base = 'https://uier.io/api/review/project123/comments';
    for (const archive of ['exclude', 'only', 'all']) {
        for (const scope of ['path=%2F', 'scope=site&unread=true']) {
            const query = `?${scope}&archive=${archive}`;
            expect(extensionOperation(`${base}${query}`, 'https://uier.io', 'project123', 'GET'))
                .toEqual({ path: 'comments', query });
        }
    }
    expect(() => extensionOperation(`${base}?arbitrary=true`, 'https://uier.io', 'project123', 'GET'))
        .toThrow('Unsupported review query');
});
