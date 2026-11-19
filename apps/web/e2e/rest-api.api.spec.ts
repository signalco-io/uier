import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';
import type { AppContext } from '../src/lib/app/context';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { sha256Hex } from '../src/lib/app/tokens';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { memberId, type DbMember } from '../src/lib/app/model';
import { createProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { authenticateMcp, createMcpCredential, currentMcpConnection, listMcpCredentials, revokeMcpCredential } from '../src/lib/mcp/credentials';
import { restScopes } from '../src/lib/mcp/scopes';
import { proofStore } from '../src/lib/proofs/store';
import { authorizeProofThread } from '../src/lib/proofs/threadAccess';
import * as api from '../src/lib/rest/api';
import { apiRequestLimit, responses } from '../src/lib/rest/contract';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, getProjectComment, replyToProjectComment, setProjectCommentPrivate } from '../src/lib/review/comments';

const origin = 'https://reviewed.example';
const env = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET };
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'local-rest-api-secret-for-tests-only' }); });
test.afterAll(() => {
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

async function fixture() {
    const user = await findOrCreateUser(`rest-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Review site', urls: [origin] });
    const actor = (await memberActor(project, user.id))!;
    const create = (text: string) => createProjectComment(new Request(origin), project, actor,
        { origin, path: '/pricing', kind: 'feedback', position: { type: 'page' }, text });
    const grant = { name: 'Issue sync', projectIds: [project.id], scopes: [...restScopes], days: 30 };
    const { token, credential } = await createMcpCredential(context, grant, 'rest');
    return { context, project, actor, create, grant, token, credential };
}

const params = (projectId = '', feedbackId = '') => ({ params: Promise.resolve({ projectId, feedbackId }) });
function request(token = '', options: { query?: string; method?: string; body?: unknown; key?: string } = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (options.key) headers.set('Idempotency-Key', options.key);
    return new Request('https://uier.example/api/v1/projects' + (options.query ?? ''), {
        method: options.method ?? 'GET', headers, body: JSON.stringify(options.body)
    });
}

test('the REST grant only opens this API and its selected projects', async () => {
    const f = await fixture();
    const input = params(f.project.id);
    const projects = await api.listProjects(request(f.token), input);
    expect(projects.headers.get('cache-control')).toContain('no-store');
    expect(responses.listProjects.parse(await projects.json()).items).toEqual([{ id: f.project.id, name: f.project.name }]);
    const other = await createProject(f.context, { name: 'Other', urls: ['https://other.example'] });
    expect((await api.listFeedback(request(f.token), params(other.id))).status).toBe(404);
    const mcp = await createMcpCredential(f.context, f.grant);
    const proofs = await createMcpCredential(f.context, { ...f.grant, scopes: ['proofs:read'] });
    for (const token of ['', mcp.token, proofs.token]) {
        const denied = await api.listProjects(request(token), input);
        expect(denied.status).toBe(401);
        expect(denied.headers.get('www-authenticate')).toContain('Bearer');
    }
    await expect(authenticateMcp(request(f.token))).rejects.toThrow();
    const userId = f.context.user.id;
    await revokeMcpCredential(userId, f.credential.id);
    await revokeMcpCredential(userId, mcp.credential.id, 'rest');
    expect((await listMcpCredentials(userId)).map(c => c.id).sort()).toEqual([mcp.credential.id, proofs.credential.id].sort());
    expect((await listMcpCredentials(userId, 'rest')).map(c => c.id)).toEqual([f.credential.id]);
    expect(await currentMcpConnection(userId, f.credential.id, 'credential')).toBeNull();
    for (const scopes of [['feedback:read', 'tokens:create'], ['proofs:read'], ['feedback:read', 'proofs:read']]) {
        await expect(createMcpCredential(f.context, { ...f.grant, scopes }, 'rest')).rejects.toMatchObject({ status: 400 });
    }
    const store = getAppStore();
    const current = (await store.get(f.credential.pk, f.credential.id))!;
    await store.replace({ ...f.credential, expiresAt: new Date(0).toISOString() }, current.etag);
    expect((await api.listProjects(request(f.token), input)).status).toBe(401);
});

test('paging, private feedback and membership changes respect current permissions', async () => {
    const f = await fixture();
    const first = await f.create('First report'), second = await f.create('Second report');
    const hidden = await f.create('Private report');
    await setProjectCommentPrivate(f.project, f.actor, hidden.id, true);
    const user = await findOrCreateUser(`rest-reader-${randomUUID()}@example.test`);
    const member: DbMember = { ...f.context.member, id: memberId(user.id), userId: user.id, email: user.email, role: 'commenter', projects: [f.project.id] };
    const store = getAppStore();
    await store.create(member);
    const { token } = await createMcpCredential({ ...f.context, member, user, isAdmin: false }, { ...f.grant, scopes: ['feedback:read'] }, 'rest');
    const input = params(f.project.id, first.id);
    const list = async (suffix = '') => responses.listFeedback.parse(await (await api.listFeedback(request(token, { query: '?limit=1' + suffix }), input)).json());
    const one = await list(), two = await list('&before=' + encodeURIComponent(one.next!));
    expect([...one.items, ...two.items].map(item => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(two.next).toBeNull();
    expect((await api.listFeedback(request(token, { query: '?limit=101' }), input)).status).toBe(400);
    expect((await api.getFeedback(request(token), params(f.project.id, hidden.id))).status).toBe(404);
    expect((await api.reply(request(token, { method: 'POST', body: { text: 'Reply' }, key: randomUUID() }), input)).status).toBe(403);
    const saved = (await store.get(member.pk, member.id))!;
    await store.replace({ ...member, projects: [] }, saved.etag);
    expect((await api.getFeedback(request(token), input)).status).toBe(404);
    expect(await (await api.listProjects(request(token), input)).json()).toEqual({ items: [] });
});

test('retries commit one named reply and preserve subsequent workflow changes', async () => {
    const f = await fixture();
    const comment = await f.create('Report');
    const input = params(f.project.id, comment.id);
    const statuses = responses.listStatuses.parse(await (await api.listStatuses(request(f.token), input)).json());
    const done = statuses.items.find(status => status.category === 'done')!.id;
    const key = randomUUID();
    const reply = (text: string, key?: string) => api.reply(request(f.token, { method: 'POST', body: { text }, key }), input);
    expect((await reply('Acknowledged')).status).toBe(400);
    for (const result of await Promise.all([reply('Acknowledged', key), reply('Acknowledged', key)])) {
        expect(result.status).toBe(200);
        const thread = responses.reply.parse(await result.json());
        expect(thread.messages).toHaveLength(2);
        expect(thread.messages[1]).toMatchObject({ text: 'Acknowledged', author: expect.stringContaining('via Issue sync') });
    }
    expect((await reply('Different input', key)).status).toBe(409);
    const statusKey = randomUUID();
    const update = (statusId: string, key: string) => api.updateStatus(request(f.token, { method: 'PATCH', body: { statusId }, key }), input);
    expect(responses.updateStatus.parse(await (await update(done, statusKey)).json()).statusId).toBe(done);
    const open = statuses.items.find(status => status.category === 'open')!.id;
    await update(open, randomUUID());
    await update(done, statusKey);
    expect(responses.getFeedback.parse(await (await api.getFeedback(request(f.token), input)).json()).statusId).toBe(open);
    const archive = statuses.items.find(status => status.category === 'archive')!.id;
    const archiveKey = randomUUID();
    expect(responses.updateStatus.parse(await (await update(archive, archiveKey)).json())).toMatchObject({
        statusId: open, archivedAt: expect.any(String), archiveStatusId: archive
    });
    const listed = responses.listFeedback.parse(await (await api.listFeedback(request(f.token), params(f.project.id))).json());
    expect(listed.items).toContainEqual(expect.objectContaining({ id: comment.id, statusId: open, archivedAt: expect.any(String) }));
    const archiveChange = (body: object) => api.updateStatus(request(f.token, { method: 'PATCH', body, key: randomUUID() }), input);
    expect((await archiveChange({ archived: false, statusId: done })).status).toBe(400);
    expect(responses.updateStatus.parse(await (await archiveChange({ archived: false })).json())).toMatchObject({ statusId: open, archivedAt: null });
    await update(archive, archiveKey);
    expect(responses.getFeedback.parse(await (await api.getFeedback(request(f.token), input)).json())).toMatchObject({ statusId: open, archivedAt: null });
    expect(responses.updateStatus.parse(await (await archiveChange({ archived: true })).json())).toMatchObject({ statusId: open, archivedAt: expect.any(String) });
    await revokeMcpCredential(f.context.user.id, f.credential.id, 'rest');
    expect((await reply('Revoked', randomUUID())).status).toBe(401);
});

test('REST rate limits return a retry time and leave a second token usable', async () => {
    const f = await fixture();
    const read = (token: string) => api.listProjects(request(token), params());
    const now = Date.now();
    const clock = mock.method(Date, 'now', () => now);
    try {
        for (let i = 0; i < apiRequestLimit; i++) expect((await read(f.token)).status).toBe(200);
        const limited = await read(f.token);
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
        const other = await createMcpCredential(f.context, f.grant, 'rest');
        expect((await read(other.token)).status).toBe(200);
    } finally { clock.mock.restore(); }
});

test('website REST calls omit file threads and respect private website visibility even on write retries', async () => {
    const f = await fixture();
    const store = getAppStore();
    const proofs = proofStore(f.project.id);
    const assetId = randomUUID();
    const versionId = randomUUID().replaceAll('-', '');
    const now = new Date().toISOString();
    await store.create({ id: assetId, pk: proofs.pk, type: 'proof-asset', name: 'Proof fixture', collectionId: null,
        position: 0, currentVersionId: versionId, createdAt: now, updatedAt: now });
    await store.create({ id: versionId, pk: proofs.pk, type: 'proof-version', projectId: f.project.id, workspaceId: f.project.workspaceId,
        assetId, status: 'published', number: 1, createdAt: now, manifest: { format: 'image', surfaces: [] } });
    const cookie = `${cookieName(cookieNames.session)}=${sessionToken(f.context.user.id).token}`;
    const proofRequest = new Request(origin, { headers: { cookie } });
    const target = { projectId: f.project.id, assetId };
    await expect(authorizeProofThread(request(f.token), target, versionId)).rejects.toMatchObject({ status: 404 });
    const auth = await authorizeProofThread(proofRequest, target, versionId, true);
    const fileThread = (text: string, isPrivate: boolean) => createProjectComment(proofRequest, auth.project, auth.actor, {
        path: `/proof/${assetId}`, position: { type: 'page' }, kind: 'comment', private: isPrivate, text,
        assetTarget: { assetId, source: { versionId, anchor: { kind: 'general' } } }
    });
    const site = await f.create('Visible website feedback');
    const privateSite = await f.create('Private website feedback');
    const file = await fileThread('Shared proof feedback', false);
    const privateFile = await fileThread('Private proof feedback', true);
    const key = randomUUID();
    const text = 'Reply visible only on the proof';
    // Seed a real reply receipt for the exact key the REST adapter would use.
    await replyToProjectComment(proofRequest, auth.project, auth.actor, file.id,
        { text, idempotencyKey: sha256Hex(`rest:${f.credential.id}:${key}`) });

    const user = await findOrCreateUser(`rest-commenter-${randomUUID()}@example.test`);
    const member: DbMember = { ...f.context.member, id: memberId(user.id), userId: user.id, email: user.email,
        role: 'commenter', projects: [f.project.id] };
    await store.create(member);
    const { token: memberToken } = await createMcpCredential({ ...f.context, user, member, isAdmin: false }, f.grant, 'rest');
    const previous = params(f.project.id, privateSite.id);
    const websiteKey = randomUUID();
    const websiteReply = (replyText: string) => api.reply(request(memberToken, {
        method: 'POST', body: { text: replyText }, key: websiteKey
    }), previous);
    const statuses = responses.listStatuses.parse(await (await api.listStatuses(request(f.token), params(f.project.id))).json());
    const statusId = statuses.items.find(status => status.category === 'done')!.id;
    const openId = statuses.items.find(status => status.category === 'open')!.id;
    const websiteStatusKey = randomUUID();
    const websiteStatus = (id: string) => api.updateStatus(request(memberToken, {
        method: 'PATCH', body: { statusId: id }, key: websiteStatusKey
    }), previous);
    expect((await websiteReply('Reply before the thread goes private')).status).toBe(200);
    expect((await websiteStatus(statusId)).status).toBe(200);
    await setProjectCommentPrivate(f.project, f.actor, privateSite.id, true);
    expect((await websiteStatus(statusId)).status).toBe(404);
    expect((await websiteStatus(openId)).status).toBe(404);
    expect((await websiteReply('Reply before the thread goes private')).status).toBe(404);
    expect((await websiteReply('Changed retry after the thread became private')).status).toBe(404);
    const list = async (token: string) => {
        const response = await api.listFeedback(request(token, { query: `?limit=25&assetId=${assetId}` }), params(f.project.id));
        expect(response.status).toBe(200);
        const payload = responses.listFeedback.parse(await response.json());
        expect(payload.next).toBeNull();
        return payload.items.map(item => item.id).sort();
    };
    expect(await list(f.token)).toEqual([site.id, privateSite.id].sort());
    expect(await list(memberToken)).toEqual([site.id]);

    for (const [token, threadId] of [[f.token, file.id], [f.token, privateFile.id], [memberToken, privateSite.id]] as const) {
        const target = params(f.project.id, threadId);
        const missing = params(f.project.id, 'comment_missing');
        for (const call of [
            (input: ReturnType<typeof params>) => api.getFeedback(request(token), input),
            (input: ReturnType<typeof params>) => api.reply(request(token, { method: 'POST', body: { text }, key: randomUUID() }), input),
            (input: ReturnType<typeof params>) => api.updateStatus(request(token, { method: 'PATCH', body: { statusId }, key }), input)
        ]) {
            const denied = await call(target);
            expect(denied.status).toBe(404);
            expect(await denied.json()).toEqual(await (await call(missing)).json());
        }
    }
    expect((await api.reply(request(f.token, { method: 'POST', body: { text }, key }), params(f.project.id, file.id))).status).toBe(404);
    expect((await getProjectComment(auth.project, auth.actor, file.id))?.thread.items.map(item => item.text)).toEqual(['Shared proof feedback', text]);
    expect((await getProjectComment(auth.project, auth.actor, privateFile.id))?.thread.items).toHaveLength(1);
    expect((await getProjectComment(f.project, f.actor, privateSite.id))?.thread.items).toHaveLength(2);
});
