import { runIntegrationWorker } from '../src/lib/integrations/worker';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { memberId, workspacePk, type DbMember, type DbProject } from '../src/lib/app/model';
import { getAppStore, updateDoc, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { createWorkspace, ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { deleteProject } from '../src/lib/app/projectDeletion';
import { transferProject } from '../src/lib/app/projectTransfer';
import type { AppContext } from '../src/lib/app/context';
import { beginNotionProjectsConnect } from '../src/lib/integrations/notion/projects/connection';
import { finishNotionConnect, NotionSession } from '../src/lib/integrations/notion/connection';
import { NotionClient, type JsonObject } from '../src/lib/integrations/notion/client';
import { getNotionProjectsSettings, loadNotionProjectSchema, loadNotionProjectSources, saveNotionProjectMapping, stopNotionProjects } from '../src/lib/integrations/notion/projects/settings';
import { makeNotionProjectManual, notionProjectRowKey, syncNotionProjects } from '../src/lib/integrations/notion/projects/sync';
import { notionProjectsConnectionId, notionProjectsGrantId, type NotionProjectsConnection, type NotionProjectRow } from '../src/lib/integrations/notion/projects/model';
import type { NotionGrant } from '../src/lib/integrations/notion/model';
import { projectFromNotionRow, validateProjectMapping } from '../src/lib/integrations/notion/projects/mapping';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment } from '../src/lib/review/comments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProject, findReviewProject } from '../src/lib/app/projects';
import { sha256Hex } from '../src/lib/app/tokens';
import { startNotionStub } from './support/notionStub';

let stub: Awaited<ReturnType<typeof startNotionStub>>;
const created: { store: AppStore; pk: string }[] = [];
const envKeys = ['UIER_LOCAL', 'UIER_COMMENTS_SECRET', 'NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET', 'NOTION_TOKEN_KEY', 'NOTION_REQUEST_INTERVAL_MS', 'NOTION_API_BASE_URL', 'NOTION_OAUTH_AUTHORIZE_URL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const baseUrl = 'https://uier.io';
const mapping = { urls: ['link', 'page', 'uid', 'multi'], name: 'title', status: 'status', done: ['Done'] };
test.beforeAll(async () => {
    Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'notion-projects-local-test-secret-at-least-32-characters', NOTION_CLIENT_ID: 'notion-test',
        NOTION_CLIENT_SECRET: 'notion-test-secret', NOTION_TOKEN_KEY: randomBytes(32).toString('base64'), NOTION_REQUEST_INTERVAL_MS: '0' });
    stub = await startNotionStub(); process.env.NOTION_API_BASE_URL = stub.url; process.env.NOTION_OAUTH_AUTHORIZE_URL = `${stub.url}/v1/oauth/authorize`;
});
test.afterEach(async () => {
    for (const { store, pk } of created.splice(0))
        await updateDoc<NotionProjectsConnection>(pk, notionProjectsConnectionId, value => ({ ...value, enabled: false }), store);
});
test.afterAll(async () => {
    await stub?.close();
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function fixture(options: { connect?: boolean; notionWorkspaceId?: string; dataSourceId?: string } = {}) {
    const user = await findOrCreateUser(`notion-projects-${randomUUID()}@example.com`); const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!; const store = getAppStore();
    created.push({ store, pk: workspace.pk });
    const context: AppContext = { user, workspace, member, isAdmin: true, memberships: [{ workspace, member }] };
    const notionWorkspaceId = options.notionWorkspaceId ?? randomUUID(); const botId = randomUUID();
    const source = options.dataSourceId ? { id: options.dataSourceId } : stub.dataSource(notionWorkspaceId, 'Projects');
    stub.sources.get(source.id)!.properties.Multi = { id: 'multi', name: 'Addresses', type: 'multi_select', multi_select: { options: [] } };
    const scoped: AppStore = { ...store, query: query => store.query(query.type === 'notion-projects-connection' ? { ...query, pk: workspace.pk } : query) };
    const connect = async (error?: string) => {
        const url = new URL(await beginNotionProjectsConnect({ userId: user.id, workspaceId: workspace.id, baseUrl }));
        const result = await finishNotionConnect({ userId: user.id, state: url.searchParams.get('state'), baseUrl,
            ...(error ? { error } : { code: stub.code(notionWorkspaceId, botId) }) });
        return { result, state: url.searchParams.get('state') };
    };
    if (options.connect !== false) {
        expect((await connect()).result.status).toBe('connected');
        await saveNotionProjectMapping(workspace.id, user.id, source.id, mapping);
    }
    const due = () => updateDoc<NotionProjectsConnection>(workspace.pk, notionProjectsConnectionId, value => ({ ...value, nextAttemptAt: '2000-01-01T00:00:00.000Z' }));
    const sync = async (services: { store?: AppStore; client?: NotionClient } = {}, maxCalls = 20) => {
        await due(); return syncNotionProjects({ deadline: Date.now() + 15_000, maxCalls }, { store: scoped, ...services });
    };
    const projects = () => store.query<DbProject>({ type: 'project', pk: workspace.pk });
    const connection = async () => (await store.get<NotionProjectsConnection>(workspace.pk, notionProjectsConnectionId))!.doc;
    return { user, member, workspace, context, store, scoped, source, notionWorkspaceId, botId, connect, sync, due, projects, connection };
}
function row(f: Awaited<ReturnType<typeof fixture>>, name = 'Site', url = 'https://one.example', extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    const page: Record<string, any> = { object: 'page', id, parent: { type: 'data_source_id', data_source_id: f.source.id }, in_trash: false,
        properties: { title: { id: 'title', type: 'title', title: [{ plain_text: name }] }, link: { id: 'link', type: 'url', url },
            page: { id: 'page', type: 'url', url: null }, uid: { id: 'uid', type: 'rich_text', rich_text: [] },
            multi: { id: 'multi', type: 'multi_select', multi_select: [] }, status: { id: 'status', type: 'status', status: { name: 'Open' } }, ...extra } };
    stub.pages.set(id, page); return page;
}

test('workspace OAuth is bound, single-use, encrypted and independent of project connections', async () => {
    const f = await fixture({ connect: false });
    const url = new URL(await beginNotionProjectsConnect({ userId: f.user.id, workspaceId: f.workspace.id, baseUrl }));
    expect(url.searchParams.get('redirect_uri')).toBe('https://uier.io/app/notion/callback');
    expect(url.searchParams.get('state')).not.toContain(f.workspace.id);
    await expect(finishNotionConnect({ userId: 'other', state: url.searchParams.get('state'), code: 'unused', baseUrl })).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    expect((await finishNotionConnect({ userId: f.user.id, state: url.searchParams.get('state'), code: stub.code(f.notionWorkspaceId, f.botId), baseUrl })).status).toBe('connected');
    await expect(finishNotionConnect({ userId: f.user.id, state: url.searchParams.get('state'), code: 'unused', baseUrl })).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    const grant = (await f.store.get<NotionGrant>(f.workspace.pk, notionProjectsGrantId))!.doc;
    expect(grant.tokens?.access).toMatch(/^v1\.k1\./); expect(JSON.stringify(grant)).not.toContain('access-');
    expect((await f.connect('access_denied')).result.status).toBe('denied');
    expect((await f.store.get<NotionGrant>(f.workspace.pk, grant.id))!.doc.generation).toBe(grant.generation);
    expect(await loadNotionProjectSources(f.workspace.id, f.user.id)).toContainEqual({ id: f.source.id, name: 'Projects' });
    const view = await getNotionProjectsSettings(f.workspace.id, f.user.id);
    expect(JSON.stringify(view)).not.toMatch(/tokens|grantId|botId|connectedBy|v1\.k1/);
    expect(await f.store.query({ type: 'notion-connection', pk: f.workspace.pk })).toHaveLength(0);
});

test('URL, text, multi-select and several columns converge; name/status edits and reopening retain feedback', async () => {
    const f = await fixture(); const remote = row(f, 'Company');
    remote.properties.uid.rich_text = [{ plain_text: 'staging.example, https://preview.example\nhttps://one.example' }];
    remote.properties.multi.multi_select = [{ name: 'https://test.example' }];
    expect((await f.sync()).deferred).toBe(0);
    const [project] = await f.projects(); expect(project).toMatchObject({ name: 'Company', access: 'invited', status: 'active', automaticallyManaged: { provider: 'notion' } });
    expect(project!.urls).toEqual(['https://one.example', 'https://staging.example', 'https://preview.example', 'https://test.example']);
    const actor = (await memberActor(project!, f.user.id))!;
    const comment = await createProjectComment(new Request('https://uier.io'), project!, actor, { text: 'Keep this feedback', origin: project!.urls[0]!, path: '/', kind: 'feedback', position: { type: 'page' } });
    remote.properties.title.title = [{ plain_text: 'Renamed' }]; remote.properties.status.status.name = 'Done';
    await Promise.all([f.sync(), f.sync()]);
    expect(await f.projects()).toHaveLength(1); expect((await f.projects())[0]).toMatchObject({ id: project!.id, name: 'Renamed', status: 'done' });
    remote.properties.status.status.name = 'Open'; await f.sync(); expect((await f.projects())[0]!.status).toBe('active');
    expect((await getCommentsStore().get(comment.domain, comment.id))!.comment.thread.items[0]!.text).toBe('Keep this feedback');
    expect(stub.calls.filter(call => call.path !== '/v1/oauth/token').every(call => call.method === 'GET' || (call.method === 'POST' && (call.path === '/v1/search' || call.path.endsWith('/query'))))).toBe(true);
});

test('public row and workspace identifiers cannot derive a working project review code', async () => {
    const f = await fixture(); const remote = row(f);
    const rowKey = notionProjectRowKey(f.source.id, remote.id);
    const publicGuess = (BigInt(`0x${sha256Hex(JSON.stringify([f.workspace.id, rowKey]))}`) % (36n ** 12n)).toString(36).padStart(12, '0');
    await f.sync(); const project = (await f.projects())[0]!;
    expect(project.id).toMatch(/^[a-z0-9]{12}$/);
    expect(project.id).not.toBe(publicGuess);
    expect(await findReviewProject(publicGuess)).toBeNull();
    expect((await findReviewProject(project.id))?.id).toBe(project.id);
    await f.sync();
    expect(await f.projects()).toHaveLength(1);
    expect((await f.projects())[0]!.id).toBe(project.id);
});

test('an existing row receipt retains its claimed project code when allocation changes', async () => {
    const f = await fixture(); const remote = row(f, 'Updated name');
    const project = await createProject(f.context, { name: 'Earlier name', urls: ['https://earlier.example'] });
    const rowKey = notionProjectRowKey(f.source.id, remote.id);
    await updateDoc<DbProject>(project.pk, project.id, value => ({ ...value,
        automaticallyManaged: { provider: 'notion', connectionId: notionProjectsConnectionId, rowKey } }));
    expect(await f.store.create<NotionProjectRow>({ type: 'notion-project-row', pk: f.workspace.pk, id: rowKey,
        workspaceId: f.workspace.id, connectionId: notionProjectsConnectionId, dataSourceId: f.source.id, rowId: remote.id, projectId: project.id })).toBe(true);
    await f.sync(); await f.sync();
    expect(await f.projects()).toMatchObject([{ id: project.id, publicId: project.publicId, name: 'Updated name' }]);
    expect((await findReviewProject(project.id))?.id).toBe(project.id);
});

test('manual override, deletion, transfer and missing or trashed rows never recreate or change projects', async () => {
    const f = await fixture(); const manual = row(f, 'Manual'); const deleted = row(f, 'Deleted'); const transferred = row(f, 'Transferred');
    await f.sync(); const projects = await f.projects();
    const byName = (name: string) => projects.find(project => project.name === name)!;
    await makeNotionProjectManual(f.workspace.id, byName('Manual').id, f.user.id);
    await deleteProject(f.context, byName('Deleted').id, 'Deleted');
    const target = await createWorkspace(f.user, 'Target');
    await transferProject(f.context, byName('Transferred').id, target.id, 'Transferred');
    manual.properties.title.title = [{ plain_text: 'Do not overwrite' }]; deleted.properties.status.status.name = 'Done'; transferred.properties.status.status.name = 'Done';
    await f.sync();
    expect(await f.projects()).toMatchObject([{ id: byName('Manual').id, name: 'Manual', status: 'active' }]);
    expect((await f.projects())[0]!.automaticallyManaged).toBeUndefined();
    const moved = (await f.store.get<DbProject>(target.pk, byName('Transferred').id))!.doc;
    expect(moved.status).toBe('active'); expect(moved.automaticallyManaged).toBeUndefined();
    expect(await f.store.query<NotionProjectRow>({ type: 'notion-project-row', pk: f.workspace.pk })).toHaveLength(3);
    manual.in_trash = true; stub.pages.delete(deleted.id); await f.sync(); expect(await f.projects()).toHaveLength(1);
});

test('paged polling resumes after its call budget; invalid rows do not block later rows', async () => {
    const f = await fixture();
    for (let i = 0; i < 57; i++) row(f, `Site ${i}`, i === 2 ? 'javascript:alert(1)' : `https://site-${i}.example`);
    await f.sync({}, 2); expect(await f.projects()).toHaveLength(24); expect((await f.connection()).cursor).toBe('25');
    await f.sync({}, 2); expect(await f.projects()).toHaveLength(49); expect((await f.connection()).cursor).toBe('50');
    await f.sync({}, 2); expect(await f.projects()).toHaveLength(56); expect((await f.connection()).cursor).toBeUndefined();
    expect((await f.connection()).lastSyncedAt).toBeTruthy(); expect((await f.connection()).skippedRows).toBe(1);
    await updateDoc<NotionProjectsConnection>(f.workspace.pk, notionProjectsConnectionId, value => ({ ...value, cursor: 'expired' }));
    stub.fault({ method: 'POST', path: `/v1/data_sources/${f.source.id}/query`, status: 400, code: 'validation_error' });
    await f.sync(); expect((await f.connection()).cursor).toBeUndefined();
    await f.sync(); expect(await f.projects()).toHaveLength(56);
});

test('mapping supports optional names, text/select/checkbox completion and rejects incompatible or duplicate fields', async () => {
    const f = await fixture(); const { schema } = await loadNotionProjectSchema(f.workspace.id, f.user.id, f.source.id);
    await expect(saveNotionProjectMapping(f.workspace.id, f.user.id, f.source.id, { ...mapping, name: 'link' })).rejects.toMatchObject({ code: 'mapping_invalid' });
    expect(() => validateProjectMapping({ ...mapping, urls: ['link', 'link'] }, schema)).toThrow();
    const remote = row(f, '', 'https://www.fallback.example');
    expect(projectFromNotionRow(remote, { urls: ['link'], status: 'status', done: ['Done'] }, schema)?.name).toBe('fallback.example');
    for (const [type, value, done] of [['rich_text', [{ plain_text: 'Finished' }], 'Finished'], ['select', { name: 'Finished' }, 'Finished'], ['checkbox', true, 'true']] as const) {
        const customSchema = { ...schema, finish: { name: 'Finished', type, options: type === 'select' ? ['Finished'] : undefined } };
        const customMapping = validateProjectMapping({ urls: ['link'], status: 'finish', done: [done] }, customSchema);
        expect(projectFromNotionRow({ ...remote, properties: { ...remote.properties, finish: { type, [type]: value } } }, customMapping, customSchema)?.status).toBe('done');
    }
});

test('a disconnect while querying fences every import and remains available without provider configuration', async () => {
    const f = await fixture(); row(f);
    class DisconnectingClient extends NotionClient {
        override async request<T = JsonObject>(...args: Parameters<NotionClient['request']>): Promise<T> {
            const result = await super.request<T>(...args);
            if (args[1].endsWith('/query')) await stopNotionProjects(f.workspace.id, f.user.id, true);
            return result;
        }
    }
    await f.sync({ client: new DisconnectingClient() }); expect(await f.projects()).toHaveLength(0);
    expect((await f.store.get<NotionGrant>(f.workspace.pk, notionProjectsGrantId))!.doc.tokens).toBeUndefined();
    const saved = process.env.NOTION_TOKEN_KEY; delete process.env.NOTION_TOKEN_KEY;
    try { await stopNotionProjects(f.workspace.id, f.user.id, false); } finally { process.env.NOTION_TOKEN_KEY = saved; }
});

test('admin removal, foreign workspaces and preview deployments cannot use workspace grants', async () => {
    const f = await fixture(); row(f);
    const other = await fixture();
    await expect(makeNotionProjectManual(f.workspace.id, '000000000000', other.user.id)).rejects.toThrow();
    await expect(getNotionProjectsSettings(f.workspace.id, other.user.id)).rejects.toThrow();
    const member = (await f.store.get<DbMember>(f.workspace.pk, memberId(f.user.id)))!;
    await f.store.replace({ ...member.doc, role: 'commenter' }, member.etag);
    await expect(loadNotionProjectSources(f.workspace.id, f.user.id)).rejects.toThrow();
    await f.sync(); expect(await f.projects()).toHaveLength(0);
    const old = process.env.VERCEL_ENV; process.env.VERCEL_ENV = 'preview';
    try { await expect(new NotionSession(await other.connection(), { store: other.store }).grant()).rejects.toMatchObject({ code: 'not_configured' }); }
    finally { if (old === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = old; }
});

test('lost local commit responses replay safely, and a manual override wins an in-flight update', async () => {
    const f = await fixture(); const remote = row(f);
    let lost = false;
    const unreliable: AppStore = { ...f.scoped, async transact(operations) {
        const saved = await f.store.transact(operations);
        if (!lost && saved && operations.some(op => op.kind === 'create' && op.doc.type === 'project')) { lost = true; throw new Error('Lost response'); }
        return saved;
    } };
    await f.sync({ store: unreliable }); await f.sync(); expect(await f.projects()).toHaveLength(1);
    const project = (await f.projects())[0]!; let manual = false;
    remote.properties.title.title = [{ plain_text: 'Changed' }];
    const racing: AppStore = { ...f.scoped, async transact(operations) {
        if (!manual && operations.some(op => op.kind === 'replace' && op.doc.type === 'project')) {
            manual = true; await makeNotionProjectManual(f.workspace.id, project.id, f.user.id);
        }
        return f.store.transact(operations);
    } };
    await f.sync({ store: racing }); expect((await f.projects())[0]).toMatchObject({ id: project.id, name: 'Site' });
    expect((await f.projects())[0]!.automaticallyManaged).toBeUndefined();
});

test('rate limits and schema errors retry safely; refresh and the same database in another workspace stay isolated', async () => {
    const f = await fixture(); row(f);
    stub.expireAccess(); await f.sync(); expect(await f.projects()).toHaveLength(1);
    const other = await fixture({ notionWorkspaceId: f.notionWorkspaceId, dataSourceId: f.source.id }); await other.sync();
    expect(await other.projects()).toHaveLength(1); expect((await other.projects())[0]!.id).not.toBe((await f.projects())[0]!.id);
    stub.sources.get(f.source.id)!.properties.Status.status.options = [{ name: 'Open' }];
    await f.sync(); expect((await f.connection()).statusCode).toBe('mapping_invalid'); expect(await f.projects()).toHaveLength(1);
    stub.sources.get(f.source.id)!.properties.Status.status.options.push({ name: 'Done' });
    await f.sync(); expect((await f.connection()).statusCode).toBeUndefined();
    stub.fault({ method: 'POST', path: `/v1/data_sources/${f.source.id}/query`, status: 429, code: 'rate_limited', retryAfter: 60 });
    await f.sync(); expect((await f.connection()).statusCode).toBe('rate_limited');
    const calls = stub.calls.length; await f.sync(); expect(stub.calls).toHaveLength(calls); expect(await f.projects()).toHaveLength(1);
});


test('the scheduled integration worker imports workspace projects within its Notion call allowance', async () => {
    const f = await fixture(); row(f);
    // A full API worker also retains other specs' unfinished sources and ledgers. This turn owns only this workspace.
    const store: AppStore = { ...f.scoped, query: query => f.store.query({ ...query, pk: f.workspace.pk }) };
    // Provider turns divide the remaining budget by four, including fractional milliseconds.
    const workerNow = Date.now();
    const result = await runIntegrationWorker(baseUrl, { store, comments: { ...getCommentsStore(), listSyncPending: async () => [] },
        now: () => workerNow, budgetMs: 60_001,
        adapters: [{ provider: 'notion', maxCalls: 2, isConfigured: () => true, deliver: async () => ({ status: 'accepted' }) }] });
    expect({ calls: result.providers[0]!.calls, statusCode: (await f.connection()).statusCode }).toEqual({ calls: 2, statusCode: undefined });
    expect(await f.projects()).toHaveLength(1);
});

test('removing the admin during OAuth never installs an unowned workspace credential', async () => {
    const f = await fixture({ connect: false });
    const url = new URL(await beginNotionProjectsConnect({ userId: f.user.id, workspaceId: f.workspace.id, baseUrl }));
    class RemovingClient extends NotionClient {
        override async oauth(...args: Parameters<NotionClient['oauth']>) {
            const token = await super.oauth(...args);
            await f.store.delete(f.workspace.pk, memberId(f.user.id)); return token;
        }
    }
    const result = await finishNotionConnect({ userId: f.user.id, state: url.searchParams.get('state'), code: stub.code(f.notionWorkspaceId, f.botId), baseUrl }, { client: new RemovingClient() });
    expect(result.status).toBe('failed');
    expect(await f.store.get(f.workspace.pk, notionProjectsGrantId)).toBeNull();
    expect(await f.store.get(f.workspace.pk, notionProjectsConnectionId)).toBeNull();
});
