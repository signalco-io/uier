import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { assertIntegrationAdminProductionConfiguration, executeIntegrationAdmin, parseIntegrationAdminInput } from '../scripts/integration-admin';
import { memberId, workspacePk, type AppDoc, type DbMember, type DbProject } from '../src/lib/app/model';
import { getAppStore, updateDoc, type AppStore, type DocQuery } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { enqueueIntegrationSync } from '../src/lib/integrations/discovery';
import type { IntegrationConnection, IntegrationProviderId, IntegrationSync } from '../src/lib/integrations/model';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

async function fixture(provider: IntegrationProviderId = 'github') {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const user = await findOrCreateUser(`integration-operator-${id}@example.com`);
    const workspaceId = `w_${user.id}`;
    const now = new Date().toISOString();
    const project: DbProject = { id, pk: workspacePk(workspaceId), type: 'project', workspaceId, name: 'Operator project', createdAt: now,
        updatedAt: now, createdBy: user.id, access: 'invited', status: 'active', urls: ['https://reviewed.example'],
        integrations: { [provider]: { connectionId: `${provider}_${id}`, since: now } } };
    const store = getAppStore();
    await store.create(project);
    await store.create<DbMember>({ id: memberId(user.id), pk: project.pk, type: 'member', workspaceId, userId: user.id,
        email: user.email, role: 'admin', projects: 'all', createdAt: now });
    const connection: IntegrationConnection = { id: `${provider}_${id}`, pk: project.pk, type: `${provider}-connection`, provider,
        workspaceId, projectId: project.id, connectedBy: user.id, enabled: true, status: 'connected', destinationRevision: 1,
        createdAt: now, updatedAt: now, config: { token: 'do-not-export-credentials' } };
    await store.create(connection);
    const ledger = await enqueueIntegrationSync(project, provider, connection.id, `comment_${id}`, 1);
    const operationId = randomUUID();
    await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => ({ ...current, active: false, status: 'ambiguous',
        lastCode: 'create_uncertain', state: { privateText: 'do-not-export-feedback' },
        attempt: { operationId, firstSentAt: now, through: 1, requestRevision: 1, destinationRevision: 1, step: 'create_issue',
            repeatable: false, planHash: 'a'.repeat(64), metadata: { credentials: 'do-not-export-attempt' } } }));
    const input = { provider, workspaceId, projectId: project.id, userId: user.id };
    return { store, project, user, connection, ledger, input, operationId };
}

test('operator requests are strict and production guard rejects local/preview/mixed data configuration', async () => {
    const input = { action: 'status', provider: 'github', workspaceId: 'workspace', projectId: 'abc123def456', userId: 'admin' };
    expect(parseIntegrationAdminInput(input)).toEqual(input);
    for (const bad of [{ ...input, token: 'secret' }, { ...input, action: 'retry', ledgerId: `github_${'a'.repeat(64)}` },
        { ...input, ledgerId: `slack_${'a'.repeat(64)}` }, { ...input, action: 'github-resolve-create', ledgerId: `github_${'a'.repeat(64)}`,
            operationId: randomUUID(), operatorAcknowledged: true, decision: { kind: 'confirm-absent', issueNumber: 1 } }])
        expect(() => parseIntegrationAdminInput(bad)).toThrow();
    const keys = ['UIER_LOCAL', 'UIER_DEPLOYMENT_ENV', 'VERCEL_ENV', 'NODE_ENV', 'COSMOSDB_CONNECTION_STRING', 'COSMOSDB_ENDPOINT',
        'COSMOSDB_APP_CONTAINER', 'COSMOSDB_COMMENTS_CONTAINER', 'UIER_COMMENTS_SECRET', 'UIER_BASE_URL'];
    const saved = new Map(keys.map(key => [key, process.env[key]]));
    try {
        for (const key of keys) delete process.env[key];
        Object.assign(process.env, { UIER_DEPLOYMENT_ENV: 'production', COSMOSDB_CONNECTION_STRING: 'test-presence-only',
            UIER_COMMENTS_SECRET: 'x'.repeat(32), UIER_BASE_URL: 'https://uier.io' });
        expect(() => assertIntegrationAdminProductionConfiguration()).not.toThrow();
        for (const [key, value] of [['UIER_LOCAL', '1'], ['VERCEL_ENV', 'preview'], ['NODE_ENV', 'development'],
            ['COSMOSDB_ENDPOINT', 'https://preview.invalid'], ['COSMOSDB_APP_CONTAINER', 'app-preview'], ['UIER_BASE_URL', 'https://attacker.example']]) {
            process.env[key!] = value;
            expect(() => assertIntegrationAdminProductionConfiguration()).toThrow();
            if (key === 'UIER_BASE_URL') process.env[key] = 'https://uier.io'; else delete process.env[key!];
        }
    } finally { for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('status is bounded and allowlisted; foreign scope and removed admins cannot inspect a ledger', async () => {
    const f = await fixture();
    let queryLimit: number | undefined;
    const store: AppStore = { ...f.store, async query<T extends AppDoc>(query: DocQuery<T['type']>) {
        queryLimit = query.limit;
        return f.store.query<T>(query);
    } };
    const result = await executeIntegrationAdmin({ ...f.input, action: 'status' }, { store });
    expect(queryLimit).toBe(1000);
    expect(result).toMatchObject({ capped: false, ledgers: [{ id: f.ledger.id, status: 'ambiguous', attempt: { operationId: f.operationId, step: 'create_issue' } }] });
    expect(JSON.stringify(result)).not.toMatch(/do-not-export|metadata|planHash|requestRevision/);
    await expect(executeIntegrationAdmin({ ...f.input, projectId: 'abc123def456', action: 'status', ledgerId: f.ledger.id })).rejects.toMatchObject({ code: 'admin_required' });
    await updateDoc<IntegrationConnection>(f.connection.pk, f.connection.id, row => ({ ...row, projectId: 'foreign' }));
    await expect(executeIntegrationAdmin({ ...f.input, action: 'status', ledgerId: f.ledger.id })).rejects.toMatchObject({ code: 'connection_unavailable' });
    await updateDoc<IntegrationConnection>(f.connection.pk, f.connection.id, row => ({ ...row, projectId: f.project.id }));
    await f.store.delete(f.project.pk, memberId(f.user.id));
    await expect(executeIntegrationAdmin({ ...f.input, action: 'status', ledgerId: f.ledger.id })).rejects.toMatchObject({ code: 'admin_required' });
});

test('retry retains unknown Slack post identity and rejects an active worker lease', async () => {
    const f = await fixture('slack');
    const request = { ...f.input, action: 'retry', ledgerId: f.ledger.id, operatorAcknowledged: true };
    await updateDoc<IntegrationSync>(f.ledger.pk, f.ledger.id, row => ({ ...row, lease: { id: 'worker', until: new Date(Date.now() + 60_000).toISOString() } }));
    await expect(executeIntegrationAdmin(request)).rejects.toMatchObject({ code: 'ledger_changed' });
    await updateDoc<IntegrationSync>(f.ledger.pk, f.ledger.id, row => ({ ...row, lease: undefined }));
    const result = await executeIntegrationAdmin(request);
    expect(result).toMatchObject({ ledger: { status: 'queued', attempt: { operationId: f.operationId } } });
    const saved = (await f.store.get<IntegrationSync>(f.ledger.pk, f.ledger.id))!.doc;
    expect(saved.attempt?.operationId).toBe(f.operationId);
    expect(saved.state).toEqual({ privateText: 'do-not-export-feedback' });
});

test('Slack rate review release requires an explicit verified decision and current project administration', async () => {
    const f = await fixture('slack'); const calls: unknown[] = [];
    const input = { ...f.input, action: 'slack-release-rate', method: 'chat.postMessage', operatorAcknowledged: true, providerLimitVerified: true };
    const release: NonNullable<Parameters<typeof executeIntegrationAdmin>[1]> = { slackRateRelease: async (project, userId, method, confirmed) => {
        calls.push({ projectId: project.id, userId, method, confirmed }); return { released: true, method, receipt: { id: 'receipt', at: '2026-10-28T12:00:00.000Z' } };
    } };
    for (const bad of [{ ...input, providerLimitVerified: false }, { ...input, method: 'conversations.history' }, { ...input, ledgerId: f.ledger.id }])
        await expect(executeIntegrationAdmin(bad, release)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toEqual([]);
    expect(await executeIntegrationAdmin(input, release)).toMatchObject({ released: true, method: 'chat.postMessage' });
    expect(calls).toEqual([{ projectId: f.project.id, userId: f.user.id, method: 'chat.postMessage', confirmed: { confirmed: true } }]);
    await f.store.delete(f.project.pk, memberId(f.user.id));
    await expect(executeIntegrationAdmin(input, release)).rejects.toMatchObject({ code: 'admin_required' });
    expect(calls).toHaveLength(1);
});

test('GitHub recovery requires an exact scoped operation and delegates only the explicit human decision', async () => {
    const f = await fixture();
    const calls: unknown[] = [];
    const result = await executeIntegrationAdmin({ ...f.input, action: 'github-resolve-create', ledgerId: f.ledger.id,
        operationId: f.operationId, operatorAcknowledged: true, decision: { kind: 'adopt-issue', issueNumber: 42 } },
    { githubRecovery: async input => { calls.push(input); return { status: 'queued' }; } });
    expect(calls).toEqual([{ userId: f.user.id, workspaceId: f.project.workspaceId, projectId: f.project.id,
        ledgerId: f.ledger.id, operationId: f.operationId, issueNumber: 42 }]);
    expect(JSON.stringify(result)).not.toContain('do-not-export');
    const original = (await f.store.get<IntegrationSync>(f.ledger.pk, f.ledger.id))!.doc.attempt!;
    await updateDoc<IntegrationSync>(f.ledger.pk, f.ledger.id, row => ({ ...row, attempt: undefined,
        state: { active: { revision: 1, uncertainCreates: [original] }, retired: [] } }));
    expect(await executeIntegrationAdmin({ ...f.input, action: 'status', ledgerId: f.ledger.id })).toMatchObject({
        ledgers: [{ unresolvedOperations: [{ operationId: f.operationId, step: 'create_issue' }] }] });
    await executeIntegrationAdmin({ ...f.input, action: 'github-resolve-create', ledgerId: f.ledger.id, operationId: f.operationId,
        operatorAcknowledged: true, decision: { kind: 'confirm-absent' } }, { githubRecovery: async input => { calls.push(input); return { status: 'queued' }; } });
    expect(calls).toHaveLength(2);
    await expect(executeIntegrationAdmin({ ...f.input, action: 'github-resolve-create', ledgerId: f.ledger.id,
        operationId: randomUUID(), operatorAcknowledged: true, decision: { kind: 'confirm-absent' } },
    { githubRecovery: async () => { throw new Error('Must not be called'); } })).rejects.toMatchObject({ code: 'ledger_changed' });
    const other = await fixture();
    await expect(executeIntegrationAdmin({ ...f.input, action: 'github-resolve-create', ledgerId: other.ledger.id,
        operationId: f.operationId, operatorAcknowledged: true, decision: { kind: 'confirm-absent' } },
    { githubRecovery: async () => { throw new Error('Must not be called'); } })).rejects.toMatchObject({ code: 'ledger_not_found' });
});

test('Slack resolution requires reviewed source/channel/bot attestation and resume cannot discard uncertainty', async () => {
    const f = await fixture('slack');
    await updateDoc<IntegrationSync>(f.ledger.pk, f.ledger.id, row => ({ ...row, attempt: undefined, state: {
        uncertainPosts: [{ operationId: f.operationId, step: 'post_root', teamId: 'T123', channelId: 'C123',
            destinationRevision: 1, firstSentAt: new Date().toISOString(), planHash: 'a'.repeat(64) }] } }));
    const status = await executeIntegrationAdmin({ ...f.input, action: 'status', ledgerId: f.ledger.id });
    expect(status).toMatchObject({ ledgers: [{ threadId: `comment_${f.project.id}`, unresolvedOperations: [{ operationId: f.operationId, step: 'post_root' }] }] });
    expect(JSON.stringify(status)).not.toMatch(/T123|C123|planHash|uncertainPosts/);
    const request = { ...f.input, action: 'slack-resolve-post', ledgerId: f.ledger.id, operationId: f.operationId,
        operatorAcknowledged: true, originalDestinationReviewed: true,
        decision: { kind: 'adopt', ts: '123456.789', sourceChannelBotMatch: true } };
    expect(() => parseIntegrationAdminInput({ ...request, decision: { kind: 'adopt', ts: '123456.789' } })).toThrow();
    const calls: unknown[] = [];
    await executeIntegrationAdmin(request, { slackRecovery: async (project, userId, threadId, input) => { calls.push({ projectId: project.id, userId, threadId, input }); } });
    expect(calls).toEqual([{ projectId: f.project.id, userId: f.user.id, threadId: `comment_${f.project.id}`,
        input: { operationId: f.operationId, decision: 'adopt', ts: '123456.789', confirmed: true } }]);
    const resume = { ...f.input, action: 'slack-resume-notification', ledgerId: f.ledger.id, operatorAcknowledged: true, newNotificationConfirmed: true };
    await expect(executeIntegrationAdmin(resume, { slackResume: async () => { throw new Error('Must not run'); } })).rejects.toMatchObject({ code: 'ledger_changed' });
    await updateDoc<IntegrationSync>(f.ledger.pk, f.ledger.id, row => ({ ...row, state: {} }));
    let resumed = false;
    await executeIntegrationAdmin(resume, { slackResume: async (_project, _userId, threadId) => { resumed = threadId === `comment_${f.project.id}`; } });
    expect(resumed).toBe(true);
});
