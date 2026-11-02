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

const clientId = 'abcdefghijklmnopabcdefghijklmnop';
const redirectUri = `https://${clientId}.chromiumapp.org/uier`;
const original = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_EXTENSION_CLIENT_IDS: process.env.UIER_EXTENSION_CLIENT_IDS };
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; process.env.UIER_EXTENSION_CLIENT_IDS = clientId; });
test.afterAll(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const random = () => randomBytes(32).toString('base64url');
async function fixture() {
    const user = await findOrCreateUser(`${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Extension project', urls: ['https://reviewed.example'] });
    const verifier = random(), state = random();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorization = { clientId, redirectUri, state, challenge };
    const callback = new URL(await issueExtensionCode(user.id, authorization));
    const exchange = { clientId, redirectUri, code: callback.searchParams.get('code'), verifier };
    return { user, project, authorization, callback, exchange };
}
const request = (path: string, token?: string, body?: unknown) => new Request(`https://uier.io/api/extension/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
});
test('exact callback, client registration, state, PKCE and atomic one-use handoff', async () => {
    const f = await fixture();
    expect(f.callback.searchParams.get('state')).toBe(f.authorization.state);
    for (const override of [{ redirectUri: `${redirectUri}/extra` }, { clientId: 'a'.repeat(32) }, { challenge: '' }, { state: 'short' }])
        expect(() => validateAuthorization({ ...f.authorization, ...override })).toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, verifier: random() })).rejects.toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, redirectUri: `${redirectUri}?evil=1` })).rejects.toThrow();
    const results = await Promise.allSettled([exchangeExtensionCode(f.exchange), exchangeExtensionCode(f.exchange)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ token: string }>;
    expect((await extensionSession(request('projects', winner.value.token))).userId).toBe(f.user.id);
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
test('extension CORS cannot grant identity and leaves embed policy separate', async () => {
    const handler = extensionHandler(async request => { await extensionSession(request); return Response.json({ ok: true }); });
    for (const origin of [undefined, `chrome-extension://${clientId}`, 'https://evil.test']) {
        const response = await handler(new Request('https://uier.io/api/extension/projects', { headers: origin ? { Origin: origin } : {} }));
        expect(response.ok).toBe(false);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin?.startsWith('chrome-extension:') ? origin : null);
    }
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
