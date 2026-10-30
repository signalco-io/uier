import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import type { DbComment } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { revokeIntegrationGrantsOf } from '../src/lib/integrations/connection';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import { discoverThreadIntegrationSync, enqueueIntegrationSync, integrationPk, integrationSyncId } from '../src/lib/integrations/discovery';
import { loadIntegrationLinks } from '../src/lib/integrations/links';
import { syncPendingKey } from '../src/lib/integrations/syncSignal';
import type { IntegrationSync } from '../src/lib/integrations/model';
import { azureDevOpsAdapter, beginAzureDevOpsConnect, disconnectAzureDevOps, finishAzureDevOpsConnect, getAzureDevOpsSettings,
    loadAzureDevOpsOrganizations, loadAzureDevOpsProjectOptions, loadAzureDevOpsProjects, saveAzureDevOpsDestination,
    setAzureDevOpsEnabled } from '../src/lib/integrations/azure-devops';
import { azureDevOpsConnection, currentAzureDevOpsGrant } from '../src/lib/integrations/azure-devops/connection';
import { azureDevOpsProjection } from '../src/lib/integrations/azure-devops/workItem';
import type { AzureDevOpsConnection, AzureDevOpsState } from '../src/lib/integrations/azure-devops/model';
import { startAzureDevOpsStub, type AzureDevOpsStub } from './support/azureDevOpsStub';

const test = base.extend<{ ado: AzureDevOpsStub }>({ ado: async ({}, use) => {
    process.env.UIER_LOCAL = '1';
    const stub = await startAzureDevOpsStub();
    Object.assign(process.env, { AZURE_DEVOPS_CLIENT_ID: 'ado-test-client', AZURE_DEVOPS_CLIENT_SECRET: 'ado-test-secret',
        AZURE_DEVOPS_TOKEN_KEY: Buffer.alloc(32, 23).toString('base64'), AZURE_DEVOPS_TOKEN_KEY_ID: 'k1',
        AZURE_DEVOPS_API_BASE_URL: `${stub.url}/devops`, AZURE_DEVOPS_PROFILE_BASE_URL: `${stub.url}/vssps`,
        AZURE_DEVOPS_OAUTH_AUTHORIZE_URL: `${stub.url}/oauth2/v2.0/authorize`, AZURE_DEVOPS_OAUTH_TOKEN_URL: `${stub.url}/oauth2/v2.0/token` });
    try { await use(stub); } finally { await stub.close(); }
} });
const old = '2026-01-01T00:00:00.000Z';
const baseUrl = 'https://uier.io';

async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`ado-owner-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const store = getAppStore(); const comments = getCommentsStore();
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Azure DevOps project ${id}`,
        urls: ['https://reviewed.example'], status: 'active', access: 'invited', createdBy: owner.id, createdAt: old, updatedAt: old };
    await store.create(project);
    await store.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    await store.create<DbMember>({ type: 'member', id: memberId(owner.id), pk: project.pk, workspaceId,
        userId: owner.id, email: owner.email, role: 'admin', projects: 'all', createdAt: old });
    const source: DbComment = { id: `comment_${id}`, domain: `project:${id}`, projectId: id, syncVersion: 1, syncPending: true,
        syncKey: syncPendingKey(`project:${id}`, `comment_${id}`), path: '/pricing', origin: 'https://reviewed.example', kind: 'bug', position: { type: 'page' },
        createdAt: old, updatedAt: old, authorId: `user:${owner.id}`, thread: { items: [{ id: `item_${id}`, text: 'The save button does not respond',
            authorId: `user:${owner.id}`, createdAt: old }] } };
    await comments.create(source);
    return { store, comments, project, owner, source };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function freshProject(f: Fixture) { f.project = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc; return f.project; }
async function source(f: Fixture) { return (await f.comments.get(f.source.domain, f.source.id))!.comment; }
async function change(f: Fixture, patch: Partial<DbComment>) {
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    const next = { ...stored.comment, ...patch, syncVersion: stored.comment.syncVersion! + 1, syncPending: true };
    expect(await f.comments.replace(next, stored.etag)).toBe('ok'); return next;
}
async function authorize(f: Fixture, ado: AzureDevOpsStub, options: { userId?: string; profileOnly?: boolean } = {}) {
    const start = new URL(await beginAzureDevOpsConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    const code = ado.code(start.searchParams.get('code_challenge')!, options);
    return { start, result: await finishAzureDevOpsConnect({ userId: f.owner.id, state: start.searchParams.get('state'), code, baseUrl }) };
}
async function connect(f: Fixture, ado: AzureDevOpsStub, workItemType = 'Bug') {
    expect((await authorize(f, ado)).result.status).toBe('connected');
    await saveAzureDevOpsDestination(await freshProject(f), f.owner.id, { organization: ado.organization, projectId: ado.projectId,
        workItemType, openState: 'New', doneState: workItemType === 'Bug' ? 'Resolved' : 'Closed', areaPath: `${ado.projectName}\\Marketing` });
    return (await azureDevOpsConnection(await freshProject(f)))!;
}
async function ledger(f: Fixture) {
    const connection = (await azureDevOpsConnection(await freshProject(f)))!;
    return (await f.store.get<IntegrationSync>(integrationPk('azure-devops', f.project.id), integrationSyncId('azure-devops', connection.id, f.project.id, f.source.id)))!.doc;
}
async function dispatch(f: Fixture) {
    const project = await freshProject(f);
    await discoverThreadIntegrationSync(project, await source(f), { adapters: [azureDevOpsAdapter] });
    await processIntegrationDelivery(await ledger(f), baseUrl, azureDevOpsAdapter);
    return ledger(f);
}
async function retry(f: Fixture) {
    const current = await ledger(f);
    await updateDoc<IntegrationSync>(current.pk, current.id, value => ({ ...value, active: true, status: 'queued', nextAttemptAt: old }));
    await processIntegrationDelivery(current, baseUrl, azureDevOpsAdapter); return ledger(f);
}
const workItem = async (f: Fixture, ado: AzureDevOpsStub) => ado.workItems.get(((await ledger(f)).state as AzureDevOpsState).item!.id!)!;

test('Entra sign-in uses PKCE and delegated work item scopes, binds nothing before a destination and consumes state once', async ({ ado }) => {
    const f = await fixture();
    const { start, result } = await authorize(f, ado);
    expect(result.status).toBe('connected');
    expect(start.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.searchParams.get('scope')).toBe('499b84ac-1321-427f-aa17-267ca6975798/vso.work_write 499b84ac-1321-427f-aa17-267ca6975798/vso.profile offline_access');
    expect(start.searchParams.get('state')).not.toContain(f.owner.id);
    expect((await freshProject(f)).integrations?.['azure-devops']).toBeUndefined();
    await expect(finishAzureDevOpsConnect({ userId: f.owner.id, state: start.searchParams.get('state'), code: 'replayed', baseUrl })).rejects.toThrow();
    const view = await getAzureDevOpsSettings(f.project, f.owner.id);
    expect(view).toMatchObject({ connected: true, enabled: false, accountName: 'Test Microsoft user' });
    expect(JSON.stringify(view)).not.toMatch(/ado-test-access|ado-test-refresh|grant|v1\.k1/);
    expect(JSON.stringify(view)).not.toContain(ado.userId);
    expect(ado.workItems.size).toBe(0);
});

test('a missing work item scope, a denial or another user’s callback stores no usable credentials', async ({ ado }) => {
    const f = await fixture();
    expect((await authorize(f, ado, { profileOnly: true })).result.status).toBe('failed');
    expect(await azureDevOpsConnection(f.project)).toBeNull();
    const denied = new URL(await beginAzureDevOpsConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect((await finishAzureDevOpsConnect({ userId: f.owner.id, state: denied.searchParams.get('state'), error: 'access_denied', baseUrl })).status).toBe('denied');
    const other = await findOrCreateUser(`ado-other-${randomUUID()}@example.com`);
    const foreign = new URL(await beginAzureDevOpsConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    await expect(finishAzureDevOpsConnect({ userId: other.id, state: foreign.searchParams.get('state'), code: ado.code(foreign.searchParams.get('code_challenge')!), baseUrl })).rejects.toThrow();
    expect(await azureDevOpsConnection(f.project)).toBeNull();
});

test('destination choices hide board-less types, validate state categories and pick the field a type shows', async ({ ado }) => {
    const f = await fixture();
    await authorize(f, ado);
    expect((await loadAzureDevOpsOrganizations(f.project, f.owner.id)).items).toEqual([{ id: ado.organizationId, name: ado.organization }]);
    expect((await loadAzureDevOpsProjects(f.project, f.owner.id, ado.organization)).items).toEqual([{ id: ado.projectId, name: ado.projectName }]);
    const options = await loadAzureDevOpsProjectOptions(f.project, f.owner.id, ado.organization, ado.projectId);
    expect(options.types.map(type => type.name)).toEqual(['Bug', 'Task']);
    expect(options.areaPaths).toEqual([ado.projectName, `${ado.projectName}\\Marketing`]);
    const input = { organization: ado.organization, projectId: ado.projectId, workItemType: 'Bug', openState: 'New', doneState: 'Resolved' };
    await expect(saveAzureDevOpsDestination(f.project, f.owner.id, { ...input, doneState: 'Active' })).rejects.toMatchObject({ code: 'mapping_not_available' });
    await expect(saveAzureDevOpsDestination(f.project, f.owner.id, { ...input, doneState: 'New' })).rejects.toMatchObject({ code: 'invalid_mapping' });
    await expect(saveAzureDevOpsDestination(f.project, f.owner.id, { ...input, workItemType: 'Shared Steps', openState: 'Active', doneState: 'Closed' }))
        .rejects.toMatchObject({ code: 'mapping_not_available' });
    await expect(saveAzureDevOpsDestination(f.project, f.owner.id, { ...input, areaPath: 'Elsewhere\\Area' })).rejects.toMatchObject({ code: 'mapping_not_available' });
    await saveAzureDevOpsDestination(f.project, f.owner.id, input);
    expect((await azureDevOpsConnection(await freshProject(f)))!.config.bodyField).toBe('Microsoft.VSTS.TCM.ReproSteps');
    await saveAzureDevOpsDestination(f.project, f.owner.id, { ...input, workItemType: 'Task', doneState: 'Closed' });
    const connection = (await azureDevOpsConnection(await freshProject(f)))!;
    expect(connection).toMatchObject({ enabled: true, config: { bodyField: 'System.Description', workItemType: 'Task' } });
    expect((await freshProject(f)).integrations?.['azure-devops']?.connectionId).toBe(connection.id);
});

test('a thread becomes one work item whose description follows uier, while board state moves are kept', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    expect((await dispatch(f)).status).toBe('accepted');
    const item = await workItem(f, ado);
    expect(ado.workItems.size).toBe(1);
    expect(item.fields['System.Title']).toBe('The save button does not respond');
    expect(item.fields['Microsoft.VSTS.TCM.ReproSteps']).toContain('<pre>The save button does not respond</pre>');
    expect(item.fields['Microsoft.VSTS.TCM.ReproSteps']).toContain('uier-source:');
    expect(item.fields['System.AreaPath']).toBe(`${ado.projectName}\\Marketing`);
    expect(item.fields['System.State']).toBe('New');
    // A team moves the item on its board; uier keeps that until the uier status changes.
    item.fields['System.State'] = 'Active';
    await change(f, { thread: { items: [...(await source(f)).thread.items, { id: `reply_${randomUUID()}`, text: 'I can <b>reproduce</b> this',
        authorId: `user:${f.owner.id}`, createdAt: old }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    expect(item.fields['System.State']).toBe('Active');
    expect(item.fields['Microsoft.VSTS.TCM.ReproSteps']).toContain('I can &lt;b&gt;reproduce&lt;/b&gt; this');
    await change(f, { resolved: true });
    expect((await dispatch(f)).status).toBe('accepted');
    expect(item.fields['System.State']).toBe('Resolved');
    const updates = ado.calls.filter(call => call.operation === 'update').length;
    await change(f, { resolved: true });
    expect((await dispatch(f)).status).toBe('accepted');
    expect(ado.calls.filter(call => call.operation === 'update')).toHaveLength(updates);
    expect(ado.calls.filter(call => call.operation === 'create')).toHaveLength(1);
});

test('a create whose response is lost is found by its marker instead of being sent twice', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    ado.fault('create', 'lost');
    const uncertain = await dispatch(f);
    expect(uncertain.status).toBe('waiting'); expect(uncertain.attempt?.step).toBe('create_work_item');
    expect(ado.workItems.size).toBe(1);
    expect((await retry(f)).status).toBe('accepted');
    expect(ado.workItems.size).toBe(1);
    expect(ado.calls.filter(call => call.operation === 'create')).toHaveLength(1);
    expect(((await ledger(f)).state as AzureDevOpsState).item!.id).toBe([...ado.workItems.keys()][0]);
});

test('an unanswered create waits for the settle time, then sends once when the search finds nothing', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    ado.fault('create', 'unanswered');
    const uncertain = await dispatch(f);
    expect(uncertain.status).toBe('waiting'); expect(ado.workItems.size).toBe(0);
    expect((await retry(f)).lastCode).toBe('reconciling_previous_operation');
    expect(ado.calls.filter(call => call.operation === 'create')).toHaveLength(1);
    const current = await ledger(f);
    const state = structuredClone(current.state) as AzureDevOpsState;
    state.item!.createStartedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    await updateDoc<IntegrationSync>(current.pk, current.id, value => ({ ...value, state }));
    expect((await retry(f)).status).toBe('accepted');
    expect(ado.workItems.size).toBe(1); expect(ado.calls.filter(call => call.operation === 'create')).toHaveLength(2);
});

test('privacy cleanup sends no private packet, scrubs the work item, moves it to the recycle bin and starts fresh when visible again', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    expect((await dispatch(f)).status).toBe('accepted');
    const original = await workItem(f, ado);
    const before = ado.calls.length;
    await change(f, { private: true, thread: { items: [{ ...f.source.thread.items[0]!, text: 'NEW PRIVATE SECRET MUST NEVER LEAVE' }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    expect(original).toMatchObject({ deleted: true, fields: { 'System.Title': 'Removed from uier' } });
    expect(String(original.fields['Microsoft.VSTS.TCM.ReproSteps'])).not.toContain('The save button');
    expect(JSON.stringify(ado.calls.slice(before))).not.toContain('NEW PRIVATE SECRET');
    expect(ado.calls.slice(before).some(call => call.operation === 'delete' && !call.path.includes('destroy'))).toBe(true);
    await change(f, { private: false, thread: { items: [{ ...f.source.thread.items[0]!, text: 'Visible again' }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    const state = (await ledger(f)).state as AzureDevOpsState;
    expect(state.item!.id).not.toBe(original.id); expect(state.retired?.[0]).toMatchObject({ id: original.id, cleaned: true });
    expect(ado.workItems.size).toBe(2);
});

test('hard deletion after a destination change cleans both work items', async ({ ado }) => {
    const f = await fixture(); const connection = await connect(f, ado);
    await dispatch(f);
    await saveAzureDevOpsDestination(f.project, f.owner.id, { organization: ado.organization, projectId: ado.projectId, workItemType: 'Task', openState: 'New', doneState: 'Closed' });
    await change(f, { resolved: true }); await dispatch(f);
    expect(ado.workItems.size).toBe(2);
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.delete(f.source.domain, f.source.id, stored.etag)).toBe('ok');
    const queued = await enqueueIntegrationSync(await freshProject(f), 'azure-devops', connection.id, f.source.id, stored.comment.syncVersion! + 1,
        { deletion: { version: stored.comment.syncVersion! + 1, deletedAt: new Date().toISOString() } });
    await processIntegrationDelivery(queued, baseUrl, azureDevOpsAdapter);
    expect((await ledger(f)).tombstoned).toBe(true);
    expect([...ado.workItems.values()].every(item => item.deleted && item.fields['System.Title'] === 'Removed from uier')).toBe(true);
});

test('a work item deleted in Azure DevOps needs review and is never recreated silently', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    await dispatch(f);
    (await workItem(f, ado)).deleted = true;
    await change(f, { resolved: true });
    const result = await dispatch(f);
    expect(result).toMatchObject({ status: 'ambiguous', lastCode: 'work_item_missing' });
    expect(ado.calls.filter(call => call.operation === 'create')).toHaveLength(1);
    expect((await getAzureDevOpsSettings(f.project, f.owner.id)).needsReviewCount).toBe(1);
});

test('a renamed project is matched by its id, and a rejected change pauses the connection', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    await dispatch(f);
    ado.renameProject('Website renamed');
    await change(f, { resolved: true });
    expect((await dispatch(f)).status).toBe('accepted');
    expect(((await ledger(f)).state as AzureDevOpsState).item!.projectName).toBe('Website renamed');
    ado.fault('update', 'bad_request');
    await change(f, { resolved: false });
    expect((await dispatch(f)).lastCode).toBe('work_item_rejected');
    expect((await azureDevOpsConnection(await freshProject(f)))).toMatchObject({ status: 'paused', statusCode: 'work_item_rejected' });
    await setAzureDevOpsEnabled(f.project, f.owner.id, true);
    expect((await retry(f)).status).toBe('accepted');
});

test('rate limits pause the grant before any further call', async ({ ado }) => {
    const f = await fixture(); const connection = await connect(f, ado);
    ado.fault('create', 'rate_limit');
    const waiting = await dispatch(f);
    expect(waiting).toMatchObject({ status: 'waiting', lastCode: 'rate_limited' });
    expect(waiting.attempt).toBeUndefined();
    expect(Date.parse((await currentAzureDevOpsGrant(connection)).pausedUntil!)).toBeGreaterThanOrEqual(Date.now() + 6000);
    const calls = ado.calls.length;
    await retry(f); expect(ado.calls).toHaveLength(calls);
    expect(ado.workItems.size).toBe(0);
});

test('a rejected access token refreshes once and the next run continues', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    expect((await dispatch(f)).status).toBe('accepted');
    ado.revokeTokens();
    await change(f, { resolved: true });
    expect((await dispatch(f)).lastCode).toBe('credentials_refreshed');
    expect(ado.refreshCalls).toBe(1);
    expect((await retry(f)).status).toBe('accepted');
    expect((await workItem(f, ado)).fields['System.State']).toBe('Resolved');
    expect(ado.workItems.size).toBe(1);
});

test('a freshly refreshed token that is still refused pauses instead of refreshing again', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    ado.fault('create', 'unauthenticated');
    expect((await dispatch(f)).lastCode).toBe('credentials_refreshed');
    ado.fault('create', 'unauthenticated');
    expect((await retry(f)).lastCode).toBe('access_denied');
    expect(ado.refreshCalls).toBe(1);
    expect(await azureDevOpsConnection(await freshProject(f))).toMatchObject({ status: 'paused', statusCode: 'access_denied' });
    expect(ado.workItems.size).toBe(0);
});

test('turned-off, disconnected and removed-admin connections make no calls and wipe credentials', async ({ ado }) => {
    const f = await fixture(); const connection = await connect(f, ado);
    await setAzureDevOpsEnabled(f.project, f.owner.id, false);
    const before = ado.calls.length;
    expect((await dispatch(f)).status).toBe('waiting'); expect(ado.calls).toHaveLength(before);
    await setAzureDevOpsEnabled(f.project, f.owner.id, true);
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
    await revokeIntegrationGrantsOf(f.project.workspaceId, f.owner.id);
    expect((await retry(f)).status).toBe('suppressed'); expect(ado.calls).toHaveLength(before);
    expect(await f.store.get(connection.pk, connection.grantId)).toMatchObject({ doc: { status: 'disconnected', access: undefined, refresh: undefined } });

    const g = await fixture(); const second = await connect(g, ado);
    await disconnectAzureDevOps(g.project, g.owner.id);
    expect((await freshProject(g)).integrations?.['azure-devops']).toBeUndefined();
    expect((await g.store.get(second.pk, second.grantId))!.doc).toMatchObject({ status: 'disconnected', access: undefined, refresh: undefined });
    expect((await getAzureDevOpsSettings(g.project, g.owner.id)).connected).toBe(false);
});

test('members get a validated work item link; guests and private threads get none', async ({ ado }) => {
    const f = await fixture(); await connect(f, ado);
    await dispatch(f);
    const id = ((await ledger(f)).state as AzureDevOpsState).item!.id;
    const member = { kind: 'member' as const, userId: f.owner.id, name: 'Owner', isAdmin: true };
    const links = await loadIntegrationLinks(await freshProject(f), member, [await source(f)], { adapters: [azureDevOpsAdapter] });
    expect(links.get(f.source.id)).toEqual([{ provider: 'azure-devops', url: `https://dev.azure.com/${ado.organization}/_workitems/edit/${id}` }]);
    const guest = { kind: 'guest' as const, visitorId: 'visitor_fixture' };
    expect((await loadIntegrationLinks(f.project, guest, [await source(f)], { adapters: [azureDevOpsAdapter] })).size).toBe(0);
    await change(f, { private: true });
    expect((await loadIntegrationLinks(f.project, member, [await source(f)], { adapters: [azureDevOpsAdapter] })).size).toBe(0);
});

test('the projection escapes saved text, keeps line breaks and bounds large threads', () => {
    const context = { schemaVersion: 1 as const, contentTrust: 'untrusted' as const, identity: { commentId: 'c1', number: 4 }, title: 'Title‮<script>',
        kind: 'bug' as const, status: 'open' as const, feedback: { id: 'i1', deleted: false, text: '<img src=x onerror=alert(1)>\nline two', authorName: '<b>Ana</b>' },
        anchor: { type: 'page' as const }, source: { path: '/p' }, links: { comment: 'javascript:alert(1)', page: 'https://reviewed.example/p' },
        reproduction: {}, screenshot: { state: 'unavailable' as const }, discussion: [], notes: [] };
    const result = azureDevOpsProjection(context, 'uier-source:abc');
    expect(result.title).toBe('Title <script>');
    expect(result.html).not.toMatch(/<img|<script|javascript:|<b>Ana/);
    expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;\nline two');
    expect(result.html).toContain('<a href="https://reviewed.example/p">');
    const large = azureDevOpsProjection({ ...context, feedback: { ...context.feedback, text: 'x'.repeat(60_000) } }, 'uier-source:abc');
    expect(large.truncated).toBe(true); expect(large.html.length).toBeLessThan(10_000); expect(large.html).toContain('uier-source:abc');
});

test('a reconnect by another Microsoft user keeps the destination but waits for an explicit save', async ({ ado }) => {
    const f = await fixture(); const connection = await connect(f, ado);
    await dispatch(f);
    expect((await authorize(f, ado, { userId: randomUUID() })).result.status).toBe('connected');
    const reconnected = (await azureDevOpsConnection(await freshProject(f)))! as AzureDevOpsConnection;
    expect(reconnected).toMatchObject({ id: connection.id, enabled: false, config: { projectId: ado.projectId } });
    expect((await currentAzureDevOpsGrant(reconnected)).generation).toBe(2);
    expect((await authorize(f, ado, { userId: (await currentAzureDevOpsGrant(reconnected)).userId })).result.status).toBe('connected');
    expect((await azureDevOpsConnection(await freshProject(f)))!.enabled).toBe(false);
});
