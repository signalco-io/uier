import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, updateDoc, type AppStore, type DocQuery } from '../src/lib/app/store';
import { memberId, projectRefPk, workspacePk, type AppDoc, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { findOrCreateUser } from '../src/lib/app/users';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, deleteProjectCommentItem, editProjectCommentItem, editProjectCommentText, replyToProjectComment, setProjectCommentPrivate, setProjectCommentResolved } from '../src/lib/review/comments';
import { memberActor } from '../src/lib/review/actor';
import { enqueueIntegrationSync, integrationSyncId } from '../src/lib/integrations/discovery';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import type { IntegrationSync } from '../src/lib/integrations/model';
import { beginGitHubConnect, finishGitHubConnect, finishGitHubSetup, getGitHubSettings, listGitHubRepositories, saveGitHubRepository, disconnectGitHub } from '../src/lib/integrations/github/connection';
import { createGitHubAdapter } from '../src/lib/integrations/github/adapter';
import { githubConfig, githubId, isGitHubConfigured } from '../src/lib/integrations/github/config';
import { githubIssueProjection, githubOwnershipMarker } from '../src/lib/integrations/github/issue';
import { resolveGitHubCreate } from '../src/lib/integrations/github/recovery';
import { githubAppPk, receiveGitHubWebhook } from '../src/lib/integrations/github/webhook';
import { githubInstallationPk, type GitHubConnection, type GitHubInstallation, type GitHubState } from '../src/lib/integrations/github/model';
import { startGitHubStub } from './support/githubStub';

const variables = ['UIER_LOCAL', 'UIER_GITHUB_APP_ID', 'UIER_GITHUB_APP_SLUG', 'UIER_GITHUB_CLIENT_ID', 'UIER_GITHUB_CLIENT_SECRET',
    'UIER_GITHUB_PRIVATE_KEY', 'UIER_GITHUB_SETUP_KEY', 'UIER_GITHUB_WEBHOOK_SECRET', 'UIER_GITHUB_API_BASE_URL', 'UIER_GITHUB_OAUTH_BASE_URL'];
const previous = new Map(variables.map(name => [name, process.env[name]]));
let stub: Awaited<ReturnType<typeof startGitHubStub>>;
const baseUrl = 'https://uier.io';
const origin = 'https://reviewed.example';
const request = new Request('http://127.0.0.1/api/review');

test.beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    stub = await startGitHubStub(keys.publicKey);
    Object.assign(process.env, { UIER_LOCAL: '1', UIER_GITHUB_APP_ID: '999', UIER_GITHUB_APP_SLUG: 'uier-test',
        UIER_GITHUB_CLIENT_ID: 'Iv1.uier-test', UIER_GITHUB_CLIENT_SECRET: 'test-client-secret',
        UIER_GITHUB_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        UIER_GITHUB_SETUP_KEY: randomBytes(32).toString('base64'), UIER_GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
        UIER_GITHUB_API_BASE_URL: stub.url, UIER_GITHUB_OAUTH_BASE_URL: stub.url });
});
test.afterAll(async () => {
    await stub.close();
    for (const [name, value] of previous) if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

async function localProject() {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const user = await findOrCreateUser(`github-${suffix}@example.com`);
    const workspaceId = `w_${user.id}`;
    const now = new Date().toISOString();
    const project: DbProject = { type: 'project', pk: workspacePk(workspaceId), id: suffix, workspaceId,
        name: 'GitHub project', urls: [origin], createdBy: user.id, status: 'active', access: 'guests', createdAt: now, updatedAt: now };
    const store = getAppStore();
    await store.create(project);
    await store.create<DbProjectRef>({ type: 'project-ref', pk: projectRefPk(project.id), id: project.id, workspaceId });
    await store.create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, userId: user.id, workspaceId,
        email: user.email, role: 'admin', projects: 'all', createdAt: now });
    return { user, project, input: { userId: user.id, workspaceId, projectId: project.id }, actor: (await memberActor(project, user.id))! };
}

async function authorized(f: Awaited<ReturnType<typeof localProject>>, installationId = '101') {
    const install = new URL(await beginGitHubConnect({ ...f.input, baseUrl }));
    const setup = await finishGitHubSetup({ userId: f.user.id, state: install.searchParams.get('state'), installationId, setupAction: 'install', baseUrl });
    const oauth = new URL(setup.url);
    stub.faults.challenge = oauth.searchParams.get('code_challenge')!;
    const result = await finishGitHubConnect({ userId: f.user.id, state: oauth.searchParams.get('state'), code: randomUUID(), baseUrl });
    return { result, oauth, install };
}

async function fixture(repositoryId = '201') {
    const f = await localProject();
    await getAppStore().delete(githubAppPk('999'), 'content-rate');
    await getAppStore().delete(githubAppPk('999'), 'user_7');
    Object.assign(stub.faults, { loseIssueResponse: 0, loseCommentResponse: 0, rateLimit: 0, invalidToken: 0,
        installationUnavailable: false, adminRepository: true, userInstallation: true, oauthDenied: false, githubUserId: 7, makePublicAfterIssueUpdate: false });
    const setup = (await authorized(f)).result;
    expect(setup.status).toBe('connected');
    const connection = await saveGitHubRepository({ ...f.input, setupReceipt: setup.setupReceipt!, repositoryId, confirmPublic: false });
    const project = (await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc;
    const comment = await createProjectComment(request, project, f.actor, { text: 'Keep exact @reviewer feedback', origin, path: '/page', kind: 'feedback', position: { type: 'page' } });
    return { ...f, project, connection, comment, clock: { offset: 0 }, adapter: createGitHubAdapter({ writeIntervalMs: 0 }) };
}

async function sync(f: Awaited<ReturnType<typeof fixture>>, options: { realTime?: boolean } = {}) {
    const source = (await getCommentsStore().get(f.comment.domain, f.comment.id))?.comment;
    const ledger = await enqueueIntegrationSync(f.project, 'github', f.connection.id, f.comment.id, source?.syncVersion ?? f.comment.syncVersion ?? 1, { cleanup: source?.private });
    if (!options.realTime) f.clock.offset += 90_000;
    await processIntegrationDelivery(ledger, baseUrl, f.adapter, { now: () => Date.now() + (options.realTime ? 0 : f.clock.offset) });
    return (await getAppStore().get<IntegrationSync>(ledger.pk, ledger.id))!.doc;
}
const state = (ledger: IntegrationSync) => ledger.state as unknown as GitHubState;
const external = (ledger: IntegrationSync) => {
    const destination = state(ledger).active!;
    return stub.issues.get(Number(destination.repositoryId))!.find(issue => issue.id === Number(destination.issue!.id))!;
};
async function switchRepository(f: Awaited<ReturnType<typeof fixture>>) {
    const setup = await authorized(f);
    f.connection = await saveGitHubRepository({ ...f.input, setupReceipt: setup.result.setupReceipt!, repositoryId: '202', confirmPublic: false });
    f.project = (await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc;
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'Current repository copy');
    return sync(f);
}
async function retryFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const id = integrationSyncId('github', f.connection.id, f.project.id, f.comment.id);
    await updateDoc<IntegrationSync>(`github:${f.project.id}`, id, row => ({ ...row, active: true, status: 'queued', nextAttemptAt: '2026-01-01T00:00:00.000Z' }));
    return sync(f);
}

function signed(payload: unknown, event = 'installation', delivery = randomUUID()) {
    const raw = JSON.stringify(payload);
    const headers = new Headers({ 'X-GitHub-Event': event, 'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex')}` });
    return { raw, headers };
}

test('installation and user authorization are separate single-use stages with PKCE and no pre-save sends', async () => {
    const f = await localProject();
    const { result, oauth, install } = await authorized(f);
    expect(install.pathname).toBe('/apps/uier-test/installations/new');
    expect(oauth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(oauth.searchParams.get('redirect_uri')).toBe('https://uier.io/app/github/callback');
    expect(result).toMatchObject({ status: 'connected', workspaceId: f.project.workspaceId, projectId: f.project.id });
    expect((await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc.integrations).toBeUndefined();
    await expect(finishGitHubSetup({ userId: f.user.id, state: install.searchParams.get('state'), installationId: '101', baseUrl })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(finishGitHubConnect({ userId: f.user.id, state: oauth.searchParams.get('state'), code: 'again', baseUrl })).rejects.toMatchObject({ code: 'invalid_state' });
    const settings = await getGitHubSettings(f.project, f.user.id, result.setupReceipt);
    expect(settings.setup?.receipt).toBe(result.setupReceipt);
    expect(JSON.stringify(settings)).not.toMatch(/user-token|never-persist-refresh|v1\.k1\./);
    const choices = await listGitHubRepositories({ ...f.input, setupReceipt: result.setupReceipt! });
    expect(choices.repositories).toEqual([{ id: '201', fullName: 'acme/repo-1', private: true }, { id: '202', fullName: 'acme/repo-2', private: true }]);
    const rows = await getAppStore().query({ type: 'github-setup', pk: `user:${f.user.id}` });
    expect(JSON.stringify(rows)).not.toMatch(/user-token|never-persist-refresh/);
});

test('forged installation hints and repository privileges cannot create a binding; denial consumes state', async () => {
    const f = await localProject();
    const forged = await authorized(f, '999999');
    expect(forged.result.status).toBe('failed');
    const install = new URL(await beginGitHubConnect({ ...f.input, baseUrl }));
    const setup = await finishGitHubSetup({ userId: f.user.id, state: install.searchParams.get('state'), installationId: '101', baseUrl });
    const oauth = new URL(setup.url);
    expect((await finishGitHubConnect({ userId: f.user.id, state: oauth.searchParams.get('state'), error: 'access_denied', baseUrl })).status).toBe('denied');
    const allowed = await authorized(f);
    stub.faults.adminRepository = false;
    await expect(saveGitHubRepository({ ...f.input, setupReceipt: allowed.result.setupReceipt!, repositoryId: '201', confirmPublic: false })).rejects.toMatchObject({ code: 'repository_not_authorized' });
    stub.faults.adminRepository = true;
    expect((await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc.integrations).toBeUndefined();
    expect(() => githubId('9007199254740993')).toThrow();
});

test('a second project reuses a workspace installation only after fresh GitHub authorization and repository selection', async () => {
    const f = await fixture();
    const store = getAppStore();
    const project: DbProject = { ...f.project, id: randomUUID().replaceAll('-', '').slice(0, 12), integrations: undefined };
    await store.create(project);
    await store.create<DbProjectRef>({ type: 'project-ref', pk: projectRefPk(project.id), id: project.id, workspaceId: project.workspaceId });
    const input = { ...f.input, projectId: project.id, baseUrl, installationId: '101' };
    const settings = await getGitHubSettings(project, f.user.id);
    expect(settings.installations).toEqual([{ id: '101', accountName: 'acme' }]);
    const oauth = new URL(await beginGitHubConnect(input));
    expect(oauth.pathname).toBe('/login/oauth/authorize');
    expect(oauth.searchParams.get('code_challenge_method')).toBe('S256');
    stub.faults.challenge = oauth.searchParams.get('code_challenge')!;
    const result = await finishGitHubConnect({ userId: f.user.id, state: oauth.searchParams.get('state'), code: randomUUID(), baseUrl });
    expect(result.status).toBe('connected');
    expect((await store.get<DbProject>(project.pk, project.id))!.doc.integrations).toBeUndefined();
    await saveGitHubRepository({ ...input, setupReceipt: result.setupReceipt!, repositoryId: '201', confirmPublic: false });
    expect((await store.get<DbProject>(project.pk, project.id))!.doc.integrations?.github).toBeDefined();
    expect((await store.get<DbProject>(f.project.pk, f.project.id))!.doc.integrations?.github).toEqual(f.project.integrations?.github);

    await expect(beginGitHubConnect({ ...input, installationId: '999999' })).rejects.toMatchObject({ code: 'installation_unavailable' });
    const foreign = await localProject();
    expect((await getGitHubSettings(foreign.project, foreign.user.id)).installations).toEqual([]);
    await expect(beginGitHubConnect({ ...foreign.input, baseUrl, installationId: '101' })).rejects.toMatchObject({ code: 'installation_unavailable' });

    const revoked = new URL(await beginGitHubConnect(input));
    stub.faults.challenge = revoked.searchParams.get('code_challenge')!;
    stub.faults.userInstallation = false;
    expect((await finishGitHubConnect({ userId: f.user.id, state: revoked.searchParams.get('state'), code: randomUUID(), baseUrl })).status).toBe('failed');
    stub.faults.userInstallation = true;
});

test('real HTTP JWT/token transport mirrors issue, status and discussion while preserving human comments', async () => {
    const f = await fixture();
    let ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'accepted', processedVersion: 1, attempt: undefined });
    expect(external(ledger).body).toContain('Keep exact @reviewer feedback');
    expect(external(ledger).title).not.toContain('@reviewer');
    const expectedTitle = external(ledger).title;
    external(ledger).title = 'An external title change';
    await enqueueIntegrationSync(f.project, 'github', f.connection.id, f.comment.id, 1, { requestId: randomUUID() });
    ledger = await sync(f);
    expect(external(ledger).title).toBe(expectedTitle);
    const reply = await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Saved discussion' });
    await setProjectCommentResolved(f.project, f.actor, f.comment.id, true);
    ledger = await sync(f);
    expect(external(ledger).state).toBe('closed');
    expect(external(ledger).comments).toHaveLength(1);
    expect(external(ledger).comments[0]!.body).toContain('Saved discussion');
    external(ledger).comments.push({ id: 999999, body: 'Keep human discussion', user: { id: 88, type: 'User' } });
    await deleteProjectCommentItem(f.project, f.actor, f.comment.id, reply.thread.items[1]!.id);
    ledger = await sync(f);
    expect(external(ledger).comments[0]!.body).toContain('deleted in uier');
    expect(external(ledger).comments[1]!.body).toBe('Keep human discussion');
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'New current source');
    ledger = await sync(f);
    expect(external(ledger).body).toContain('New current source');
    expect(f.adapter.externalLink!(f.connection, ledger)).toBe(`https://github.com/acme/repo-1/issues/${external(ledger).number}`);
    expect(f.adapter.validateExternalLink!(new URL('https://evil.example/issue'), f.connection, ledger)).toBe(false);
    expect(JSON.stringify(ledger)).not.toMatch(/Saved discussion|New current source|installation-token/);
});

test('lost issue and comment responses reconcile the committed objects without resending their POST', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    const before = stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues').length;
    let ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'create_response_unknown' });
    expect(ledger.attempt?.step).toBe('create_issue');
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues')).toHaveLength(before + 1);
    stub.faults.loseCommentResponse = 1;
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Lost reply response' });
    ledger = await sync(f);
    expect(ledger.status).toBe('waiting');
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(external(ledger).comments).toHaveLength(1);
});

test('privacy cleanup reconciles uncertain creates, redacts owned content and deletes only owned replies', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
    const start = stub.calls.length;
    ledger = await sync(f);
    expect(ledger.status).toBe('suppressed');
    const issue = external(ledger);
    expect(issue.title).toBe('Removed from uier');
    expect(issue.state).toBe('closed');
    expect(issue.body).not.toContain('Keep exact');
    expect(JSON.stringify(stub.calls.slice(start))).not.toContain('Keep exact');
    const other = await fixture();
    await replyToProjectComment(request, other.project, other.actor, other.comment.id, { text: 'Copied reply' });
    let otherLedger = await sync(other);
    external(otherLedger).comments.push({ id: 888888, body: 'Human reply stays', user: { id: 88, type: 'User' } });
    await setProjectCommentPrivate(other.project, other.actor, other.comment.id, true);
    otherLedger = await sync(other);
    expect(external(otherLedger).comments).toEqual([{ id: 888888, body: 'Human reply stays', user: { id: 88, type: 'User' } }]);
});

test('repository switches preserve and reconcile old destinations before publishing or cleaning new copies', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    const nextSetup = await authorized(f);
    f.connection = await saveGitHubRepository({ ...f.input, setupReceipt: nextSetup.result.setupReceipt!, repositoryId: '202', confirmPublic: false });
    f.project = (await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc;
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'New repository copy');
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(state(ledger).retired).toHaveLength(1);
    expect(state(ledger).retired[0]!.repositoryId).toBe('201');
    expect(state(ledger).active!.repositoryId).toBe('202');
    expect(state(ledger).retired[0]!.issue).toBeDefined();
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
    ledger = await sync(f);
    expect(ledger.status).toBe('suppressed');
    for (const destination of [...state(ledger).retired, state(ledger).active!]) {
        const issue = stub.issues.get(Number(destination.repositoryId))!.find(issue => issue.id === Number(destination.issue!.id))!;
        expect(issue.title).toBe('Removed from uier');
        expect(issue.body).not.toContain('copy');
        expect(destination.cleaned).toBe(true);
    }
});

test('an unavailable retired repository cannot block current cleanup and fully cleaned targets need no later access', async () => {
    const f = await fixture();
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Owned discussion in both destinations' });
    await sync(f);
    let ledger = await switchRepository(f);
    const current = external(ledger);
    const retired = state(ledger).retired[0]!;
    const previous = stub.issues.get(201)!.find(issue => String(issue.id) === retired.issue!.id)!;
    await updateDoc<GitHubInstallation>(githubInstallationPk('999', '101'), 'installation', row => ({ ...row, deniedRepositories: ['201'] }));
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
    const start = stub.calls.length;
    ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_blocked' });
    expect(current).toMatchObject({ title: 'Removed from uier', state: 'closed', comments: [] });
    expect(current.body).not.toContain('Current repository copy');
    expect(previous.body).toContain('Keep exact');
    expect(state(ledger).active?.cleaned).toBe(true);
    expect(state(ledger).retired[0]?.cleaned).not.toBe(true);
    expect((await getAppStore().get<GitHubConnection>(f.connection.pk, f.connection.id))!.doc.status).toBe('connected');
    expect(stub.calls.slice(start).some(call => call.path.startsWith('/repos/acme/repo-1/'))).toBe(false);
    await updateDoc<GitHubInstallation>(githubInstallationPk('999', '101'), 'installation', row => ({ ...row, deniedRepositories: [] }));
    ledger = await retryFixture(f);
    expect(ledger.status).toBe('suppressed');
    expect(previous.comments).toEqual([]);
    expect(state(ledger).retired[0]?.cleaned).toBe(true);
    await updateDoc<GitHubInstallation>(githubInstallationPk('999', '101'), 'installation', row => ({ ...row, deniedRepositories: ['201', '202'] }));
    const complete = stub.calls.length;
    ledger = await retryFixture(f);
    expect(ledger.status).toBe('suppressed');
    expect(stub.calls).toHaveLength(complete);
});

test('unknown old creates are retained while known current copies are removed, then remain reviewable without blind recreation', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    const lost = structuredClone(ledger.attempt!);
    const original = stub.issues.get(201)!.find(issue => issue.body?.includes(state(ledger).active!.marker))!;
    // Persist a recovered identity, switch normally, then restore the older crash receipt to
    // exercise cleanup of a retained mixed-generation ledger from an interrupted migration.
    await updateDoc<IntegrationSync>(ledger.pk, ledger.id, row => {
        const saved = structuredClone(row.state) as unknown as GitHubState;
        saved.active!.issue = { id: String(original.id), number: original.number, url: original.html_url };
        return { ...row, state: saved, attempt: undefined };
    });
    ledger = await retryFixture(f);
    expect(ledger.status).toBe('accepted');
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Reachable new discussion' });
    ledger = await switchRepository(f);
    const current = external(ledger);
    await updateDoc<IntegrationSync>(ledger.pk, ledger.id, row => {
        const saved = structuredClone(row.state) as unknown as GitHubState;
        saved.retired[0]!.issue = undefined;
        return { ...row, state: saved, attempt: lost };
    });
    stub.issues.set(201, stub.issues.get(201)!.filter(issue => issue.id !== original.id));
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
    const posts = stub.calls.filter(call => call.method === 'POST' && /\/issues(?:\/\d+\/comments)?$/.test(call.path)).length;
    ledger = await sync(f);
    expect(current).toMatchObject({ title: 'Removed from uier', state: 'closed', comments: [] });
    expect(ledger.attempt).toBeUndefined();
    expect(state(ledger).retired[0]!.uncertainCreates?.[0]).toMatchObject({ operationId: lost.operationId, metadata: { revision: 1 } });
    for (let index = 0; index < 2; index++) ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_needs_review' });
    expect(stub.calls.filter(call => call.method === 'POST' && /\/issues(?:\/\d+\/comments)?$/.test(call.path))).toHaveLength(posts);
    expect(JSON.stringify(ledger)).not.toMatch(/Reachable new discussion|Current repository copy|Keep exact/);
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, false);
    ledger = await retryFixture(f);
    expect(ledger.status).toBe('ambiguous');
    expect(stub.calls.filter(call => call.method === 'POST' && /\/issues(?:\/\d+\/comments)?$/.test(call.path))).toHaveLength(posts);
    await resolveGitHubCreate({ ...f.input, ledgerId: ledger.id, operationId: lost.operationId, confirmAbsent: true });
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(state(ledger).retired[0]!.uncertainCreates).toEqual([]);
});

test('changed ownership of one comment cannot block redaction or removal of other owned discussion', async () => {
    const f = await fixture();
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'First owned reply' });
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Second owned reply' });
    let ledger = await sync(f);
    const issue = external(ledger);
    const changed = issue.comments[0]!;
    changed.body = 'This comment no longer has the app marker';
    const otherId = issue.comments[1]!.id;
    issue.comments.push({ id: 777777, body: 'A human reply remains', user: { id: 88, type: 'User' } });
    await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
    ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'ambiguous', lastCode: 'cleanup_needs_review' });
    expect(issue.title).toBe('Removed from uier');
    expect(issue.comments.some(comment => comment.id === otherId)).toBe(false);
    expect(issue.comments).toEqual([changed, { id: 777777, body: 'A human reply remains', user: { id: 88, type: 'User' } }]);
    expect(Object.values(state(ledger).active!.items).map(item => item.id)).toEqual([String(changed.id)]);
});

test('rate limits and removed admins stop actual calls without leaking credentials into settings', async () => {
    const f = await fixture();
    stub.faults.rateLimit = 1;
    let ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'rate_limited' });
    expect(Date.parse(ledger.nextAttemptAt)).toBeGreaterThan(Date.now());
    await getAppStore().delete(githubAppPk('999'), 'content-rate');
    await getAppStore().delete(f.project.pk, memberId(f.user.id));
    const count = stub.calls.length;
    ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'suppressed', lastCode: 'authority_lost' });
    expect(stub.calls).toHaveLength(count);
    await expect(getGitHubSettings(f.project, f.user.id)).rejects.toMatchObject({ code: 'admin_required' });
});

test('signed lifecycle events deduplicate, block related installs and never mutate uier feedback', async () => {
    const f = await fixture();
    const before = (await getCommentsStore().get(f.comment.domain, f.comment.id))!.comment;
    const payload = { action: 'deleted', installation: { id: 101, app_id: 999 }, sender: { id: 7 }, arbitraryFeedback: 'Never persist this' };
    const event = signed(payload);
    const bad = new Headers(event.headers); bad.set('X-Hub-Signature-256', `sha256=${'0'.repeat(64)}`);
    expect((await receiveGitHubWebhook(event.raw, bad)).status).toBe(401);
    expect((await receiveGitHubWebhook(event.raw, event.headers)).status).toBe(202);
    expect((await receiveGitHubWebhook(event.raw, event.headers)).status).toBe(202);
    const records = await getAppStore().query({ type: 'github-event', pk: githubAppPk('999') });
    expect(JSON.stringify(records)).not.toContain('Never persist');
    const calls = stub.calls.length;
    const ledger = await sync(f);
    expect(ledger.status).toBe('waiting');
    expect(stub.calls).toHaveLength(calls);
    expect((await getAppStore().get(githubInstallationPk('999', '101'), 'installation'))!.doc).toMatchObject({ status: 'deleted' });
    expect((await getCommentsStore().get(f.comment.domain, f.comment.id))!.comment).toEqual(before);
    const delayed = signed({ action: 'unsuspend', installation: { id: 101, app_id: 999 } });
    await receiveGitHubWebhook(delayed.raw, delayed.headers);
    expect((await getAppStore().get(githubInstallationPk('999', '101'), 'installation'))!.doc).toMatchObject({ status: 'deleted' });
});

test('disconnect preserves sibling bindings and shared installation authority', async () => {
    const f = await fixture();
    await sync(f);
    await updateDoc<DbProject>(f.project.pk, f.project.id, current => ({ ...current, integrations: { ...current.integrations, slack: { connectionId: 'slack-sibling', since: new Date().toISOString() } } }));
    await disconnectGitHub(f.input);
    const project = (await getAppStore().get<DbProject>(f.project.pk, f.project.id))!.doc;
    expect(project.integrations?.github).toBeUndefined();
    expect(project.integrations?.slack?.connectionId).toBe('slack-sibling');
    expect((await getAppStore().get(githubInstallationPk('999', '101'), 'installation'))!.doc).toMatchObject({ status: 'connected' });
    const rows = await getAppStore().query<IntegrationSync>({ type: 'github-sync', pk: `github:${f.project.id}` });
    expect(rows[0]).toMatchObject({ active: false, status: 'suppressed' });
    expect(state(rows[0]!).active?.issue).toBeDefined();
});


test('an empty uncertain-create scan stops for review; only a bounded human absence decision can replace it', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    const unknown = stub.issues.get(201)!.find(issue => issue.body?.includes(state(ledger).active!.marker))!;
    stub.issues.set(201, stub.issues.get(201)!.filter(issue => issue.id !== unknown.id));
    const start = stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues').length;
    for (let i = 0; i < 3; i++) ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'ambiguous', active: false, lastCode: 'create_uncertain' });
    expect(stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues')).toHaveLength(start);
    await expect(resolveGitHubCreate({ ...f.input, ledgerId: ledger.id, operationId: 'wrong', confirmAbsent: true })).rejects.toMatchObject({ code: 'recovery_changed' });
    await resolveGitHubCreate({ ...f.input, ledgerId: ledger.id, operationId: ledger.attempt!.operationId, confirmAbsent: true });
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues')).toHaveLength(start + 1);
});

test('ambiguous duplicate markers never select a random issue; explicit adoption must prove the app author', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    const issue = stub.issues.get(201)!.find(issue => issue.body?.includes(state(ledger).active!.marker))!;
    const duplicate = { ...structuredClone(issue), id: 800000, number: 800, html_url: 'https://github.com/acme/repo-1/issues/800' };
    stub.issues.get(201)!.push(duplicate);
    ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'ambiguous', lastCode: 'duplicate_markers' });
    duplicate.user = { id: 88, type: 'User', login: 'human' };
    await expect(resolveGitHubCreate({ ...f.input, ledgerId: ledger.id, operationId: ledger.attempt!.operationId, issueNumber: 800 })).rejects.toMatchObject({ code: 'ownership_changed' });
    await resolveGitHubCreate({ ...f.input, ledgerId: ledger.id, operationId: ledger.attempt!.operationId, issueNumber: issue.number });
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(state(ledger).active!.issue!.id).toBe(String(issue.id));
});

test('public repositories require confirmation and settings rendering performs no provider calls', async () => {
    const f = await localProject();
    const setup = await authorized(f);
    const choice = stub.repositories[0]!;
    const wasPrivate = choice.private;
    choice.private = false;
    try {
        await expect(saveGitHubRepository({ ...f.input, setupReceipt: setup.result.setupReceipt!, repositoryId: '201', confirmPublic: false }))
            .rejects.toMatchObject({ code: 'repository_not_authorized' });
        const count = stub.calls.length;
        const settings = await getGitHubSettings(f.project, f.user.id, setup.result.setupReceipt);
        expect(settings.setup).toBeDefined();
        expect(stub.calls).toHaveLength(count);
        const saved = await saveGitHubRepository({ ...f.input, setupReceipt: setup.result.setupReceipt!, repositoryId: '201', confirmPublic: true });
        expect(saved.config.private).toBe(false);
        const view = await getGitHubSettings(f.project, f.user.id);
        expect(view.connection?.repositoryVisibility).toBe('public');
    } finally { choice.private = wasPrivate; }
});


test('production configuration ignores local endpoints and preview deployments remain unavailable', async () => {
    const deployment = process.env.UIER_DEPLOYMENT_ENV;
    const vercel = process.env.VERCEL;
    try {
        process.env.VERCEL = '1';
        process.env.UIER_DEPLOYMENT_ENV = 'production';
        expect(githubConfig().apiBase).toBe('https://api.github.com');
        expect(githubConfig().oauthBase).toBe('https://github.com');
        process.env.UIER_DEPLOYMENT_ENV = 'preview';
        expect(isGitHubConfigured()).toBe(false);
    } finally {
        if (deployment === undefined) delete process.env.UIER_DEPLOYMENT_ENV; else process.env.UIER_DEPLOYMENT_ENV = deployment;
        if (vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = vercel;
    }
});

test('revoked user authorization invalidates outstanding setup and appears in settings without provider calls', async () => {
    const f = await fixture();
    const pending = await authorized(f);
    const event = signed({ action: 'revoked', sender: { id: 7 } }, 'github_app_authorization');
    expect((await receiveGitHubWebhook(event.raw, event.headers)).status).toBe(202);
    const count = stub.calls.length;
    const settings = await getGitHubSettings(f.project, f.user.id, pending.result.setupReceipt);
    expect(settings.connection).toMatchObject({ status: 'needs_reconnect', statusCode: 'authorization_revoked' });
    expect(settings.setup).toBeUndefined();
    await expect(listGitHubRepositories({ ...f.input, setupReceipt: pending.result.setupReceipt! })).rejects.toMatchObject({ code: 'setup_expired' });
    expect(stub.calls).toHaveLength(count);
    const ledger = await sync(f);
    expect(ledger.status).toBe('waiting');
    expect(stub.calls).toHaveLength(count);
});

test('uncertain-create scans persist bounded pagination before adopting a later page', async () => {
    const f = await fixture();
    stub.faults.loseIssueResponse = 1;
    let ledger = await sync(f);
    const created = stub.issues.get(201)!.find(issue => issue.body?.includes(state(ledger).active!.marker))!;
    for (let i = 0; i < 205; i++) stub.issues.get(201)!.push({ ...structuredClone(created), id: 900000 + i, number: 900000 + i,
        user: { id: 88, type: 'User', login: 'human' }, body: 'Unrelated issue', comments: [] });
    const before = stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues').length;
    ledger = await sync(f);
    expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'reconciling_previous_operation' });
    expect(state(ledger).active!.scan?.page).toBe(3);
    expect(ledger.attempt).toBeDefined();
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted');
    expect(state(ledger).active!.issue?.id).toBe(String(created.id));
    expect(stub.calls.filter(call => call.method === 'POST' && call.path === '/repos/acme/repo-1/issues')).toHaveLength(before);
    stub.issues.set(201, stub.issues.get(201)!.filter(issue => issue.id < 900000 || issue.id >= 900205));
});

test('a repository removal fences only the affected projects sharing one installation', async () => {
    const removed = await fixture('201');
    const retained = await fixture('202');
    const event = signed({ action: 'removed', installation: { id: 101, app_id: 999 }, repositories_removed: [{ id: 201 }] }, 'installation_repositories');
    expect((await receiveGitHubWebhook(event.raw, event.headers)).status).toBe(202);
    const count = stub.calls.length;
    expect((await getGitHubSettings(removed.project, removed.user.id)).connection?.status).toBe('paused');
    expect((await getGitHubSettings(retained.project, retained.user.id)).connection?.status).toBe('connected');
    expect(stub.calls).toHaveLength(count);
    const blocked = await sync(removed);
    expect(blocked.status).toBe('waiting');
    expect(stub.calls).toHaveLength(count);
    const accepted = await sync(retained);
    expect(accepted.status).toBe('accepted');
    expect(state(accepted).active?.repositoryId).toBe('202');
    expect(state(blocked).active?.issue).toBeUndefined();
    expect(JSON.stringify(accepted)).not.toContain(removed.project.id);
});

test('settings review counts query only bounded stopped-ledger cohorts', async () => {
    const f = await fixture();
    const queries: DocQuery<string>[] = [];
    const store = getAppStore();
    const bounded: AppStore = { ...store, async query<T extends AppDoc>(query: DocQuery<T['type']>) {
        queries.push(query);
        return store.query<T>(query);
    } };
    const count = stub.calls.length;
    const settings = await getGitHubSettings(f.project, f.user.id, undefined, bounded);
    expect(settings.connection).toMatchObject({ needsReviewCount: 0, needsReviewCountCapped: false });
    expect(queries.filter(query => query.type === 'github-sync')).toEqual(['failed', 'ambiguous'].map(status => ({ type: 'github-sync', pk: `github:${f.project.id}`,
        where: { connectionId: f.connection.id, status }, limit: 1000 })));
    expect(queries.find(query => query.type === 'github-connection')).toEqual({ type: 'github-connection', pk: f.project.pk,
        where: { workspaceId: f.project.workspaceId }, limit: 1000 });
    expect(stub.calls).toHaveLength(count);
});

test('a private repository becoming public cannot receive its first issue without renewed consent', async () => {
    const f = await fixture(); const repository = stub.repositories[0]!;
    repository.private = false;
    try {
        const before = stub.calls.length;
        const ledger = await sync(f);
        expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'public_confirmation_required' });
        expect(ledger.attempt).toBeUndefined();
        expect((await getAppStore().get<GitHubConnection>(f.connection.pk, f.connection.id))!.doc).toMatchObject({ status: 'paused', statusCode: 'public_confirmation_required' });
        expect(stub.calls.slice(before).some(call => call.method !== 'GET' && call.path.startsWith('/repos/'))).toBe(false);
        expect(stub.issues.get(201)!.some(issue => issue.body?.includes(state(ledger).active!.marker))).toBe(false);
    } finally { repository.private = true; }
});

test('public visibility changes stop new body and discussion copies, permit cleanup, then reuse the issue after explicit public consent', async () => {
    const f = await fixture(); const repository = stub.repositories[0]!;
    const reply = await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Previously shared reply' });
    let ledger = await sync(f, { realTime: true }); const issue = external(ledger); const issueId = issue.id; const revision = f.connection.destinationRevision;
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'Do not copy this new source without public consent');
    await editProjectCommentItem(f.project, f.actor, f.comment.id, reply.thread.items[1]!.id,
        { expectedText: 'Previously shared reply', text: 'Do not update this reply without public consent' });
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'Do not create this reply without public consent' });
    repository.private = false;
    try {
        const before = stub.calls.length;
        ledger = await sync(f, { realTime: true });
        expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'public_confirmation_required' });
        expect(stub.calls.slice(before).some(call => call.method !== 'GET' && call.path.startsWith('/repos/'))).toBe(false);
        expect(JSON.stringify(stub.calls.slice(before))).not.toContain('without public consent');
        expect(issue.body).not.toContain('without public consent');
        expect(issue.comments[0]!.body).toContain('Previously shared reply');
        await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
        ledger = await sync(f, { realTime: true });
        expect(ledger.status).toBe('suppressed');
        expect(issue).toMatchObject({ title: 'Removed from uier', state: 'closed', comments: [] });
        const authorization = await authorized(f);
        await expect(saveGitHubRepository({ ...f.input, setupReceipt: authorization.result.setupReceipt!, repositoryId: '201', confirmPublic: false }))
            .rejects.toMatchObject({ code: 'repository_not_authorized' });
        f.connection = await saveGitHubRepository({ ...f.input, setupReceipt: authorization.result.setupReceipt!, repositoryId: '201', confirmPublic: true });
        expect(f.connection.destinationRevision).toBe(revision);
        expect(f.connection.config.private).toBe(false);
        await setProjectCommentPrivate(f.project, f.actor, f.comment.id, false);
        ledger = await sync(f, { realTime: true });
        expect(ledger.status).toBe('accepted');
        expect(external(ledger).id).toBe(issueId);
        expect(issue.body).toContain('Do not copy this new source without public consent');
        expect(issue.comments).toHaveLength(2);
        expect(state(ledger).retired).toEqual([]);
    } finally { repository.private = true; }
});

test('repository visibility is rechecked between separate feedback writes in one delivery turn', async () => {
    const f = await fixture(); let ledger = await sync(f); const issue = external(ledger);
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'Root changed while the repository was private');
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'This reply must wait for public consent' });
    stub.faults.makePublicAfterIssueUpdate = true;
    try {
        const before = stub.calls.length;
        ledger = await sync(f);
        expect(ledger).toMatchObject({ status: 'waiting', lastCode: 'public_confirmation_required' });
        expect(issue.body).toContain('Root changed while the repository was private');
        expect(issue.comments).toEqual([]);
        expect(JSON.stringify(stub.calls.slice(before))).not.toContain('This reply must wait for public consent');
    } finally { stub.repositories[0]!.private = true; stub.faults.makePublicAfterIssueUpdate = false; }
});

test('same-target reauthorization by the same or a new admin retains external identity and renews stale authorization', async () => {
    const f = await fixture(); let ledger = await sync(f); const originalIssue = external(ledger).id; const revision = f.connection.destinationRevision;
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: 'A reply with an unknown create response' });
    stub.faults.loseCommentResponse = 1;
    ledger = await sync(f); const uncertainOperation = ledger.attempt!.operationId;
    const first = await authorized(f);
    f.connection = await saveGitHubRepository({ ...f.input, setupReceipt: first.result.setupReceipt!, repositoryId: '201', confirmPublic: false });
    expect(f.connection.destinationRevision).toBe(revision);
    expect((await getAppStore().get<IntegrationSync>(ledger.pk, ledger.id))!.doc.attempt?.operationId).toBe(uncertainOperation);
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'After same-admin authorization');
    ledger = await sync(f); expect(ledger.status).toBe('accepted'); expect(external(ledger).id).toBe(originalIssue);
    expect(external(ledger).comments).toHaveLength(1);
    const replacement = await findOrCreateUser(`github-replacement-${randomUUID()}@example.com`);
    await getAppStore().create<DbMember>({ type: 'member', pk: f.project.pk, id: memberId(replacement.id), workspaceId: f.project.workspaceId,
        userId: replacement.id, email: replacement.email, role: 'admin', projects: 'all', createdAt: new Date().toISOString() });
    const revoke = signed({ action: 'revoked', sender: { id: 7 } }, 'github_app_authorization');
    await receiveGitHubWebhook(revoke.raw, revoke.headers);
    f.input = { ...f.input, userId: replacement.id }; f.user = replacement;
    f.actor = (await memberActor(f.project, replacement.id))!;
    stub.faults.githubUserId = 8;
    const second = await authorized(f);
    f.connection = await saveGitHubRepository({ ...f.input, setupReceipt: second.result.setupReceipt!, repositoryId: '201', confirmPublic: false });
    expect(f.connection.destinationRevision).toBe(revision);
    expect(f.connection.connectedBy).toBe(replacement.id);
    await editProjectCommentText(f.project, f.actor, f.comment.id, 'After new-admin authorization');
    ledger = await sync(f);
    expect(ledger.status).toBe('accepted'); expect(external(ledger).id).toBe(originalIssue);
    expect(state(ledger).active?.authorizedGitHubUserId).toBe('8');
    expect(state(ledger).retired).toEqual([]);
});
