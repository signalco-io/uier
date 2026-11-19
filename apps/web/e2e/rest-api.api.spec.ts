import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';
import type { AppContext } from '../src/lib/app/context';
import { memberId, type DbMember } from '../src/lib/app/model';
import { createProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { authenticateMcp, createMcpCredential, listMcpCredentials, revokeMcpCredential } from '../src/lib/mcp/credentials';
import { restScopes } from '../src/lib/mcp/scopes';
import * as api from '../src/lib/rest/api';
import { apiRequestLimit, responses } from '../src/lib/rest/contract';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, setProjectCommentPrivate } from '../src/lib/review/comments';

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
    for (const token of ['', mcp.token]) {
        const denied = await api.listProjects(request(token), input);
        expect(denied.status).toBe(401);
        expect(denied.headers.get('www-authenticate')).toContain('Bearer');
    }
    await expect(authenticateMcp(request(f.token))).rejects.toThrow();
    expect((await listMcpCredentials(f.context.user.id)).map(c => c.id)).toEqual([mcp.credential.id]);
    await expect(createMcpCredential(f.context, { ...f.grant, scopes: ['feedback:read', 'tokens:create'] }, 'rest')).rejects.toThrow();
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
