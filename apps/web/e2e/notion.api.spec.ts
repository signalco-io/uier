import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type AppDoc, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore, updateDoc, type AppStore, type DocQuery } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, deleteProjectCommentItem, editProjectCommentItem, removeProjectComment, replyToProjectComment,
    replaceProjectScreenshot, setProjectCommentPrivate, setProjectCommentResolved } from '../src/lib/review/comments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import type { DbComment } from '../src/lib/db/schema';
import { discoverThreadIntegrationSync, enqueueIntegrationBackfill, enqueueIntegrationSync, integrationSyncId } from '../src/lib/integrations/discovery';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import type { IntegrationAttempt, IntegrationSync } from '../src/lib/integrations/model';
import { createNotionAdapter } from '../src/lib/integrations/notion/adapter';
import { NotionApiError, NotionClient, pageProperty, richText } from '../src/lib/integrations/notion/client';
import { beginNotionConnect, disconnectNotion, finishNotionConnect, notionConnectionId, notionGrantId } from '../src/lib/integrations/notion/connection';
import { getNotionSettings, loadNotionDataSources, loadNotionSchema, saveNotionMapping } from '../src/lib/integrations/notion/settings';
import { probeNotionConnections } from '../src/lib/integrations/notion/probe';
import type { NotionConnection, NotionGrant, NotionState } from '../src/lib/integrations/notion/model';
import { pngImage, jpegImage } from './support/images';
import { startNotionStub } from './support/notionStub';

let stub: Awaited<ReturnType<typeof startNotionStub>>;
const client = new NotionClient();
const adapter = createNotionAdapter({ client });
const baseUrl = 'https://uier.io';
const request = new Request('http://127.0.0.1/api/review');
const old = '2026-01-01T00:00:00.000Z';

test.beforeAll(async () => {
    process.env.UIER_LOCAL = '1'; process.env.NOTION_CLIENT_ID = 'notion-test-client'; process.env.NOTION_CLIENT_SECRET = 'notion-test-secret';
    process.env.NOTION_TOKEN_KEY = randomBytes(32).toString('base64'); process.env.NOTION_REQUEST_INTERVAL_MS = '0';
    stub = await startNotionStub(); process.env.NOTION_API_BASE_URL = stub.url; process.env.NOTION_OAUTH_AUTHORIZE_URL = `${stub.url}/v1/oauth/authorize`;
});
test.afterAll(async () => { await stub?.close(); });

async function fixture(options: { workspaceId?: string; botId?: string; connect?: boolean; noRefresh?: boolean } = {}) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12); const owner = await findOrCreateUser(`notion-${id}@example.com`); const workspaceId = `w_${owner.id}`;
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Notion ${id}`, urls: ['https://reviewed.example'],
        status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
    const store = getAppStore(); await store.create(project);
    await store.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    await store.create<DbMember>({ type: 'member', id: memberId(owner.id), pk: project.pk, workspaceId, userId: owner.id,
        email: owner.email, role: 'admin', projects: 'all', createdAt: old });
    const actor = (await memberActor(project, owner.id))!;
    const notionWorkspaceId = options.workspaceId ?? randomUUID(); const botId = options.botId ?? randomUUID();
    const dataSource = stub.dataSource(notionWorkspaceId);
    if (options.connect !== false) {
        const url = new URL(await beginNotionConnect({ userId: owner.id, workspaceId, projectId: id, baseUrl }));
        const result = await finishNotionConnect({ userId: owner.id, state: url.searchParams.get('state'), baseUrl,
            code: stub.code(notionWorkspaceId, botId, { noRefresh: options.noRefresh }) });
        expect(result.status).toBe('connected');
        const schema = await loadNotionSchema(project, owner.id, dataSource.id);
        await saveNotionMapping(project, owner.id, { dataSourceId: dataSource.id, mapping: schema.mapping });
    }
    return { project, owner, actor, notionWorkspaceId, botId, dataSource, store };
}
async function source(f: Awaited<ReturnType<typeof fixture>>, options: { text?: string; image?: string } = {}) {
    return createProjectComment(request, f.project, f.actor, { text: options.text ?? 'Original feedback', origin: 'https://reviewed.example', path: '/pricing',
        kind: 'feedback', position: { type: 'page' }, ...(options.image ? { screenshot: parseScreenshot(options.image) as ParsedScreenshot } : {}) });
}
async function ledger(f: Awaited<ReturnType<typeof fixture>>, commentId: string) {
    return (await f.store.get<IntegrationSync>(`notion:${f.project.id}`, integrationSyncId('notion', notionConnectionId(f.project.id), f.project.id, commentId)))!.doc;
}
async function sync(f: Awaited<ReturnType<typeof fixture>>, comment: DbComment, options: { enqueue?: boolean; offset?: number; maxCalls?: number } = {}) {
    const currentProject = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc;
    const current = (await getCommentsStore().get(comment.domain, comment.id))?.comment;
    if (options.enqueue !== false && current) await enqueueIntegrationSync(currentProject, 'notion', notionConnectionId(f.project.id), comment.id, current.syncVersion ?? 0,
        { cleanup: current.private });
    const queued = await ledger(f, comment.id);
    await processIntegrationDelivery(queued, baseUrl, adapter, { now: () => Date.now() + (options.offset ?? 0), maxCalls: options.maxCalls ?? 150 });
    return ledger(f, comment.id);
}
function page(ledger: IntegrationSync) { return stub.pages.get((ledger.state as NotionState).page!.id)!; }
function texts(ledger: IntegrationSync) {
    const p = page(ledger); return p.children.map((id: string) => stub.blocks.get(id)!).filter((block: Record<string, any>) => !block.in_trash).map((block: Record<string, any>) => richText(block[block.type]?.rich_text)).join('\n');
}

test('Notion OAuth is user bound, single use and denial does not replace a working grant', async () => {
    const f = await fixture({ connect: false });
    const url = new URL(await beginNotionConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect(url.searchParams.get('state')).not.toContain(f.project.id);
    await expect(finishNotionConnect({ userId: 'foreign-user', state: url.searchParams.get('state'), code: 'unused', baseUrl })).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    const result = await finishNotionConnect({ userId: f.owner.id, state: url.searchParams.get('state'), code: stub.code(f.notionWorkspaceId, f.botId), baseUrl });
    expect(result).toMatchObject({ workspaceId: f.project.workspaceId, projectId: f.project.id, status: 'connected' });
    await expect(finishNotionConnect({ userId: f.owner.id, state: url.searchParams.get('state'), code: 'unused', baseUrl })).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    const before = (await f.store.get<NotionGrant>(f.project.pk, notionGrantId(f.project.id)))!.doc;
    expect(JSON.stringify(before)).not.toContain('access-'); expect(before.tokens?.access).toMatch(/^v1\.k1\./);
    const denied = new URL(await beginNotionConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect((await finishNotionConnect({ userId: f.owner.id, state: denied.searchParams.get('state'), error: 'access_denied', baseUrl })).status).toBe('denied');
    expect((await f.store.get<NotionGrant>(f.project.pk, before.id))!.doc.generation).toBe(before.generation);
});

test('database discovery, id-based mapping and safe settings expose no credentials', async () => {
    const f = await fixture();
    expect(await loadNotionDataSources(f.project, f.owner.id)).toContainEqual({ id: f.dataSource.id, databaseId: f.dataSource.databaseId, name: 'Feedback' });
    const settings = await getNotionSettings(f.project, f.owner.id);
    expect(settings).toMatchObject({ configured: true, enabled: true, status: 'connected', dataSourceId: f.dataSource.id });
    expect(JSON.stringify(settings)).not.toMatch(/tokens|refresh|botId|connectedBy|keyId|v1\.k1/);
    const schema = await loadNotionSchema(f.project, f.owner.id, f.dataSource.id);
    await expect(saveNotionMapping(f.project, f.owner.id, { dataSourceId: f.dataSource.id, mapping: { ...schema.mapping, uierId: schema.mapping.title } })).rejects.toMatchObject({ code: 'mapping_invalid' });
    await expect(saveNotionMapping(f.project, f.owner.id, { dataSourceId: f.dataSource.id, mapping: { ...schema.mapping, status: { property: 'status', type: 'status', open: 'Missing', done: 'Done' } } })).rejects.toMatchObject({ code: 'mapping_invalid' });
});

test('full current state, property updates, discussion edits and deleted replies converge to one page', async () => {
    const f = await fixture(); const comment = await source(f);
    let state = await sync(f, comment);
    expect(state.status).toBe('accepted'); expect(texts(state)).toContain('Original feedback');
    expect(richText(pageProperty(page(state), 'uid').rich_text)).toBe(comment.id);
    const pageId = page(state).id;
    await replyToProjectComment(request, f.project, f.actor, comment.id, { text: 'A reply' });
    await setProjectCommentResolved(f.project, f.actor, comment.id, true);
    state = await sync(f, comment);
    expect(page(state).id).toBe(pageId); expect(texts(state)).toContain('A reply'); expect(page(state).properties.status.status.name).toBe('Done');
    const current = (await getCommentsStore().get(comment.domain, comment.id))!.comment;
    const reply = current.thread.items[1]!;
    await editProjectCommentItem(f.project, f.actor, comment.id, reply.id, { expectedText: 'A reply', text: 'Changed reply' });
    state = await sync(f, comment); expect(texts(state)).toContain('Changed reply'); expect(texts(state)).not.toContain('A reply');
    await deleteProjectCommentItem(f.project, f.actor, comment.id, reply.id);
    state = await sync(f, comment); expect(texts(state)).not.toContain('Changed reply');
    expect(stub.calls.filter(call => call.method === 'PATCH' && call.path.endsWith('/query'))).toHaveLength(0);
    expect(stub.calls.some(call => call.path === `/v1/data_sources/${f.dataSource.id}/query` && call.method === 'POST')).toBe(true);
    expect(JSON.stringify(state)).not.toContain('Original feedback'); expect(JSON.stringify(state)).not.toContain('Changed reply');
});

test('lost create and append responses reconcile without duplicate pages or discussion blocks', async () => {
    const f = await fixture(); const comment = await source(f);
    stub.fault({ method: 'POST', path: '/v1/pages', afterCommit: true });
    let state = await sync(f, comment); expect(state.status).toBe('waiting'); expect(state.attempt?.step).toBe('create_page');
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    const pageId = page(state).id;
    await replyToProjectComment(request, f.project, f.actor, comment.id, { text: 'One durable reply' });
    stub.fault({ method: 'PATCH', path: `/v1/blocks/${pageId}/children`, afterCommit: true });
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('waiting'); expect(state.attempt?.step).toBe('append_blocks');
    state = await sync(f, comment, { offset: 240_000 }); expect(state.status).toBe('accepted');
    expect([...stub.pages.values()].filter(p => richText(pageProperty(p, 'uid').rich_text) === comment.id)).toHaveLength(1);
    expect(texts(state).split('One durable reply')).toHaveLength(2);
});

test('private transitions scrub and trash without exporting private text, and visible threads rebuild', async () => {
    const f = await fixture(); const comment = await source(f);
    await sync(f, comment); await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    await editProjectCommentItem(f.project, f.actor, comment.id, comment.thread.items[0]!.id, { expectedText: 'Original feedback', text: 'Private secret never sent' });
    stub.calls.length = 0;
    let state = await sync(f, comment); expect(state.status).toBe('suppressed'); expect(page(state).in_trash).toBe(true);
    expect(page(state).children).toHaveLength(0); expect(richText(page(state).properties.title.title)).toBe('Removed from uier');
    expect(JSON.stringify(stub.calls)).not.toContain('Private secret never sent');
    await setProjectCommentPrivate(f.project, f.actor, comment.id, false);
    state = await sync(f, comment); expect(state.status).toBe('accepted'); expect(page(state).in_trash).toBe(false); expect(texts(state)).toContain('Private secret never sent');
});

test('hard deletion survives shared tombstone removal and clears the recorded page', async () => {
    const f = await fixture(); const comment = await source(f); await sync(f, comment);
    await removeProjectComment(f.project, f.actor, comment.id);
    const tombstone = (await getCommentsStore().listSyncPending()).find(value => 'type' in value && value.type === 'tombstone' && value.commentId === comment.id)!;
    const project = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc;
    expect(await discoverThreadIntegrationSync(project, tombstone, { adapters: [adapter] })).toBe(true);
    expect((await getCommentsStore().listSyncPending()).some(value => 'type' in value && value.type === 'tombstone' && value.commentId === comment.id)).toBe(false);
    const state = await sync(f, comment, { enqueue: false }); expect(state.tombstoned).toBe(true); expect(page(state).in_trash).toBe(true); expect(page(state).children).toHaveLength(0);
});

test('screenshot upload sends once per revision, attaches bytes safely and recovers a lost send response', async () => {
    const f = await fixture(); const comment = await source(f, { image: pngImage });
    stub.fault({ method: 'POST', path: /\/v1\/file_uploads\/[^/]+\/send$/, afterCommit: true });
    let state = await sync(f, comment); expect(state.attempt?.step).toBe('upload_send');
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    const first = (state.state as NotionState).page!.screenshot!; expect(stub.uploads.get(first.fileUploadId)?.sends).toBe(1);
    await enqueueIntegrationBackfill((await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc, 'notion', notionConnectionId(f.project.id), [(await getCommentsStore().get(comment.domain, comment.id))!.comment]);
    state = await sync(f, comment, { enqueue: false, offset: 120_000 }); expect((state.state as NotionState).page!.screenshot!.fileUploadId).toBe(first.fileUploadId);
    await replaceProjectScreenshot(f.project, f.actor, comment.id, { screenshot: parseScreenshot(jpegImage) as ParsedScreenshot, expectedRevision: comment.screenshot?.revision ?? null });
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    const second = (state.state as NotionState).page!.screenshot!; expect(second.fileUploadId).not.toBe(first.fileUploadId); expect(stub.uploads.get(second.fileUploadId)?.sends).toBe(1);
    expect(page(state).properties.shot.files[0].file_upload.id).toBe(second.fileUploadId);
    expect(JSON.stringify(state)).not.toMatch(/data:image|iVBOR|notion-files/);
    expect(stub.calls.filter(call => call.path.includes('file_uploads') && call.body.multipart).every(call => call.body.bytes > 0)).toBe(true);
});

test('destination switches retain old pages and privacy cleanup covers both destinations', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment); const oldPage = page(state);
    const target = stub.dataSource(f.notionWorkspaceId, 'Second database'); const schema = await loadNotionSchema(f.project, f.owner.id, target.id);
    await saveNotionMapping(f.project, f.owner.id, { dataSourceId: target.id, mapping: schema.mapping });
    await setProjectCommentResolved(f.project, f.actor, comment.id, true);
    state = await sync(f, comment); expect(page(state).id).not.toBe(oldPage.id); expect((state.state as NotionState).retired?.map(p => p.id)).toContain(oldPage.id);
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    state = await sync(f, comment); expect(state.status).toBe('suppressed'); expect(oldPage.in_trash).toBe(true); expect(page(state).in_trash).toBe(true);
    expect(oldPage.children).toHaveLength(0);
});

test('refresh rotation is shared and removed admins lose token access before any API request', async () => {
    const f = await fixture(); const first = await source(f); const second = await source(f, { text: 'Second thread' });
    stub.expireAccess(); const before = stub.calls.filter(call => call.path === '/v1/oauth/token' && call.body.grant_type === 'refresh_token').length;
    await Promise.all([sync(f, first), sync(f, second)]);
    await sync(f, first, { offset: 120_000 }); await sync(f, second, { offset: 120_000 });
    expect(stub.calls.filter(call => call.path === '/v1/oauth/token' && call.body.grant_type === 'refresh_token').length - before).toBe(1);
    await f.store.delete(f.project.pk, memberId(f.owner.id)); stub.calls.length = 0;
    await expect(loadNotionDataSources(f.project, f.owner.id)).rejects.toThrow(); expect(stub.calls).toHaveLength(0);
    // A stale connection helper also invalidates retained credentials before attempting a provider request.
    const { NotionSession } = await import('../src/lib/integrations/notion/connection');
    const connection = (await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc;
    await expect(new NotionSession(connection).request('GET', '/v1/users/me')).rejects.toMatchObject({ code: 'member_left' });
    expect((await f.store.get<NotionGrant>(f.project.pk, notionGrantId(f.project.id)))!.doc.tokens).toBeUndefined();
});

test('rate-limit pauses cover sibling grants sharing the bot and blocked requests are not retried', async () => {
    const f = await fixture(); const sibling = await fixture({ workspaceId: f.notionWorkspaceId, botId: f.botId });
    const comment = await source(f);
    stub.fault({ method: 'POST', path: `/v1/data_sources/${f.dataSource.id}/query`, status: 429, code: 'rate_limited', retryAfter: 7, reason: 'public_api_space_request_rate_limit' });
    let state = await sync(f, comment); expect(state.status).toBe('waiting');
    expect(Date.parse((await sibling.store.get<NotionConnection>(sibling.project.pk, notionConnectionId(sibling.project.id)))!.doc.pausedUntil!)).toBeGreaterThan(Date.now() + 5000);
    const blocked = await fixture(); const blockedComment = await source(blocked);
    stub.fault({ method: 'POST', path: `/v1/data_sources/${blocked.dataSource.id}/query`, status: 429, code: 'rate_limited', reason: 'public_api_request_blocked' });
    state = await sync(blocked, blockedComment); expect(state.status).toBe('waiting');
    expect((await blocked.store.get<NotionConnection>(blocked.project.pk, notionConnectionId(blocked.project.id)))!.doc.statusCode).toBe('request_blocked');
});

test('hourly authorized probes recover repaired mappings without exporting feedback', async () => {
    const f = await fixture();
    await updateDoc<NotionConnection>(f.project.pk, notionConnectionId(f.project.id), current => ({ ...current, status: 'paused', statusCode: 'mapping_invalid' }));
    stub.calls.length = 0;
    const result = await probeNotionConnections({ deadline: Date.now() + 20_000, maxCalls: 1 }); expect(result.calls).toBe(1);
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc.status).toBe('connected');
    expect(stub.calls.every(call => call.method === 'GET')).toBe(true);
    await disconnectNotion(f.project, f.owner.id);
    expect((await f.store.get<NotionGrant>(f.project.pk, notionGrantId(f.project.id)))!.doc.tokens).toBeUndefined();
    expect((await getNotionSettings(f.project, f.owner.id)).status).toBe('not_connected');
});

test('transport errors are bounded and never expose response bodies or credentials', async () => {
    const bad = new NotionClient(async () => new Response(JSON.stringify({ code: 'validation_error', message: 'sensitive provider content', request_id: 'request-1' }), { status: 400 }));
    try { await bad.request('GET', '/v1/users/me', { token: 'token-value' }); throw new Error('Expected request rejection'); }
    catch (error) { expect(error).toBeInstanceOf(NotionApiError); expect(JSON.stringify(error)).not.toMatch(/sensitive provider|token-value/); expect(String(error)).not.toContain('sensitive provider'); }
});

test('private cleanup reconciles an uncertain create before scrubbing the recovered external page', async () => {
    const f = await fixture(); const comment = await source(f);
    stub.fault({ method: 'POST', path: '/v1/pages', afterCommit: true });
    let state = await sync(f, comment); expect(state.attempt?.step).toBe('create_page');
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    await editProjectCommentItem(f.project, f.actor, comment.id, comment.thread.items[0]!.id, { expectedText: 'Original feedback', text: 'Never export this private edit' });
    stub.calls.length = 0;
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('suppressed');
    expect(page(state).in_trash).toBe(true); expect(page(state).children).toHaveLength(0);
    expect(JSON.stringify(stub.calls)).not.toContain('Never export this private edit');
});

test('an expired unattached upload is replaced without resending the previous allocation', async () => {
    const f = await fixture(); const comment = await source(f, { image: pngImage });
    let state = await sync(f, comment, { maxCalls: 3 }); expect(state.lastCode).toBe('budget_exhausted');
    const firstUpload = (state.state as NotionState).upload!; expect(firstUpload).toBeDefined(); expect(stub.uploads.get(firstUpload.id)!.sends).toBe(0);
    await updateDoc<IntegrationSync>(state.pk, state.id, current => ({ ...current, state: { ...current.state,
        upload: { ...(current.state as NotionState).upload!, expiryTime: new Date(Date.now() - 1000).toISOString() } } }));
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    expect((state.state as NotionState).page!.screenshot!.fileUploadId).not.toBe(firstUpload.id); expect(stub.uploads.get(firstUpload.id)!.sends).toBe(0);
});

test('ownership conflicts stop writes instead of adopting a foreign page with matching uier id', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment);
    const external = page(state); external.created_by.id = randomUUID();
    await setProjectCommentResolved(f.project, f.actor, comment.id, true); stub.calls.length = 0;
    state = await sync(f, comment); expect(state.status).toBe('ambiguous'); expect(state.lastCode).toBe('ownership_conflict');
    expect(stub.calls.every(call => call.method === 'GET')).toBe(true); expect(external.properties.status.status.name).toBe('Open');
});

test('nullable refresh grants work until authentication fails, then require reconnect without refreshing', async () => {
    const f = await fixture({ noRefresh: true }); const comment = await source(f);
    expect((await sync(f, comment)).status).toBe('accepted');
    stub.expireAccess(); await setProjectCommentResolved(f.project, f.actor, comment.id, true); stub.calls.length = 0;
    const state = await sync(f, comment); expect(state.status).toBe('waiting');
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc.status).toBe('needs_reconnect');
    expect(stub.calls.some(call => call.path === '/v1/oauth/token')).toBe(false);
});

test('renamed properties keep id mapping and a changed schema pauses before an invalid write', async () => {
    const f = await fixture(); const schema = stub.sources.get(f.dataSource.id)!; schema.properties.Name.name = 'Renamed title';
    const comment = await source(f); let state = await sync(f, comment); expect(state.status).toBe('accepted');
    schema.properties.Status.status.options = [{ name: 'Open' }];
    await updateDoc<NotionConnection>(f.project.pk, notionConnectionId(f.project.id), connection => ({ ...connection,
        config: { ...connection.config, schemaCheckedAt: old } }));
    await setProjectCommentResolved(f.project, f.actor, comment.id, true); stub.calls.length = 0;
    state = await sync(f, comment); expect(state.status).toBe('waiting');
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc.statusCode).toBe('mapping_invalid');
    expect(stub.calls.every(call => call.method === 'GET')).toBe(true);
});

test('duplicated templates resolve full-page databases and child database blocks before enabling the binding', async () => {
    for (const child of [false, true]) {
        const f = await fixture({ connect: false }); const templateId = child ? randomUUID() : f.dataSource.databaseId;
        if (child) {
            stub.pages.set(templateId, { object: 'page', id: templateId, parent: { type: 'workspace', workspace: true }, properties: {}, created_by: { id: f.botId }, children: [f.dataSource.databaseId], in_trash: false });
            stub.blocks.set(f.dataSource.databaseId, { object: 'block', id: f.dataSource.databaseId, type: 'child_database', child_database: { title: 'Feedback' }, in_trash: false });
        }
        const authorize = new URL(await beginNotionConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
        const result = await finishNotionConnect({ userId: f.owner.id, state: authorize.searchParams.get('state'), baseUrl,
            code: stub.code(f.notionWorkspaceId, f.botId, { templateId }) });
        expect(result.status).toBe('connected');
        expect(await getNotionSettings(f.project, f.owner.id)).toMatchObject({ enabled: true, dataSourceId: f.dataSource.id });
    }
});

test('failed destination installation consumes OAuth state and scrubs the unused encrypted grant', async () => {
    const f = await fixture({ connect: false });
    const authorize = new URL(await beginNotionConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    const brokenStore: typeof f.store = { ...f.store, async create(doc) {
        if (doc.type === 'notion-connection') throw new Error('Storage unavailable');
        return f.store.create(doc);
    } };
    const result = await finishNotionConnect({ userId: f.owner.id, state: authorize.searchParams.get('state'), baseUrl,
        code: stub.code(f.notionWorkspaceId, f.botId) }, { store: brokenStore });
    expect(result.status).toBe('failed');
    expect((await f.store.get<NotionGrant>(f.project.pk, notionGrantId(f.project.id)))!.doc.tokens).toBeUndefined();
    await expect(finishNotionConnect({ userId: f.owner.id, state: authorize.searchParams.get('state'), code: 'unused', baseUrl })).rejects.toMatchObject({ code: 'invalid_oauth_state' });
});

test('private cleanup supersedes an uncertain append even if the remote blocks were changed', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment);
    expect({ status: state.status, code: state.lastCode }).toEqual({ status: 'accepted', code: undefined });
    const external = page(state);
    await replyToProjectComment(request, f.project, f.actor, comment.id, { text: 'Public reply' });
    stub.fault({ method: 'PATCH', path: `/v1/blocks/${external.id}/children`, afterCommit: true });
    state = await sync(f, comment); expect(state.attempt?.step).toBe('append_blocks');
    const appended = stub.blocks.get(external.children.at(-1))!; appended[appended.type].rich_text = [{ text: { content: 'Edited in Notion' } }];
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true); stub.calls.length = 0;
    state = await sync(f, comment, { offset: 120_000 });
    expect(state.status).toBe('suppressed'); expect(external.in_trash).toBe(true); expect(external.children).toHaveLength(0);
    expect(stub.calls.some(call => call.method === 'PATCH' && call.path.endsWith('/children'))).toBe(false);
});

test('an interrupted scrub of an empty page still clears copied properties before trashing it', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment); const external = page(state);
    external.children = []; await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    stub.fault({ method: 'PATCH', path: `/v1/pages/${external.id}`, status: 500 });
    state = await sync(f, comment);
    expect(state.attempt).toBeUndefined();
    expect((state.state as NotionState).retiredAttempts?.some(attempt => attempt.step === 'scrub_page')).toBe(true);
    expect((state.state as NotionState).page?.scrubPending).toBe(true);
    expect(richText(external.properties.title.title)).not.toBe('Removed from uier');
    stub.fault({ method: 'PATCH', path: `/v1/pages/${external.id}`, status: 500 });
    state = await sync(f, comment, { offset: 120_000 });
    expect((state.state as NotionState).retiredAttempts).toHaveLength(1);
    expect((state.state as NotionState).page?.scrubbed).not.toBe(true);
    state = await sync(f, comment, { offset: 240_000 }); expect(state.status).toBe('suppressed');
    expect(richText(external.properties.title.title)).toBe('Removed from uier'); expect(richText(external.properties.uid.rich_text)).toBe('');
});

test('a newly authorized grant observes an existing workspace rate pause before fetching data', async () => {
    const f = await fixture(); const comment = await source(f);
    stub.fault({ method: 'POST', path: `/v1/data_sources/${f.dataSource.id}/query`, status: 429, code: 'rate_limited', retryAfter: 7, reason: 'public_api_space_request_rate_limit' });
    await sync(f, comment);
    const sibling = await fixture({ workspaceId: f.notionWorkspaceId, botId: f.botId, connect: false });
    const authorize = new URL(await beginNotionConnect({ userId: sibling.owner.id, workspaceId: sibling.project.workspaceId, projectId: sibling.project.id, baseUrl }));
    expect((await finishNotionConnect({ userId: sibling.owner.id, state: authorize.searchParams.get('state'), baseUrl,
        code: stub.code(sibling.notionWorkspaceId, sibling.botId) })).status).toBe('connected');
    stub.calls.length = 0;
    await expect(loadNotionDataSources(sibling.project, sibling.owner.id)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(stub.calls).toHaveLength(0);
});

test('a member revoked while a paced call waits cannot send retained credentials', async () => {
    const f = await fixture();
    const { NotionSession } = await import('../src/lib/integrations/notion/connection');
    const connection = (await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc;
    await f.store.create({ type: 'notion-rate', pk: `notion-rate:${f.botId}`, id: 'calls', nextAt: Date.now() + 150, ttl: 600 });
    delete process.env.NOTION_REQUEST_INTERVAL_MS; stub.calls.length = 0;
    try {
        const pending = new NotionSession(connection).request('GET', '/v1/users/me');
        await new Promise(resolve => setTimeout(resolve, 10)); await f.store.delete(f.project.pk, memberId(f.owner.id));
        await expect(pending).rejects.toMatchObject({ code: 'member_left' }); expect(stub.calls).toHaveLength(0);
    } finally { process.env.NOTION_REQUEST_INTERVAL_MS = '0'; }
});

test('a rejected refresh wipes both token fields and cannot resurrect a grant', async () => {
    const f = await fixture(); const comment = await source(f); stub.expireAccess();
    stub.fault({ method: 'POST', path: '/v1/oauth/token', status: 400, code: 'invalid_grant' });
    await sync(f, comment);
    const retained = (await f.store.get<NotionGrant>(f.project.pk, notionGrantId(f.project.id)))!.doc;
    expect(retained.tokens).toBeUndefined(); expect(retained.refreshLease).toBeUndefined(); expect(retained.status).toBe('needs_reconnect');
});

test('bounded backfill adopts existing owned pages and completes thirty threads across two call budgets', async () => {
    const f = await fixture(); const sources: DbComment[] = [];
    for (let index = 0; index < 30; index++) sources.push(await source(f, { text: `Backfill thread ${index}` }));
    const existing = sources.slice(0, 5).map(comment => {
        const id = randomUUID(); stub.pages.set(id, { object: 'page', id, url: `https://app.notion.com/p/${id}`,
            parent: { type: 'data_source_id', data_source_id: f.dataSource.id }, created_by: { id: f.botId }, in_trash: false, children: [],
            properties: { title: { id: 'title', type: 'title', title: [{ text: { content: 'Existing page' } }] },
                uid: { id: 'uid', type: 'rich_text', rich_text: [{ text: { content: comment.id } }] } } }); return id;
    });
    const project = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc;
    expect((await enqueueIntegrationBackfill(project, 'notion', notionConnectionId(f.project.id), sources)).queued).toBe(30);
    for (let run = 0; run < 2; run++) {
        let calls = 0;
        for (const comment of sources) {
            const queued = await ledger(f, comment.id); if (queued.status === 'accepted') continue;
            if (calls >= 75) break;
            await processIntegrationDelivery(queued, baseUrl, adapter, { now: () => Date.now() + run * 120_000,
                maxCalls: 75 - calls, onRequest: () => { calls++; } });
        }
        expect(calls).toBeLessThanOrEqual(75);
    }
    const rows = await f.store.query<IntegrationSync>({ type: 'notion-sync', pk: `notion:${f.project.id}` });
    expect(rows).toHaveLength(30); expect(rows.every(row => row.status === 'accepted')).toBe(true);
    expect(existing.every(id => rows.some(row => (row.state as NotionState).page?.id === id))).toBe(true);
    expect([...stub.pages.values()].filter(value => value.parent.data_source_id === f.dataSource.id)).toHaveLength(30);
});

test('workspace changes retain inaccessible create receipts, clean the new copy and recover old cleanup when access returns', async () => {
    const f = await fixture(); const comment = await source(f);
    stub.fault({ method: 'POST', path: '/v1/pages', afterCommit: true });
    let state = await sync(f, comment); expect(state.attempt?.step).toBe('create_page');
    const oldPage = [...stub.pages.values()].find(value => richText(pageProperty(value, 'uid').rich_text) === comment.id)!;
    const replacementWorkspace = randomUUID(); const replacementBot = randomUUID(); const replacement = stub.dataSource(replacementWorkspace);
    async function reconnect(workspaceId: string, botId: string, dataSourceId: string) {
        const authorize = new URL(await beginNotionConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
        expect((await finishNotionConnect({ userId: f.owner.id, state: authorize.searchParams.get('state'), baseUrl,
            code: stub.code(workspaceId, botId) })).status).toBe('connected');
        const schema = await loadNotionSchema(f.project, f.owner.id, dataSourceId);
        await saveNotionMapping(f.project, f.owner.id, { dataSourceId, mapping: schema.mapping });
    }
    await reconnect(replacementWorkspace, replacementBot, replacement.id);
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    expect((state.state as NotionState).retiredAttempts).toHaveLength(1); expect(page(state).id).not.toBe(oldPage.id);
    expect((await getNotionSettings(f.project, f.owner.id)).needsReviewCount).toBe(0);
    const newPage = page(state); await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    state = await sync(f, comment, { offset: 120_000 }); expect(newPage.in_trash).toBe(true); expect(newPage.children).toHaveLength(0);
    expect(state.status).toBe('ambiguous'); expect(state.lastCode).toBe('cleanup_blocked');
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc).toMatchObject({ status: 'connected', enabled: true });
    expect((await getNotionSettings(f.project, f.owner.id)).needsReviewCount).toBe(1);
    const other = await source(f, { text: 'Another shared thread keeps syncing' }); expect((await sync(f, other)).status).toBe('accepted');
    expect(oldPage.in_trash).toBe(false);
    await reconnect(f.notionWorkspaceId, f.botId, f.dataSource.id);
    await updateDoc<IntegrationSync>(state.pk, state.id, current => ({ ...current, active: true, status: 'queued', nextAttemptAt: old }));
    state = await sync(f, comment, { offset: 240_000, enqueue: false }); expect(state.status).toBe('suppressed');
    expect(oldPage.in_trash).toBe(true); expect(richText(oldPage.properties.uid.rich_text)).toBe('');
    expect((state.state as NotionState).retiredAttempts ?? []).toHaveLength(0);
});

test('an old ownership conflict and uncertain append cannot block reachable current-page cleanup', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment); const previous = page(state);
    const oldRecord = structuredClone((state.state as NotionState).page!);
    const target = stub.dataSource(f.notionWorkspaceId, 'Current database');
    const schema = await loadNotionSchema(f.project, f.owner.id, target.id);
    await saveNotionMapping(f.project, f.owner.id, { dataSourceId: target.id, mapping: schema.mapping });
    await setProjectCommentResolved(f.project, f.actor, comment.id, true);
    state = await sync(f, comment); const current = page(state);
    expect(current.parent.data_source_id).toBe(target.id);
    previous.properties.uid.rich_text = [{ type: 'text', text: { content: 'Changed ownership marker' } }];
    const receipt: IntegrationAttempt = { operationId: randomUUID(), firstSentAt: new Date().toISOString(), through: 1,
        requestRevision: 1, destinationRevision: 2, step: 'append_blocks', planHash: 'a'.repeat(64), repeatable: false,
        metadata: { pageId: previous.id, keys: ['interrupted'], hashes: ['a'.repeat(64)] } };
    await updateDoc<IntegrationSync>(state.pk, state.id, row => ({ ...row, attempt: receipt }));
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    state = await sync(f, comment, { offset: 120_000 });
    expect(state).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_blocked' });
    expect(current.in_trash).toBe(true); expect(current.children).toEqual([]);
    expect(richText(current.properties.uid.rich_text)).toBe('');
    expect(previous.in_trash).toBe(false);
    expect((state.state as NotionState).retiredAttempts?.[0]).toMatchObject({ operationId: receipt.operationId, metadata: { pageId: oldRecord.id } });
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc.status).toBe('connected');
});

test('an empty old-create reconciliation still cleans known current copies and never retries the unreviewed create', async () => {
    const f = await fixture(); const comment = await source(f);
    stub.fault({ method: 'POST', path: '/v1/pages', afterCommit: true });
    let state = await sync(f, comment); const receipt = structuredClone(state.attempt!);
    const previous = [...stub.pages.values()].find(value => richText(pageProperty(value, 'uid').rich_text) === comment.id)!;
    state = await sync(f, comment, { offset: 120_000 }); expect(state.status).toBe('accepted');
    const target = stub.dataSource(f.notionWorkspaceId, 'Current database'); const schema = await loadNotionSchema(f.project, f.owner.id, target.id);
    await saveNotionMapping(f.project, f.owner.id, { dataSourceId: target.id, mapping: schema.mapping });
    await setProjectCommentResolved(f.project, f.actor, comment.id, true);
    state = await sync(f, comment, { offset: 240_000 }); const current = page(state);
    expect(current.parent.data_source_id).toBe(target.id);
    await updateDoc<IntegrationSync>(state.pk, state.id, row => {
        const saved = structuredClone(row.state) as NotionState;
        saved.retired = saved.retired?.filter(value => value.id !== previous.id);
        return { ...row, state: saved, attempt: receipt };
    });
    stub.pages.delete(previous.id);
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    const created = stub.calls.filter(call => call.method === 'POST' && call.path === '/v1/pages').length;
    state = await sync(f, comment, { offset: 360_000 });
    expect(current.in_trash).toBe(true); expect(current.children).toEqual([]);
    expect(state).toMatchObject({ status: 'waiting', lastCode: 'create_unconfirmed', attempt: undefined });
    expect((state.state as NotionState).retiredAttempts?.[0]).toMatchObject({ operationId: receipt.operationId,
        metadata: { dataSourceId: f.dataSource.id, notionWorkspaceId: f.notionWorkspaceId, botId: f.botId } });
    for (let pass = 1; pass < 8; pass++) state = await sync(f, comment, { offset: (pass + 3) * 120_000 });
    expect(state).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_blocked' });
    expect(stub.calls.filter(call => call.method === 'POST' && call.path === '/v1/pages')).toHaveLength(created);
    expect(JSON.stringify(state)).not.toContain('Original feedback');
});

test('privacy cleanup clears a type-converted copied property using its current writable representation', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment); const external = page(state);
    const definition = stub.sources.get(f.dataSource.id)!.properties.Link;
    definition.type = 'rich_text'; definition.rich_text = {}; delete definition.url;
    external.properties.link = { id: 'link', type: 'rich_text', rich_text: [{ type: 'text', text: { content: 'Retained copied private value' } }] };
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    const before = stub.calls.length;
    state = await sync(f, comment);
    expect(state.status).toBe('suppressed'); expect(external.in_trash).toBe(true);
    expect(external.properties.link.rich_text).toEqual([]);
    expect(stub.calls.slice(before).some(call => call.method === 'PATCH' && call.path === `/v1/pages/${external.id}` && Array.isArray(call.body.properties?.link?.rich_text))).toBe(true);
    // Status metadata is deliberately retained by the integration's privacy contract.
    expect(external.properties.status.status.name).toBe('Open');
});

test('an unsupported converted copied property remains explicitly blocked instead of claiming a complete scrub', async () => {
    const f = await fixture(); const comment = await source(f); let state = await sync(f, comment); const external = page(state);
    const definition = stub.sources.get(f.dataSource.id)!.properties.Assignee;
    definition.type = 'formula'; definition.formula = { expression: 'retained' }; delete definition.rich_text;
    external.properties.assignee = { id: 'assignee', type: 'formula', formula: { type: 'string', string: 'Retained copied private value' } };
    await setProjectCommentPrivate(f.project, f.actor, comment.id, true);
    state = await sync(f, comment);
    expect(state).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_blocked' });
    expect((state.state as NotionState).page?.scrubbed).not.toBe(true);
    expect(external.properties.assignee.formula.string).toBe('Retained copied private value');
    expect((await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc.status).toBe('connected');
});

test('bounded probes rotate past more than one hundred unchanged paused rows to a repaired destination', async () => {
    const f = await fixture();
    const original = (await f.store.get<NotionConnection>(f.project.pk, notionConnectionId(f.project.id)))!.doc;
    const late: NotionConnection = { ...original, id: 'notion_zzzzzzzzzzzz', status: 'paused', statusCode: 'mapping_invalid' };
    await f.store.create(late);
    await updateDoc<DbProject>(f.project.pk, f.project.id, current => ({ ...current, integrations: { ...current.integrations,
        notion: { connectionId: late.id, since: old } } }));
    for (let index = 0; index < 100; index++) await f.store.create<NotionConnection>({ ...original,
        id: `notion_probe_${String(index).padStart(3, '0')}`, status: 'paused', statusCode: 'mapping_invalid',
        config: { ...original.config, probeAt: new Date().toISOString() } });
    await f.store.create<NotionConnection>({ ...original, id: 'notion_zzzzzzzzzzzzzz', status: 'paused', statusCode: 'mapping_invalid',
        config: { ...original.config, probeAt: new Date().toISOString() } });
    await f.store.delete('integrations:worker', 'notion-probes');
    const reads: DocQuery<string>[] = [];
    const store: AppStore = { ...f.store, async query<T extends AppDoc>(query: DocQuery<T['type']>) {
        if (query.type === 'notion-connection') {
            reads.push(query);
            return f.store.query<T>({ ...query, pk: f.project.pk });
        }
        return f.store.query<T>(query);
    } };
    stub.calls.length = 0;
    expect(await probeNotionConnections({ deadline: Date.now() + 20_000, maxCalls: 1 }, { store })).toEqual({ calls: 0, deferred: 0 });
    expect((await f.store.get(late.pk, late.id))!.doc).toMatchObject({ status: 'paused' });
    expect((await f.store.get('integrations:worker', 'notion-probes'))!.doc).toMatchObject({ afterId: 'notion_probe_099' });
    expect(await probeNotionConnections({ deadline: Date.now() + 20_000, maxCalls: 1 }, { store })).toEqual({ calls: 1, deferred: 1 });
    expect((await f.store.get(late.pk, late.id))!.doc).toMatchObject({ status: 'connected' });
    // The later row was not visited after the API allowance ran out.
    expect((await f.store.get('integrations:worker', 'notion-probes'))!.doc).toMatchObject({ afterId: late.id });
    expect(reads).toEqual([
        { type: 'notion-connection', where: { enabled: true, status: 'paused' }, limit: 100, orderBy: 'id' },
        { type: 'notion-connection', where: { enabled: true, status: 'paused' }, limit: 100, orderBy: 'id', afterId: 'notion_probe_099' }
    ]);
    expect(stub.calls).toHaveLength(1); expect(stub.calls[0]).toMatchObject({ method: 'GET', path: `/v1/data_sources/${f.dataSource.id}` });
    await probeNotionConnections({ deadline: Date.now() + 20_000, maxCalls: 1 }, { store });
    expect((await f.store.get('integrations:worker', 'notion-probes'))!.doc).toMatchObject({ afterId: 'notion_zzzzzzzzzzzzzz' });
    await probeNotionConnections({ deadline: Date.now() + 20_000, maxCalls: 1 }, { store });
    expect(reads.at(-1)?.afterId).toBeUndefined();
});

test('app id cursors are exclusive, ordered and rejected when unbounded or used with another ordering', async () => {
    const store = getAppStore(); const pk = `probe-test:${randomUUID()}`;
    for (const id of ['b', 'Z', 'a']) await store.create({ type: 'probe-test', pk, id });
    expect((await store.query({ type: 'probe-test', pk, limit: 1, orderBy: 'id', afterId: 'Z' })).map(row => row.id)).toEqual(['a']);
    expect((await store.query({ type: 'probe-test', pk, limit: 1, orderBy: 'id', afterId: 'a' })).map(row => row.id)).toEqual(['b']);
    expect(await store.query({ type: 'probe-test', pk, limit: 1, orderBy: 'id', afterId: 'b' })).toEqual([]);
    await expect(store.query({ type: 'probe-test', pk, limit: 1, afterId: 'a' })).rejects.toThrow('Invalid document query cursor');
    for (const afterId of ['', 'a'.repeat(257), 'a\nb'])
        await expect(store.query({ type: 'probe-test', pk, limit: 1, orderBy: 'id', afterId })).rejects.toThrow('Invalid document query cursor');
});
