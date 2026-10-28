import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import type { DbComment, DbScreenshot } from '../src/lib/db/schema';
import { screenshotDocumentId } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import { discoverThreadIntegrationSync, enqueueIntegrationSync, integrationPk, integrationSyncId } from '../src/lib/integrations/discovery';
import { syncPendingKey } from '../src/lib/integrations/syncSignal';
import type { IntegrationSync } from '../src/lib/integrations/model';
import { linearAdapter, beginLinearConnect, finishLinearConnect, getLinearSettings, loadLinearTeams, loadLinearStates,
    saveLinearDestination, disconnectLinear, setLinearEnabled } from '../src/lib/integrations/linear';
import { claimPk, grantId, currentLinearGrant, invalidateLinearGrant, linearAccessToken, linearConnection } from '../src/lib/integrations/linear/connection';
import { linearGraphql, LinearApiError, withLinearRequest } from '../src/lib/integrations/linear/client';
import type { LinearConnection, LinearGrant, LinearState } from '../src/lib/integrations/linear/model';
import { startLinearStub, type LinearStub } from './support/linearStub';

const test = base.extend<{ linear: LinearStub }>({ linear: async ({}, use) => {
    process.env.UIER_LOCAL = '1';
    const stub = await startLinearStub();
    Object.assign(process.env, { LINEAR_CLIENT_ID: 'linear-test-client', LINEAR_CLIENT_SECRET: 'linear-test-secret',
        LINEAR_TOKEN_KEY: Buffer.alloc(32, 19).toString('base64'), LINEAR_TOKEN_KEY_ID: 'k1',
        LINEAR_API_BASE_URL: `${stub.url}/graphql`, LINEAR_OAUTH_TOKEN_URL: `${stub.url}/oauth/token`,
        LINEAR_OAUTH_AUTHORIZE_URL: `${stub.url}/oauth/authorize`, LINEAR_OAUTH_REVOKE_URL: `${stub.url}/oauth/revoke` });
    try { await use(stub); } finally { await stub.close(); }
} });
const old = '2026-01-01T00:00:00.000Z';
const baseUrl = 'https://uier.io';

async function fixture(workspace?: { id: string; owner: Awaited<ReturnType<typeof findOrCreateUser>> }) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = workspace?.owner ?? await findOrCreateUser(`linear-owner-${id}@example.com`);
    const workspaceId = workspace?.id ?? `w_${owner.id}`;
    const store = getAppStore(); const comments = getCommentsStore();
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Linear project ${id}`,
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
async function connect(f: Fixture, linear: LinearStub) {
    const start = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    if (start.pathname.includes('/oauth/')) {
        const code = linear.code(start.searchParams.get('code_challenge')!);
        const result = await finishLinearConnect({ userId: f.owner.id, state: start.searchParams.get('state'), code, baseUrl });
        expect(result.status).toBe('connected');
    }
    await saveLinearDestination(await freshProject(f), f.owner.id, { teamId: linear.teamId, projectId: linear.projectId,
        openStateId: linear.openStateId, doneStateId: linear.doneStateId, labelIds: [linear.labelId] });
    await freshProject(f);
    return (await linearConnection(f.project))!;
}
async function ledger(f: Fixture) {
    const connection = (await linearConnection(await freshProject(f)))!;
    return (await f.store.get<IntegrationSync>(integrationPk('linear', f.project.id), integrationSyncId('linear', connection.id, f.project.id, f.source.id)))!.doc;
}
async function dispatch(f: Fixture) {
    const project = await freshProject(f); const connection = (await linearConnection(project))!; const current = await source(f);
    await discoverThreadIntegrationSync(project, current, { adapters: [linearAdapter] });
    const candidate = await ledger(f);
    await processIntegrationDelivery(candidate, baseUrl, linearAdapter);
    return ledger(f);
}
async function retry(f: Fixture) {
    const current = await ledger(f);
    await updateDoc<IntegrationSync>(current.pk, current.id, value => ({ ...value, active: true, status: 'queued', nextAttemptAt: old }));
    await processIntegrationDelivery(current, baseUrl, linearAdapter); return ledger(f);
}

test('missing deployment configuration retains off/disconnect controls and cannot erase a sibling project’s grant', async ({ linear }) => {
    const first = await fixture();
    const connection = await connect(first, linear);
    const second = await fixture({ id: first.project.workspaceId, owner: first.owner });
    await connect(second, linear);
    const claim = claimPk(linear.organizationId);
    await updateDoc<LinearConnection>(connection.pk, connection.id, row => ({ ...row, status: 'paused', statusCode: 'access_changed' }));
    const original = new Map(['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_TOKEN_KEY'].map(name => [name, process.env[name]]));
    const calls = linear.calls.length;
    try {
        for (const name of original.keys()) delete process.env[name];
        expect(await getLinearSettings(first.project, first.owner.id)).toMatchObject({ configured: false, connected: true, enabled: true });
        await setLinearEnabled(first.project, first.owner.id, false);
        expect((await linearConnection(first.project))!).toMatchObject({ enabled: false, status: 'paused', statusCode: 'access_changed' });
        await disconnectLinear(first.project, first.owner.id);
        expect((await first.store.get<LinearGrant>(connection.pk, connection.grantId))!.doc.access).toBeDefined();
        await disconnectLinear(second.project, second.owner.id);
        expect((await first.store.get<LinearGrant>(connection.pk, connection.grantId))!.doc).toMatchObject({ status: 'disconnected', access: undefined, refresh: undefined });
        expect((await first.store.get(claim, 'owner'))!.doc).toMatchObject({ status: 'disconnected' });
        expect(linear.calls).toHaveLength(calls);
    } finally {
        for (const [name, value] of original) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
});

test('OAuth uses app identity and S256, saves no binding until explicit destination selection, and consumes state once', async ({ linear }) => {
    const f = await fixture();
    const start = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect(start.searchParams.get('actor')).toBe('app'); expect(start.searchParams.get('scope')).toBe('read,write');
    expect(start.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.searchParams.get('state')).not.toContain(f.owner.id);
    const code = linear.code(start.searchParams.get('code_challenge')!);
    expect(await finishLinearConnect({ userId: f.owner.id, code, state: start.searchParams.get('state'), baseUrl })).toMatchObject({ status: 'connected' });
    expect((await freshProject(f)).integrations?.linear).toBeUndefined();
    await expect(finishLinearConnect({ userId: f.owner.id, code, state: start.searchParams.get('state'), baseUrl })).rejects.toThrow();
    const view = await getLinearSettings(f.project, f.owner.id);
    expect(view.connected).toBe(true); expect(view.enabled).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/linear-test-access|linear-test-refresh|appUserId|authorizedBy|grantId|v1\.k1/);
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.openStateId, doneStateId: linear.doneStateId });
    expect((await freshProject(f)).integrations?.linear?.connectionId).toBeTruthy();
    expect(linear.issues.size).toBe(0);
});

test('OAuth rejects foreign users, denial replays and a human actor without storing provider credentials', async ({ linear }) => {
    const f = await fixture();
    const other = await findOrCreateUser(`linear-foreign-${randomUUID()}@example.com`);
    const start = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    const code = linear.code(start.searchParams.get('code_challenge')!, { app: false });
    await expect(finishLinearConnect({ userId: other.id, code, state: start.searchParams.get('state'), baseUrl })).rejects.toThrow();
    expect(await finishLinearConnect({ userId: f.owner.id, code, state: start.searchParams.get('state'), baseUrl })).toMatchObject({ status: 'failed' });
    expect(await f.store.query<LinearGrant>({ type: 'linear-grant', pk: f.project.pk })).toHaveLength(0);
    const denied = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect(await finishLinearConnect({ userId: f.owner.id, error: 'access_denied', state: denied.searchParams.get('state'), baseUrl })).toMatchObject({ status: 'denied' });
    await expect(finishLinearConnect({ userId: f.owner.id, error: 'access_denied', state: denied.searchParams.get('state'), baseUrl })).rejects.toThrow();
});

test('two projects reuse one encrypted grant and generation-fenced refresh, and one disconnect preserves the other', async ({ linear }) => {
    const f = await fixture(); const first = await connect(f, linear);
    const secondFixture = await fixture({ id: f.project.workspaceId, owner: f.owner });
    const second = await connect(secondFixture, linear);
    expect(first.grantId).toBe(second.grantId);
    expect(linear.calls.filter(call => call.operation === 'UierLinearIdentity')).toHaveLength(1);
    const before = await currentLinearGrant(first);
    expect(before.access).not.toContain('linear-test-access'); expect(before.refresh).not.toContain('linear-test-refresh');
    await updateDoc<LinearGrant>(before.pk, before.id, current => ({ ...current, expiresAt: old }));
    const results = await Promise.allSettled([linearAccessToken(first), linearAccessToken(second)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(linear.refreshCalls).toBe(1);
    expect((await currentLinearGrant(first)).generation).toBe(before.generation + 1);
    expect(await linearAccessToken(second)).toBeTruthy();
    await disconnectLinear(f.project, f.owner.id);
    expect((await currentLinearGrant(second)).status).toBe('connected');
    expect(linear.calls.filter(call => call.operation === 'revoke')).toHaveLength(0);
    expect((await dispatch(secondFixture)).status).toBe('accepted');
    await disconnectLinear(secondFixture.project, secondFixture.owner.id);
    const wiped = await currentLinearGrant(second);
    expect(wiped.status).toBe('disconnected'); expect(wiped.access).toBeUndefined(); expect(wiped.refresh).toBeUndefined();
    expect(linear.calls.filter(call => call.operation === 'revoke')).toHaveLength(1);
});

test('an installation cannot be adopted into a different uier workspace', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    const foreign = await fixture();
    const start = new URL(await beginLinearConnect({ userId: foreign.owner.id, workspaceId: foreign.project.workspaceId, projectId: foreign.project.id, baseUrl }));
    expect(await finishLinearConnect({ userId: foreign.owner.id, state: start.searchParams.get('state'), code: linear.code(start.searchParams.get('code_challenge')!), baseUrl })).toMatchObject({ status: 'failed' });
    expect(await foreign.store.query<LinearGrant>({ type: 'linear-grant', pk: foreign.project.pk })).toHaveLength(0);
    expect((await dispatch(f)).status).toBe('accepted');
});

test('destination choices paginate, validate workflow types and reject unknown mappings', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    linear.setPages(2);
    expect((await loadLinearTeams(f.project, f.owner.id)).items).toEqual([{ id: linear.teamId, name: 'Engineering' }]);
    expect(linear.calls.filter(call => call.operation === 'UierLinearTeams' && call.variables.after === '1').length).toBeGreaterThan(0);
    expect((await loadLinearStates(f.project, f.owner.id, linear.teamId)).items).toHaveLength(2);
    await expect(saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.doneStateId, doneStateId: linear.openStateId })).rejects.toThrow();
    await expect(saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.openStateId, doneStateId: linear.doneStateId, labelIds: [randomUUID()] })).rejects.toThrow();
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
    await expect(loadLinearTeams(f.project, f.owner.id)).rejects.toThrow();
});

test('issue and discussion mirror changes while preserving human comments and unrelated labels', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    expect((await dispatch(f)).status).toBe('accepted');
    const saved = (await ledger(f)).state as LinearState; const issue = linear.issues.get(saved.issue!.issueId)!;
    expect(issue.title).toBe('The save button does not respond'); expect(issue.state.id).toBe(linear.openStateId);
    expect(issue.description).toContain('Saved feedback from uier');
    const humanLabel = randomUUID(); issue.labels.nodes.push({ id: humanLabel });
    const replyId = `item_${randomUUID()}`;
    await change(f, { resolved: true, thread: { items: [...(await source(f)).thread.items,
        { id: replyId, text: 'I can reproduce this', authorId: `user:${f.owner.id}`, createdAt: old }] } });
    expect((await dispatch(f)).status).toBe('accepted'); expect(issue.state.id).toBe(linear.doneStateId);
    expect(issue.labels.nodes).toEqual(expect.arrayContaining([{ id: humanLabel }]));
    const mirrored = [...linear.comments.values()][0]!;
    expect(mirrored.body).toContain('I can reproduce this'); expect(mirrored.user.id).toBe(linear.appUserId);
    const humanId = randomUUID(); linear.comments.set(humanId, { id: humanId, body: 'A human reply in Linear', user: { id: randomUUID() }, issue: { id: issue.id } });
    await change(f, { resolved: false, thread: { items: (await source(f)).thread.items.map(item => item.id === replyId ? { ...item, text: 'This was edited', editedAt: old } : item) } });
    expect((await dispatch(f)).status).toBe('accepted'); expect(linear.comments.get(mirrored.id)!.body).toContain('This was edited');
    expect(linear.comments.get(humanId)!.body).toBe('A human reply in Linear');
    await change(f, { thread: { items: (await source(f)).thread.items.filter(item => item.id !== replyId) } });
    expect((await dispatch(f)).status).toBe('accepted'); expect(linear.comments.has(mirrored.id)).toBe(false);
    expect(linear.comments.has(humanId)).toBe(true);
});

test('accepted creates with lost responses reconcile the persisted UUID instead of creating duplicates', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    linear.fault('UierLinearIssueCreate', 'lost');
    const uncertain = await dispatch(f);
    expect(uncertain.status).toBe('ambiguous'); expect(linear.issues.size).toBe(1);
    const issueId = (uncertain.state as LinearState).issue!.issueId;
    expect(uncertain.attempt?.metadata.issueId).toBe(issueId);
    expect((await retry(f)).status).toBe('accepted'); expect(linear.issues.size).toBe(1);
    expect(linear.calls.filter(call => call.operation === 'UierLinearIssueCreate')).toHaveLength(1);
    const replyId = `item_${randomUUID()}`;
    await change(f, { thread: { items: [...(await source(f)).thread.items, { id: replyId, text: 'A reply whose response is lost', authorId: `user:${f.owner.id}`, createdAt: old }] } });
    linear.fault('UierLinearCommentCreate', 'lost');
    expect((await dispatch(f)).status).toBe('ambiguous'); expect(linear.comments.size).toBe(1);
    expect((await retry(f)).status).toBe('accepted'); expect(linear.comments.size).toBe(1);
    expect(linear.calls.filter(call => call.operation === 'UierLinearCommentCreate')).toHaveLength(1);
});

test('privacy cleanup exports no private packet, scrubs owned content and creates a fresh generation when visible again', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    await change(f, { thread: { items: [...f.source.thread.items, { id: `reply_${randomUUID()}`, text: 'Public discussion', authorId: `user:${f.owner.id}`, createdAt: old }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    const originalId = ((await ledger(f)).state as LinearState).issue!.issueId;
    const humanId = randomUUID(); linear.comments.set(humanId, { id: humanId, body: 'Human-owned discussion', user: { id: randomUUID() }, issue: { id: originalId } });
    const before = linear.calls.length;
    await change(f, { private: true, thread: { items: [{ ...f.source.thread.items[0]!, text: 'NEW PRIVATE SECRET MUST NEVER LEAVE' }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    const removed = linear.issues.get(originalId)!;
    expect(removed.title).toBe('Removed from uier'); expect(removed.description).not.toContain('The save button'); expect(removed.trashed).toBe(true);
    expect(JSON.stringify(linear.calls.slice(before))).not.toContain('NEW PRIVATE SECRET');
    expect([...linear.comments.values()]).toEqual([linear.comments.get(humanId)!]);
    await change(f, { private: false, thread: { items: [{ ...f.source.thread.items[0]!, text: 'Visible again' }] } });
    expect((await dispatch(f)).status).toBe('accepted');
    const current = (await ledger(f)).state as LinearState;
    expect(current.issue!.issueId).not.toBe(originalId); expect(current.retired?.[0]?.issueId).toBe(originalId);
    expect(linear.issues.size).toBe(2); expect(removed.trashed).toBe(true);
});

test('GraphQL partial success and false mutation success are not accepted, and rate limits pause the shared grant', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear);
    const token = await linearAccessToken(connection);
    linear.fault('UierLinearIdentity', 'partial');
    await expect(linearGraphql(token, 'UierLinearIdentity', 'query UierLinearIdentity { viewer { id } }', {}, data => data.viewer)).rejects.toBeInstanceOf(LinearApiError);
    linear.fault('UierLinearIssueCreate', 'invalid_success');
    expect((await dispatch(f)).status).not.toBe('accepted'); expect(linear.issues.size).toBe(0);
    linear.fault('UierLinearDestination', 'rate_limit');
    const waiting = await retry(f); expect(waiting.status).toBe('waiting'); expect(waiting.lastCode).toBe('rate_limited');
    const grant = await currentLinearGrant(connection); expect(Date.parse(grant.pausedUntil!)).toBeGreaterThanOrEqual(Date.now() + 6000);
    const calls = linear.calls.length;
    await retry(f); expect(linear.calls.length).toBe(calls);
});

test('a lost refresh response replays within the provider grace and stores one new encrypted generation', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear);
    const before = await currentLinearGrant(connection);
    await updateDoc<LinearGrant>(before.pk, before.id, value => ({ ...value, expiresAt: old }));
    linear.loseNextRefresh();
    await expect(linearAccessToken(connection)).rejects.toThrow();
    const interrupted = await currentLinearGrant(connection);
    expect(interrupted.generation).toBe(before.generation); expect(interrupted.refreshStartedAt).toBeTruthy();
    expect(await linearAccessToken(connection)).toBeTruthy();
    const recovered = await currentLinearGrant(connection);
    expect(recovered.generation).toBe(before.generation + 1); expect(recovered.refreshStartedAt).toBeUndefined(); expect(linear.refreshCalls).toBe(2);
});

test('destination changes retain one binding and privacy cleanup reaches both old and new issues', async ({ linear }) => {
    const f = await fixture(); const original = await connect(f, linear);
    expect((await dispatch(f)).status).toBe('accepted');
    const former = [...linear.issues.values()][0]!;
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.openStateId, doneStateId: linear.doneStateId });
    const next = (await linearConnection(await freshProject(f)))!;
    expect(next.id).toBe(original.id);
    await change(f, { thread: { items: [{ ...f.source.thread.items[0]!, text: 'Changed after destination switch' }] } });
    expect((await dispatch(f)).status).toBe('accepted'); expect(linear.issues.size).toBe(2);
    expect(former.title).toBe('The save button does not respond'); expect(former.project?.id).toBe(linear.projectId);
    expect([...linear.issues.values()].find(issue => issue.id !== former.id)?.project).toBeNull();
    await change(f, { private: true }); expect((await dispatch(f)).status).toBe('accepted');
    expect([...linear.issues.values()].every(issue => issue.trashed && issue.title === 'Removed from uier')).toBe(true);
});

test('opt-in screenshot upload keeps bytes server-side, reuses its revision and reconciles a lost PUT response', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, projectId: linear.projectId, openStateId: linear.openStateId,
        doneStateId: linear.doneStateId, screenshots: true });
    await freshProject(f);
    const revision = randomUUID(); const bytes = Buffer.from('test-image-bytes');
    const screenshot: DbScreenshot = { type: 'screenshot', id: screenshotDocumentId(f.source.id), domain: f.source.domain, commentId: f.source.id,
        contentType: 'image/png', width: 1, height: 1, bytes: bytes.length, revision, data: bytes.toString('base64'), createdAt: old };
    await f.comments.createScreenshot(screenshot);
    await change(f, { screenshot: { contentType: 'image/png', width: 1, height: 1, bytes: bytes.length, revision } });
    linear.loseNextUpload();
    const uncertain = await dispatch(f); expect(uncertain.status).toBe('ambiguous'); expect(uncertain.attempt?.step).toBe('upload_screenshot');
    expect((await retry(f)).status).toBe('accepted');
    expect(linear.calls.filter(call => call.operation === 'UierLinearFileUpload')).toHaveLength(1);
    expect(linear.calls.filter(call => call.operation === 'upload_put')).toHaveLength(1);
    expect(linear.calls.find(call => call.operation === 'upload_put')!.authorization).toBeUndefined();
    expect([...linear.issues.values()][0]!.description).toContain(`${linear.url}/asset/`);
    expect(JSON.stringify((await ledger(f)).state)).not.toContain('signature=');
    expect(JSON.stringify((await ledger(f)).state)).not.toContain(bytes.toString('base64'));
    expect([...linear.assets.values()][0]!.bytes).toEqual(bytes);
    await change(f, { resolved: true }); expect((await dispatch(f)).status).toBe('accepted');
    expect(linear.calls.filter(call => call.operation === 'UierLinearFileUpload')).toHaveLength(1);
});

test('turned-off or removed-admin bindings make no provider calls and protect existing external content', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear);
    await setLinearEnabled(f.project, f.owner.id, false);
    const before = linear.calls.length;
    expect((await dispatch(f)).status).toBe('waiting'); expect(linear.calls).toHaveLength(before);
    await setLinearEnabled(f.project, f.owner.id, true);
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
    const stopped = await retry(f); expect(stopped.status).toBe('suppressed'); expect(linear.calls).toHaveLength(before);
});

test('request, complexity and endpoint exhaustion stop subsequent requests using epoch-millisecond resets', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear); const token = await linearAccessToken(connection);
    for (const kind of ['requests', 'complexity', 'endpoint-requests']) {
        const reset = Date.now() + 60_000;
        const bucketKey = `test_${kind}_${randomUUID()}`;
        linear.headers('UierLinearIdentity', { [`X-RateLimit-${kind}-Remaining`]: '0', [`X-RateLimit-${kind}-Reset`]: String(reset) });
        await linearGraphql(token, 'UierLinearIdentity', 'query UierLinearIdentity { viewer { id } }', {}, data => data.viewer, undefined, { bucketKey });
        const before = linear.calls.length;
        try {
            await linearGraphql(token, 'UierLinearIdentity', 'query UierLinearIdentity { viewer { id } }', {}, data => data.viewer, undefined, { bucketKey });
            throw new Error('The exhausted budget unexpectedly sent a request');
        } catch (error) {
            expect(error).toBeInstanceOf(LinearApiError); expect((error as LinearApiError).code).toBe('rate_limited');
            expect(Date.parse((error as LinearApiError).retryAt!)).toBe(reset);
        }
        expect(linear.calls.length).toBe(before);
    }
});

test('a private transition while waiting for provider pacing is rechecked before any GraphQL request', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear); const grant = await currentLinearGrant(connection);
    const candidate = await enqueueIntegrationSync(f.project, 'linear', connection.id, f.source.id, 1);
    await withLinearRequest(`${grant.clientId}:${grant.appUserId}`, AbortSignal.timeout(5000), async () => undefined);
    const before = linear.calls.length;
    const processing = processIntegrationDelivery(candidate, baseUrl, linearAdapter);
    await new Promise(resolve => setTimeout(resolve, 20));
    await change(f, { private: true });
    await processing;
    expect(linear.calls.length).toBe(before);
    expect((await ledger(f)).status).toBe('waiting');
    expect((await ledger(f)).lastCode).toBe('projection_changed');
});

test('a 401 followed by refresh response loss keeps the original pair for grace-period recovery', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear);
    const original = await currentLinearGrant(connection);
    linear.fault('UierLinearDestination', 'unauthenticated'); linear.loseNextRefresh();
    const waiting = await dispatch(f);
    expect(waiting.status).toBe('waiting'); expect(waiting.lastCode).toBe('credential_refresh_pending');
    const retained = await currentLinearGrant(connection);
    expect(retained.status).toBe('connected'); expect(retained.access).toBe(original.access);
    expect(retained.refresh).toBe(original.refresh); expect(retained.refreshStartedAt).toBeTruthy();
    expect((await retry(f)).status).toBe('accepted'); expect(linear.refreshCalls).toBe(2);
    expect((await currentLinearGrant(connection)).generation).toBe(original.generation + 1);
});

test('a stale invalidation cannot wipe a newer grant or pause its current binding', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear);
    const stale = await currentLinearGrant(connection);
    await updateDoc<LinearGrant>(stale.pk, stale.id, current => ({ ...current, generation: current.generation + 1 }));
    await invalidateLinearGrant(stale, 'old_auth_failure');
    expect((await currentLinearGrant(connection)).status).toBe('connected');
    expect((await linearConnection(await freshProject(f)))!.status).toBe('connected');
});

test('disconnect wipes local ciphertext even when an obsolete key cannot revoke the remote token', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear);
    const key = process.env.LINEAR_TOKEN_KEY;
    try {
        process.env.LINEAR_TOKEN_KEY = Buffer.alloc(32, 92).toString('base64');
        await disconnectLinear(f.project, f.owner.id);
        const grant = await currentLinearGrant(connection);
        expect(grant.status).toBe('disconnected'); expect(grant.access).toBeUndefined(); expect(grant.refresh).toBeUndefined();
        expect((await freshProject(f)).integrations?.linear).toBeUndefined();
    } finally { process.env.LINEAR_TOKEN_KEY = key; }
});


test('hard deletion after a destination switch scrubs both durable issue generations', async ({ linear }) => {
    const f = await fixture(); const connection = await connect(f, linear); await dispatch(f);
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.openStateId, doneStateId: linear.doneStateId });
    await change(f, { resolved: true }); await dispatch(f); expect(linear.issues.size).toBe(2);
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.delete(f.source.domain, f.source.id, stored.etag)).toBe('ok');
    const queued = await enqueueIntegrationSync(await freshProject(f), 'linear', connection.id, f.source.id, stored.comment.syncVersion! + 1,
        { deletion: { version: stored.comment.syncVersion! + 1, deletedAt: new Date().toISOString() } });
    await processIntegrationDelivery(queued, baseUrl, linearAdapter);
    expect((await ledger(f)).tombstoned).toBe(true);
    expect([...linear.issues.values()].every(issue => issue.trashed && issue.title === 'Removed from uier')).toBe(true);
});

test('an uncertain replacement upload cannot block known issue privacy cleanup or another thread', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear); await dispatch(f);
    const originalId = ((await ledger(f)).state as LinearState).issue!.issueId;
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, projectId: linear.projectId,
        openStateId: linear.openStateId, doneStateId: linear.doneStateId, screenshots: true }); await freshProject(f);
    const revision = randomUUID(); const bytes = Buffer.from('new-evidence-bytes');
    await f.comments.createScreenshot({ type: 'screenshot', id: screenshotDocumentId(f.source.id), domain: f.source.domain, commentId: f.source.id,
        contentType: 'image/png', width: 1, height: 1, bytes: bytes.length, revision, data: bytes.toString('base64'), createdAt: old });
    await change(f, { screenshot: { contentType: 'image/png', width: 1, height: 1, bytes: bytes.length, revision } });
    linear.loseNextUpload(); expect((await dispatch(f)).attempt?.step).toBe('upload_screenshot');
    for (const asset of linear.assets.values()) asset.bytes = undefined;
    await change(f, { private: true, thread: { items: [{ ...f.source.thread.items[0]!, text: 'DO NOT EXPORT THIS PRIVATE CHANGE' }] } });
    const before = linear.calls.length; const cleaned = await dispatch(f);
    expect(cleaned.status).toBe('ambiguous'); expect(cleaned.lastCode).toBe('cleanup_incomplete');
    expect(linear.issues.get(originalId)).toMatchObject({ title: 'Removed from uier', trashed: true });
    expect((cleaned.state as LinearState).issue!.uncertainUpload).toBeDefined();
    expect(JSON.stringify(linear.calls.slice(before))).not.toContain('DO NOT EXPORT THIS PRIVATE CHANGE');
    expect((await linearConnection(await freshProject(f)))!).toMatchObject({ status: 'connected', enabled: true });
    const next: DbComment = { ...f.source, id: `another_${randomUUID()}`, syncKey: undefined, private: false };
    next.syncKey = syncPendingKey(next.domain, next.id); await f.comments.create(next);
    const connection = (await linearConnection(f.project))!;
    const queued = await enqueueIntegrationSync(f.project, 'linear', connection.id, next.id, 1);
    await processIntegrationDelivery(queued, baseUrl, linearAdapter);
    expect((await f.store.get<IntegrationSync>(queued.pk, queued.id))!.doc.status).toBe('accepted');
});

test('a failed first attachment wipes its new grant and releases an uncommitted installation claim', async ({ linear }) => {
    const f = await fixture();
    const start = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    const clone = globalThis.structuredClone;
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        if (value && typeof value === 'object' && 'type' in value && value.type === 'linear-connection') throw new Error('Fixture connection persistence failed');
        return clone(value, options);
    }) as typeof clone;
    try {
        expect((await finishLinearConnect({ userId: f.owner.id, state: start.searchParams.get('state'), baseUrl,
            code: linear.code(start.searchParams.get('code_challenge')!) })).status).toBe('failed');
    } finally { globalThis.structuredClone = clone; }
    const grants = await f.store.query<LinearGrant>({ type: 'linear-grant', pk: f.project.pk });
    expect(grants).toHaveLength(1); expect(grants[0]!.access).toBeUndefined(); expect(grants[0]!.refresh).toBeUndefined();
    expect((await f.store.get(claimPk(linear.organizationId), 'owner'))!.doc).toMatchObject({ status: 'vacant' });
    const other = await fixture(); expect((await connect(other, linear)).grantId).toBeTruthy();
});

test('an inaccessible retired authority blocks only that cleanup ledger while reachable copies and threads progress', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear); await dispatch(f);
    await saveLinearDestination(f.project, f.owner.id, { teamId: linear.teamId, openStateId: linear.openStateId, doneStateId: linear.doneStateId });
    await change(f, { resolved: true }); await dispatch(f);
    const queued = await ledger(f); const saved = queued.state as LinearState; const oldId = saved.retired![0]!.issueId; const currentId = saved.issue!.issueId;
    await updateDoc<IntegrationSync>(queued.pk, queued.id, row => ({ ...row, state: { ...row.state,
        retired: (row.state as LinearState).retired!.map(value => ({ ...value, grantId: `missing_${randomUUID()}` })) } }));
    await change(f, { private: true }); const cleaned = await dispatch(f);
    expect(cleaned.status).toBe('ambiguous'); expect(cleaned.lastCode).toBe('cleanup_incomplete');
    expect(linear.issues.get(currentId)).toMatchObject({ trashed: true, title: 'Removed from uier' });
    expect(linear.issues.get(oldId)!.trashed).toBe(false);
    expect((await linearConnection(await freshProject(f)))!).toMatchObject({ enabled: true, status: 'connected' });
    const next: DbComment = { ...f.source, id: `independent_${randomUUID()}`, private: false };
    next.syncKey = syncPendingKey(next.domain, next.id); await f.comments.create(next);
    const connection = (await linearConnection(f.project))!;
    const work = await enqueueIntegrationSync(f.project, 'linear', connection.id, next.id, 1);
    await processIntegrationDelivery(work, baseUrl, linearAdapter);
    expect((await f.store.get<IntegrationSync>(work.pk, work.id))!.doc.status).toBe('accepted');
});

test('failed reconnect attachment preserves a grant still used by an authorized sibling', async ({ linear }) => {
    const f = await fixture(); const first = await connect(f, linear);
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); await connect(sibling, linear);
    await updateDoc<LinearConnection>(first.pk, first.id, value => ({ ...value, status: 'needs_reconnect', statusCode: 'member_left' }));
    const start = new URL(await beginLinearConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    const clone = globalThis.structuredClone;
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        if (value && typeof value === 'object' && 'type' in value && value.type === 'linear-connection' && 'id' in value && value.id === first.id
            && 'status' in value && value.status === 'connected') throw new Error('Fixture reconnect persistence failed');
        return clone(value, options);
    }) as typeof clone;
    try {
        expect((await finishLinearConnect({ userId: f.owner.id, state: start.searchParams.get('state'), baseUrl,
            code: linear.code(start.searchParams.get('code_challenge')!) })).status).toBe('failed');
    } finally { globalThis.structuredClone = clone; }
    const retained = await currentLinearGrant(first); expect(retained.access).toBeDefined(); expect(retained.refresh).toBeDefined();
    expect(retained.status).toBe('connected'); expect((await dispatch(sibling)).status).toBe('accepted');
});


test('a visible-again thread starts a fresh issue after an interrupted scrub and retains the old cleanup target', async ({ linear }) => {
    const f = await fixture(); await connect(f, linear); await dispatch(f);
    const original = ((await ledger(f)).state as LinearState).issue!.issueId;
    await change(f, { private: true }); linear.fault('UierLinearIssueUpdate', 'lost');
    expect((await dispatch(f)).attempt?.step).toBe('scrub_issue');
    await change(f, { private: false, thread: { items: [{ ...f.source.thread.items[0]!, text: 'Visible after interrupted cleanup' }] } });
    await dispatch(f); // The prior transport failure retains its normal backoff.
    const resumed = await retry(f); expect(resumed.status).toBe('accepted');
    const state = resumed.state as LinearState; expect(state.issue!.issueId).not.toBe(original);
    expect(state.retired!.some(value => value.issueId === original && value.cleanupStarted)).toBe(true);
    expect(linear.issues.get(state.issue!.issueId)!.title).toBe('Visible after interrupted cleanup');
    await change(f, { private: true }); expect((await dispatch(f)).status).toBe('accepted');
    expect([...linear.issues.values()].every(issue => issue.trashed && issue.title === 'Removed from uier')).toBe(true);
});


test('a stale reservation without a committed grant can be recovered by a fresh authorized setup', async ({ linear }) => {
    const abandoned = await fixture(); const f = await fixture();
    await f.store.create({ type: 'linear-installation-claim', provider: 'linear', pk: claimPk(linear.organizationId), id: 'owner',
        workspaceId: abandoned.project.workspaceId, grantId: grantId(linear.organizationId), organizationId: linear.organizationId,
        clientId: process.env.LINEAR_CLIENT_ID!, status: 'reserved', reservedBy: 'interrupted-setup',
        operation: { id: 'interrupted-setup', until: old }, createdAt: old, updatedAt: old });
    expect((await connect(f, linear)).workspaceId).toBe(f.project.workspaceId);
    expect((await f.store.get(claimPk(linear.organizationId), 'owner'))!.doc).toMatchObject({ status: 'active', workspaceId: f.project.workspaceId });
});
