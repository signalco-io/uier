import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type AppDoc, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore, updateDoc, type AppStore, type DocQuery } from '../src/lib/app/store';
import { sha256Hex } from '../src/lib/app/tokens';
import { findOrCreateUser } from '../src/lib/app/users';
import type { DbComment, DbSyncTombstone } from '../src/lib/db/schema';
import { disconnectIntegration } from '../src/lib/integrations/connection';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import { discoverIntegrationSync, discoverThreadIntegrationSync, enqueueIntegrationBackfill, enqueueIntegrationSync, integrationPk, integrationSyncId } from '../src/lib/integrations/discovery';
import type { IntegrationAdapter, IntegrationConnection, IntegrationProviderId, IntegrationSync } from '../src/lib/integrations/model';
import { loadIntegrationLinks } from '../src/lib/integrations/links';
import { syncPendingKey } from '../src/lib/integrations/syncSignal';
import { runIntegrationWorker } from '../src/lib/integrations/worker';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';

// These exercise real persistence, authorization and exports. Only provider calls are replaced.
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const baseUrl = 'https://uier.io';
const old = '2026-01-01T00:00:00.000Z';
const hash = sha256Hex('current provider projection');
const providers = ['notion', 'github'] as const;

async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const store = getAppStore();
    const comments = getCommentsStore();
    const owner = await findOrCreateUser(`integration-owner-${id}@example.com`);
    const otherOwner = await findOrCreateUser(`integration-other-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const bindings = Object.fromEntries(providers.map(provider => [provider, { connectionId: `${provider}_${id}`, since: old }]));
    const project: DbProject = { type: 'project', pk: workspacePk(workspaceId), id, workspaceId,
        name: `Integration project ${id}`, urls: ['https://reviewed.example'], status: 'active', access: 'invited',
        createdBy: owner.id, createdAt: old, updatedAt: old, integrations: bindings };
    await store.create(project);
    await store.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const user of [owner, otherOwner]) await store.create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk,
        workspaceId, userId: user.id, email: user.email, role: 'admin', projects: 'all', createdAt: old });
    const connections = {} as Record<typeof providers[number], IntegrationConnection>;
    for (const provider of providers) {
        const connection: IntegrationConnection = { type: `${provider}-connection`, provider,
            id: bindings[provider]!.connectionId, pk: project.pk, workspaceId, projectId: project.id,
            connectedBy: provider === 'notion' ? owner.id : otherOwner.id,
            enabled: true, status: 'connected', destinationRevision: 1, config: {}, createdAt: old, updatedAt: old };
        await store.create(connection);
        connections[provider] = connection;
    }
    const source: DbComment = { id: `comment_${id}`, projectId: project.id, domain: `project:${project.id}`, path: '/pricing',
        kind: 'feedback', position: { type: 'page' }, authorId: `user:${owner.id}`, createdAt: old, updatedAt: old,
        origin: 'https://reviewed.example', thread: { items: [{ id: `item_${id}`, text: 'A saved feedback message',
            authorId: `user:${owner.id}`, createdAt: old }] }, syncKey: syncPendingKey(`project:${project.id}`, `comment_${id}`), syncVersion: 1, syncPending: true };
    await comments.create(source);
    return { store, comments, project, owner, otherOwner, connections, source };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function adapter(provider: IntegrationProviderId, deliver: IntegrationAdapter['deliver']): IntegrationAdapter {
    return { provider, isConfigured: () => true, deliver };
}

function accepting(provider: IntegrationProviderId, calls?: string[]) {
    return adapter(provider, async context => {
        await context.operation({ step: 'update', planHash: hash, repeatable: true }, async () => { calls?.push(provider); });
        await context.checkpoint({ remoteId: `remote_${provider}` }, { clearAttempt: true });
        return { status: 'accepted' };
    });
}

async function queue(f: Fixture, provider: typeof providers[number] = 'notion') {
    return enqueueIntegrationSync(f.project, provider, f.connections[provider].id, f.source.id, f.source.syncVersion!);
}

async function currentLedger(f: Fixture, provider: typeof providers[number] = 'notion') {
    const pk = integrationPk(provider, f.project.id);
    return (await f.store.get<IntegrationSync>(pk, integrationSyncId(provider, f.connections[provider].id, f.project.id, f.source.id)))!.doc;
}

async function replaceSource(f: Fixture, patch: Partial<DbComment>) {
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.replace({ ...stored.comment, ...patch }, stored.etag)).toBe('ok');
    return (await f.comments.get(f.source.domain, f.source.id))!.comment;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

test('partial provider fan-out survives failure and replay without acknowledging early or duplicating work', async () => {
    const f = await fixture();
    const adapters = providers.map(provider => accepting(provider));
    let fail = true;
    const interrupted: AppStore = { ...f.store, async create<T extends AppDoc>(doc: T) {
        if (doc.type === 'github-sync' && fail) { fail = false; throw new Error('Injected second-target storage failure'); }
        return f.store.create(doc);
    } };
    await expect(discoverThreadIntegrationSync(f.project, f.source, { adapters, store: interrupted })).rejects.toThrow();
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(true);
    expect(await f.store.query<IntegrationSync>({ type: 'notion-sync', pk: integrationPk('notion', f.project.id) })).toHaveLength(1);
    expect(await f.store.query<IntegrationSync>({ type: 'github-sync', pk: integrationPk('github', f.project.id) })).toHaveLength(0);
    expect(await discoverThreadIntegrationSync(f.project, f.source, { adapters })).toBe(true);
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(false);
    for (const provider of providers) {
        const ledgers = await f.store.query<IntegrationSync>({ type: `${provider}-sync`, pk: integrationPk(provider, f.project.id) });
        expect(ledgers).toHaveLength(1);
        expect(ledgers[0]!.requestedVersion).toBe(1);
    }
});

test('discovery cannot clear a newer source mutation or a newly attached provider', async () => {
    const f = await fixture();
    const adapters = providers.map(provider => accepting(provider));
    let changed = false;
    const racing: AppStore = { ...f.store, async create<T extends AppDoc>(doc: T) {
        const result = await f.store.create(doc);
        if (doc.type === 'notion-sync' && !changed) {
            changed = true;
            await replaceSource(f, { syncVersion: 2, syncPending: true });
        }
        return result;
    } };
    expect(await discoverThreadIntegrationSync(f.project, f.source, { adapters, store: racing })).toBe(false);
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(true);
    const latest = (await f.comments.get(f.source.domain, f.source.id))!.comment;
    expect(await discoverThreadIntegrationSync(f.project, latest, { adapters })).toBe(true);
    expect((await currentLedger(f)).requestedVersion).toBe(2);

    // A project snapshot from before a new binding must not acknowledge that binding's work.
    await replaceSource(f, { syncVersion: 3, syncPending: true });
    const oneBinding = { ...f.project, integrations: { notion: f.project.integrations!.notion } };
    const newer = (await f.comments.get(f.source.domain, f.source.id))!.comment;
    expect(await discoverThreadIntegrationSync(oneBinding, newer, { adapters })).toBe(false);
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(true);
    expect(await discoverThreadIntegrationSync(f.project, newer, { adapters })).toBe(true);
    expect((await currentLedger(f, 'github')).requestedVersion).toBe(3);
});

test('concurrent delivery processes make one external operation under the current lease', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    const started = deferred();
    const release = deferred();
    let calls = 0;
    const provider = adapter('notion', async context => {
        await context.operation({ step: 'update', planHash: hash, repeatable: true }, async () => {
            calls++; started.resolve(); await release.promise;
        });
        await context.checkpoint({ remoteId: 'one object' }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    const first = processIntegrationDelivery(candidate, baseUrl, provider);
    await started.promise;
    await processIntegrationDelivery(candidate, baseUrl, provider);
    expect(calls).toBe(1);
    release.resolve();
    await first;
    expect((await currentLedger(f)).status).toBe('accepted');
    expect((await currentLedger(f)).state).toEqual({ remoteId: 'one object' });
});

test('an expired worker cannot overwrite the replacement worker checkpoint or result', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    const started = deferred();
    const release = deferred();
    let clock = Date.now();
    let calls = 0;
    const provider = adapter('notion', async context => {
        const worker = ++calls;
        await context.operation({ step: 'update', planHash: hash, repeatable: true }, async () => {
            if (worker === 1) { started.resolve(); await release.promise; }
        });
        await context.checkpoint({ worker }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    const first = processIntegrationDelivery(candidate, baseUrl, provider, { now: () => clock });
    await started.promise;
    clock += 120_000;
    await processIntegrationDelivery(candidate, baseUrl, provider, { now: () => clock });
    release.resolve();
    await first;
    const saved = await currentLedger(f);
    expect(calls).toBe(2);
    expect(saved.status).toBe('accepted');
    expect(saved.state).toEqual({ worker: 2 });
    expect(saved.lease).toBeUndefined();
});

test('a newer mutation arriving during a provider call remains pending after the older result', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    const provider = adapter('notion', async context => {
        expect(context.feedback!.context.feedback!.text).toBe('A saved feedback message');
        await context.operation({ step: 'update', planHash: hash, repeatable: true }, async () => {
            await replaceSource(f, { syncVersion: 2, syncPending: true });
            await enqueueIntegrationSync(f.project, 'notion', f.connections.notion.id, f.source.id, 2);
        });
        await context.checkpoint({ remoteId: 'accepted first version' }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(candidate, baseUrl, provider);
    const saved = await currentLedger(f);
    expect(saved.processedVersion).toBe(1);
    expect(saved.requestedVersion).toBe(2);
    expect(saved.active).toBe(true);
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(true);
});

test('source or project changes before the send boundary invalidate an unsent projection', async () => {
    for (const changed of ['source', 'project'] as const) {
        const f = await fixture();
        const candidate = await queue(f);
        let calls = 0;
        const provider = adapter('notion', async context => {
            if (changed === 'source') await replaceSource(f, { syncVersion: 2, syncPending: true, private: true });
            else await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, urls: ['https://different.example'] }));
            await context.operation({ step: 'create', planHash: hash }, async () => { calls++; });
            return { status: 'accepted' };
        });
        await processIntegrationDelivery(candidate, baseUrl, provider);
        const saved = await currentLedger(f);
        expect(calls).toBe(0);
        expect(saved.status).toBe('waiting');
        expect(saved.lastCode).toBe('projection_changed');
        expect(saved.processedVersion).toBe(-1);
        expect(saved.attempt).toBeUndefined();
    }
});

test('demotion at the external-call boundary stops that connection while another authorized provider continues', async () => {
    const f = await fixture();
    const first = await queue(f, 'notion');
    const second = await queue(f, 'github');
    let blockedCalls = 0;
    const delivered: string[] = [];
    const provider = adapter('notion', async context => {
        await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
        await context.operation({ step: 'create', planHash: hash }, async () => { blockedCalls++; });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(first, baseUrl, provider);
    await processIntegrationDelivery(second, baseUrl, accepting('github', delivered));
    expect(blockedCalls).toBe(0);
    expect((await currentLedger(f)).status).toBe('suppressed');
    expect((await currentLedger(f)).lastCode).toBe('authority_lost');
    expect(delivered).toEqual(['github']);
    expect((await currentLedger(f, 'github')).status).toBe('accepted');
});

test('unknown results preserve nonrepeatable operation identity until explicit reconciliation', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    let createCalls = 0;
    const creating = adapter('notion', async context => {
        await context.operation({ step: 'create', planHash: hash, metadata: { marker: 'safe lookup id' } }, async () => {
            createCalls++;
            throw new Error('Connection ended after provider accepted create');
        });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(candidate, baseUrl, creating);
    const uncertain = await currentLedger(f);
    expect(uncertain.status).toBe('ambiguous');
    expect(uncertain.active).toBe(false);
    expect(uncertain.attempt?.metadata).toEqual({ marker: 'safe lookup id' });
    const operationId = uncertain.attempt!.operationId;
    expect(JSON.stringify(uncertain)).not.toContain('A saved feedback message');

    // An operator retry must not itself turn an unknown create into a safe replay.
    await updateDoc<IntegrationSync>(uncertain.pk, uncertain.id, ledger => ({ ...ledger, active: true, status: 'queued', nextAttemptAt: old }));
    await processIntegrationDelivery(uncertain, baseUrl, creating);
    expect(createCalls).toBe(1);
    expect((await currentLedger(f)).attempt!.operationId).toBe(operationId);
    expect((await currentLedger(f)).status).toBe('ambiguous');

    await updateDoc<IntegrationSync>(uncertain.pk, uncertain.id, ledger => ({ ...ledger, active: true, status: 'queued', nextAttemptAt: old }));
    const reconciling = adapter('notion', async context => {
        expect(context.ledger.attempt!.operationId).toBe(operationId);
        const result = await context.read(async () => ({ id: 'accepted remote object' }));
        await context.checkpoint({ remoteId: result.id }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(uncertain, baseUrl, reconciling);
    expect(createCalls).toBe(1);
    expect((await currentLedger(f)).state).toEqual({ remoteId: 'accepted remote object' });
    expect((await currentLedger(f)).attempt).toBeUndefined();
    expect((await currentLedger(f)).status).toBe('accepted');
});

test('private and hard-deleted sources use cleanup without exporting feedback, and deletion survives an in-flight result', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    const deletion = { version: 2, deletedAt: new Date().toISOString() };
    const creator = adapter('notion', async context => {
        await context.operation({ step: 'create', planHash: hash }, async () => {
            const stored = (await f.comments.get(f.source.domain, f.source.id))!;
            expect(await f.comments.delete(f.source.domain, f.source.id, stored.etag)).toBe('ok');
            await enqueueIntegrationSync(f.project, 'notion', f.connections.notion.id, f.source.id, 2, { deletion });
        });
        await context.checkpoint({ remoteId: 'created while deletion arrived' }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(candidate, baseUrl, creator);
    const pending = await currentLedger(f);
    expect(pending.deletion).toEqual(deletion);
    expect(pending.processedVersion).toBe(1);
    expect(pending.tombstoned).toBe(false);
    expect(pending.active).toBe(true);

    let exports = 0;
    const noExport: typeof projectFeedbackExport = async (...args) => { exports++; return projectFeedbackExport(...args); };
    let cleanupCalls = 0;
    const cleanup = adapter('notion', async context => {
        expect(context.mode).toBe('cleanup');
        expect(context.feedback).toBeNull();
        expect(context.ledger.state.remoteId).toBe('created while deletion arrived');
        await context.operation({ step: 'delete', planHash: hash, repeatable: true }, async () => { cleanupCalls++; });
        await context.checkpoint({ cleaned: true }, { clearAttempt: true });
        return { status: 'accepted' };
    });
    await processIntegrationDelivery(pending, baseUrl, cleanup, { exportFeedback: noExport });
    expect(exports).toBe(0);
    expect(cleanupCalls).toBe(1);
    expect((await currentLedger(f)).tombstoned).toBe(true);
    expect((await currentLedger(f)).active).toBe(false);

    const privateFixture = await fixture();
    const privateCandidate = await queue(privateFixture);
    await replaceSource(privateFixture, { private: true, syncVersion: 2, syncPending: true });
    await processIntegrationDelivery(privateCandidate, baseUrl, adapter('notion', async context => {
        expect(context.mode).toBe('cleanup');
        expect(context.feedback).toBeNull();
        return { status: 'waiting', code: 'cleanup_blocked' };
    }), { exportFeedback: noExport });
    expect(exports).toBe(0);
    expect((await currentLedger(privateFixture)).active).toBe(true);
    expect((await currentLedger(privateFixture)).lastCode).toBe('cleanup_blocked');
});

test('tombstone discovery queues cleanup for captured and current bindings before removing the shared intent', async () => {
    const f = await fixture();
    const tombstone: DbSyncTombstone = { type: 'tombstone', id: `$tombstone_${f.source.id}`, domain: f.source.domain,
        projectId: f.project.id, commentId: f.source.id, syncVersion: 2, syncKey: syncPendingKey(f.source.domain, `$tombstone_${f.source.id}`), syncPending: true, deletedAt: old,
        targets: [{ provider: 'notion', connectionId: f.connections.notion.id }], ttl: 30 * 24 * 60 * 60 };
    let deletions = 0;
    const comments = { ...f.comments, async deleteTombstone(...args: Parameters<typeof f.comments.deleteTombstone>) {
        for (const provider of providers) expect((await currentLedger(f, provider)).deletion).toEqual({ version: 2, deletedAt: old });
        deletions++;
        return f.comments.deleteTombstone(...args);
    } };
    // The comments store's transactional write creates the real intent as well as removing source.
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.deleteWithTombstone(f.source.domain, f.source.id, stored.etag, tombstone)).toBe('ok');
    expect(await discoverThreadIntegrationSync(f.project, tombstone, { adapters: providers.map(provider => accepting(provider)), comments })).toBe(true);
    expect(deletions).toBe(1);
    expect(await f.comments.listSyncPending()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: tombstone.id })]));
    for (const provider of providers) expect((await currentLedger(f, provider)).requestedVersion).toBe(2);
});

test('turned-off and disconnected connections do not consume another provider’s work', async () => {
    const f = await fixture();
    const first = await queue(f, 'notion');
    const second = await queue(f, 'github');
    const calls: string[] = [];
    await updateDoc<IntegrationConnection>(f.connections.notion.pk, f.connections.notion.id, connection => ({ ...connection, enabled: false }));
    await processIntegrationDelivery(first, baseUrl, accepting('notion', calls));
    await processIntegrationDelivery(second, baseUrl, accepting('github', calls));
    expect(calls).toEqual(['github']);
    expect((await currentLedger(f)).active).toBe(true);
    expect((await currentLedger(f)).lastCode).toBe('turned_off');
    await updateDoc<IntegrationConnection>(f.connections.notion.pk, f.connections.notion.id, connection => ({ ...connection, enabled: true }));
    await processIntegrationDelivery(await currentLedger(f), baseUrl, accepting('notion', calls), { now: () => Date.now() + 120_000 });
    expect(calls).toEqual(['github', 'notion']);
    await disconnectIntegration(f.project, 'notion');
    const project = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc;
    expect(project.integrations?.notion).toBeUndefined();
    expect(project.integrations?.github?.connectionId).toBe(f.connections.github.id);
    expect((await currentLedger(f)).status).toBe('suppressed');
    expect((await currentLedger(f, 'github')).status).toBe('accepted');
});

test('provider-specific backfill forces a processed version once and preserves newer requested work', async () => {
    const f = await fixture();
    const first = await queue(f, 'notion');
    const second = await queue(f, 'github');
    await processIntegrationDelivery(first, baseUrl, accepting('notion'));
    await processIntegrationDelivery(second, baseUrl, accepting('github'));
    await replaceSource(f, { syncPending: false });
    const githubBefore = await currentLedger(f, 'github');
    const before = await currentLedger(f);
    expect(before.active).toBe(false);
    const requestId = `backfill_${randomUUID()}`;
    await enqueueIntegrationBackfill(f.project, 'notion', f.connections.notion.id, [f.source], requestId);
    const forced = await currentLedger(f);
    expect(forced.active).toBe(true);
    expect(forced.requestedVersion).toBe(before.processedVersion);
    expect(forced.requestRevision).toBe(before.requestRevision + 1);
    await enqueueIntegrationBackfill(f.project, 'notion', f.connections.notion.id, [f.source], requestId);
    expect((await currentLedger(f)).requestRevision).toBe(forced.requestRevision);
    await enqueueIntegrationSync(f.project, 'notion', f.connections.notion.id, f.source.id, 3);
    await enqueueIntegrationBackfill(f.project, 'notion', f.connections.notion.id, [f.source], requestId);
    expect((await currentLedger(f)).requestedVersion).toBe(3);
    expect(await currentLedger(f, 'github')).toEqual(githubBefore);
    expect((await f.comments.get(f.source.domain, f.source.id))!.comment.syncPending).toBe(false);
});

test('worker turns and call budgets stay independent when a provider is limited or stops for review', async () => {
    for (const outcome of ['rate_limit', 'ambiguous', 'budget'] as const) {
        const f = await fixture();
        await queue(f, 'notion');
        await queue(f, 'github');
        let firstCalls = 0;
        const delivered: string[] = [];
        const first: IntegrationAdapter = { ...adapter('notion', async context => {
            if (outcome === 'ambiguous') {
                await context.operation({ step: 'create', planHash: hash }, async () => {
                    firstCalls++;
                    throw new Error('The create response was lost');
                });
            } else {
                await context.read(async () => { firstCalls++; });
                if (outcome === 'budget') await context.read(async () => { firstCalls++; });
            }
            return { status: 'waiting', code: 'rate_limited', retryAt: new Date(Date.now() + 60 * 60_000).toISOString() };
        }), maxCalls: 1 };
        // Isolate this worker invocation from other independent tests' unfinished fixture queues.
        const store: AppStore = { ...f.store, async query<T extends AppDoc>(query: DocQuery<T['type']>) {
            const values = await f.store.query<T>(query);
            return values.filter(value => !('projectId' in value) || value.projectId === f.project.id);
        } };
        const result = await runIntegrationWorker(baseUrl, { adapters: [first, accepting('github', delivered)], store,
            comments: { ...f.comments, listSyncPending: async () => [] }, budgetMs: 60_000 });
        expect(firstCalls).toBe(1);
        expect(delivered).toEqual(['github']);
        expect(result.providers.find(provider => provider.provider === 'notion')?.calls).toBe(1);
        expect(result.providers.find(provider => provider.provider === 'github')?.calls).toBe(1);
        expect((await currentLedger(f, 'github')).status).toBe('accepted');
        if (outcome === 'ambiguous') {
            expect((await currentLedger(f)).status).toBe('ambiguous');
            expect(result.blocked).toBe(1);
        } else {
            expect((await currentLedger(f)).status).toBe('waiting');
            expect((await currentLedger(f)).lastCode).toBe(outcome === 'budget' ? 'budget_exhausted' : 'rate_limited');
        }
    }
});

test('external links require current membership, current non-private source and validated destination URLs', async () => {
    const f = await fixture();
    await queue(f, 'notion');
    await queue(f, 'github');
    const actor = { kind: 'member', isAdmin: true, userId: f.owner.id, name: f.owner.name } as const;
    const adapters = providers.map(provider => ({ ...accepting(provider),
        externalLink: () => `https://${provider}.example/object`,
        validateExternalLink: (url: URL) => url.hostname === `${provider}.example` }));
    const options = { adapters };
    const links = await loadIntegrationLinks(f.project, actor, [f.source], options);
    expect(links.get(f.source.id)).toEqual([
        { provider: 'notion', url: 'https://notion.example/object' },
        { provider: 'github', url: 'https://github.example/object' }
    ]);
    expect(JSON.stringify([...links.values()])).not.toContain(f.connections.notion.id);
    expect((await loadIntegrationLinks(f.project, { kind: 'guest', visitorId: 'guest' }, [f.source], options)).size).toBe(0);
    expect((await loadIntegrationLinks(f.project, { kind: 'anonymous' }, [f.source], options)).size).toBe(0);

    for (const unsafe of ['http://notion.example/object', 'https://attacker.example/object', 'https://user:password@notion.example/object', 'javascript:alert(1)']) {
        const invalid = [{ ...adapters[0]!, externalLink: () => unsafe }];
        expect((await loadIntegrationLinks(f.project, actor, [f.source], { adapters: invalid })).size).toBe(0);
    }

    // Both the caller's snapshot and the stored source are checked, so stale cards cannot leak.
    await replaceSource(f, { private: true, syncVersion: 2 });
    expect((await loadIntegrationLinks(f.project, actor, [f.source], options)).size).toBe(0);
    await replaceSource(f, { private: false, syncVersion: 3 });
    expect((await loadIntegrationLinks(f.project, actor, [{ ...f.source, private: true }], options)).size).toBe(0);

    const notion = await currentLedger(f);
    await updateDoc<IntegrationSync>(notion.pk, notion.id, ledger => ({ ...ledger, deletion: { version: 4, deletedAt: old } }));
    expect((await loadIntegrationLinks(f.project, actor, [f.source], options)).get(f.source.id)).toEqual([{ provider: 'github', url: 'https://github.example/object' }]);
    await disconnectIntegration(f.project, 'github');
    expect((await loadIntegrationLinks(f.project, actor, [f.source], options)).size).toBe(0);
    await f.store.delete(f.project.pk, memberId(f.owner.id));
    expect((await loadIntegrationLinks(f.project, actor, [f.source], options)).size).toBe(0);
});

test('unbound project outbox work is acknowledged without provider calls or changing saved feedback', async () => {
    const f = await fixture();
    const unbound = (await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, integrations: {} })))!;
    expect(await discoverThreadIntegrationSync(unbound, f.source, { adapters: [] })).toBe(true);
    const current = (await f.comments.get(f.source.domain, f.source.id))!.comment;
    expect(current).toEqual({ ...f.source, syncPending: false });
    for (const provider of providers) expect(await f.store.query<IntegrationSync>({ type: `${provider}-sync`, pk: integrationPk(provider, f.project.id) })).toHaveLength(0);
});

test('turning off or changing a destination before a send retains work for a later authorized projection', async () => {
    for (const changed of ['turned_off', 'destination'] as const) {
        const f = await fixture();
        const candidate = await queue(f);
        let calls = 0;
        const provider = adapter('notion', async context => {
            await updateDoc<IntegrationConnection>(f.connections.notion.pk, f.connections.notion.id, connection => ({ ...connection,
                ...(changed === 'turned_off' ? { enabled: false } : { destinationRevision: connection.destinationRevision + 1 }) }));
            await context.operation({ step: 'create', planHash: hash }, async () => { calls++; });
            return { status: 'accepted' };
        });
        await processIntegrationDelivery(candidate, baseUrl, provider);
        const waiting = await currentLedger(f);
        expect(calls).toBe(0);
        expect(waiting.status).toBe('waiting');
        expect(waiting.active).toBe(true);
        expect(waiting.attempt).toBeUndefined();
        await updateDoc<IntegrationConnection>(f.connections.notion.pk, f.connections.notion.id, connection => ({ ...connection, enabled: true }));
        await processIntegrationDelivery(waiting, baseUrl, accepting('notion'), { now: () => Date.now() + 120_000 });
        expect((await currentLedger(f)).status).toBe('accepted');
        expect((await currentLedger(f)).processedVersion).toBe(1);
    }
});

test('new privacy or deletion cleanup is not stranded behind a previous failed or ambiguous content delivery', async () => {
    for (const status of ['failed', 'ambiguous'] as const) for (const reason of ['private', 'deleted'] as const) {
        const f = await fixture();
        const candidate = await queue(f);
        await processIntegrationDelivery(candidate, baseUrl, accepting('notion'));
        await updateDoc<IntegrationSync>(candidate.pk, candidate.id, ledger => ({ ...ledger, status, active: false, lastCode: 'old_delivery_failure' }));
        if (reason === 'private') {
            const source = await replaceSource(f, { private: true, syncVersion: 2, syncPending: true });
            await discoverThreadIntegrationSync(f.project, source, { adapters: providers.map(provider => accepting(provider)) });
        } else {
            const deletion = { version: 2, deletedAt: old };
            await enqueueIntegrationSync(f.project, 'notion', f.connections.notion.id, f.source.id, 2, { deletion });
        }
        const pending = await currentLedger(f);
        expect(pending.active).toBe(true);
        let cleanupCalls = 0;
        await processIntegrationDelivery(pending, baseUrl, adapter('notion', async context => {
            expect(context.mode).toBe('cleanup');
            expect(context.feedback).toBeNull();
            expect(context.ledger.state.remoteId).toBe('remote_notion');
            await context.operation({ step: 'delete', planHash: hash, repeatable: true }, async () => { cleanupCalls++; });
            await context.checkpoint({ cleaned: true }, { clearAttempt: true });
            return { status: 'accepted' };
        }));
        expect(cleanupCalls).toBe(1);
        expect((await currentLedger(f)).active).toBe(false);
    }
});

test('one project lookup failure leaves its signal pending while discovery queues another project', async () => {
    const failed = await fixture();
    const healthy = await fixture();
    const store: AppStore = { ...failed.store, async get<T extends AppDoc>(pk: string, id: string) {
        if (pk === projectRefPk(failed.project.id)) throw new Error('Injected one-project lookup failure');
        return failed.store.get<T>(pk, id);
    } };
    const result = await discoverIntegrationSync({ store, comments: { ...failed.comments,
        listSyncPending: async () => [failed.source, healthy.source] }, adapters: providers.map(provider => accepting(provider)) });
    expect(result.deferred).toBe(1);
    expect(result.checked).toBe(1);
    expect((await failed.comments.get(failed.source.domain, failed.source.id))!.comment.syncPending).toBe(true);
    expect((await healthy.comments.get(healthy.source.domain, healthy.source.id))!.comment.syncPending).toBe(false);
    expect((await currentLedger(healthy, 'github')).requestedVersion).toBe(1);
});

test('a provider pending or review-count query failure does not skip another provider turn', async () => {
    for (const stage of ['pending', 'review_count'] as const) {
        const f = await fixture();
        await queue(f, 'notion');
        await queue(f, 'github');
        const clock = Math.ceil(Date.now() / 600_000) * 600_000;
        const delivered: string[] = [];
        const store: AppStore = { ...f.store, async query<T extends AppDoc>(query: DocQuery<T['type']>) {
            if (query.type === 'notion-sync' && query.where?.active === (stage === 'pending')) throw new Error(`Injected ${stage} query failure`);
            const values = await f.store.query<T>(query);
            return values.filter(value => !('projectId' in value) || value.projectId === f.project.id);
        } };
        const result = await runIntegrationWorker(baseUrl, { adapters: providers.map(provider => accepting(provider, delivered)), store,
            comments: { ...f.comments, listSyncPending: async () => [] }, budgetMs: 60_000, now: () => clock });
        expect(delivered).toContain('github');
        expect(result.providers.find(provider => provider.provider === 'github')?.calls).toBe(1);
        expect((await currentLedger(f, 'github')).status).toBe('accepted');
    }
});

test('bounded discovery advances past an unsupported source and returns to retry it after healthy work', async () => {
    const fixtures = [await fixture(), await fixture()].sort((a, b) => a.source.syncKey!.localeCompare(b.source.syncKey!));
    const unsupported = fixtures[0]!;
    const healthy = fixtures[1]!;
    await updateDoc<DbProject>(unsupported.project.pk, unsupported.project.id, project => ({ ...project,
        integrations: { slack: { connectionId: `unavailable_${project.id}`, since: old } } }));
    await unsupported.store.delete('integrations:worker', 'pending');
    const ids = new Set(fixtures.map(value => value.source.id));
    const pages: { limit?: number; after?: string }[] = [];
    const comments = { ...unsupported.comments, async listSyncPending(options: { limit?: number; after?: string } = {}) {
        pages.push({ ...options });
        return (await unsupported.comments.listSyncPending({ limit: 1000 }))
            .filter(source => ids.has(source.id) && (!options.after || source.syncKey! > options.after))
            .sort((a, b) => a.syncKey!.localeCompare(b.syncKey!)).slice(0, options.limit ?? 100);
    } };
    const options = { comments, adapters: providers.map(provider => accepting(provider)), maxSources: 1 };
    const first = await discoverIntegrationSync(options);
    expect(first).toEqual({ checked: 0, deferred: 1 });
    expect((await unsupported.comments.get(unsupported.source.domain, unsupported.source.id))!.comment.syncPending).toBe(true);
    expect(await unsupported.store.query<IntegrationSync>({ type: 'github-sync', pk: integrationPk('github', healthy.project.id) })).toHaveLength(0);
    const second = await discoverIntegrationSync(options);
    expect(second).toEqual({ checked: 1, deferred: 0 });
    expect((await healthy.comments.get(healthy.source.domain, healthy.source.id))!.comment.syncPending).toBe(false);
    expect((await currentLedger(healthy, 'github')).requestedVersion).toBe(1);
    const third = await discoverIntegrationSync(options);
    expect(third).toEqual({ checked: 0, deferred: 1 });
    expect(pages.every(page => page.limit === 1)).toBe(true);
    expect(pages[1]?.after).toBe(unsupported.source.syncKey);
    expect(pages[2]?.after).toBe(healthy.source.syncKey);
    expect(pages[3]?.after).toBeUndefined();
});

test('a binding attached during tombstone fan-out keeps the intent until the added target is queued', async () => {
    const f = await fixture();
    const initial = (await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project,
        integrations: { notion: project.integrations!.notion } })))!;
    const tombstone: DbSyncTombstone = { type: 'tombstone', id: `$tombstone_${f.source.id}`, domain: f.source.domain,
        projectId: f.project.id, commentId: f.source.id, syncVersion: 2,
        syncKey: syncPendingKey(f.source.domain, `$tombstone_${f.source.id}`), syncPending: true, deletedAt: old,
        targets: [{ provider: 'notion', connectionId: f.connections.notion.id }], ttl: 30 * 24 * 60 * 60 };
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.deleteWithTombstone(f.source.domain, f.source.id, stored.etag, tombstone)).toBe('ok');
    let attached = false;
    const racing: AppStore = { ...f.store, async create<T extends AppDoc>(doc: T) {
        const result = await f.store.create(doc);
        if (doc.type === 'notion-sync' && !attached) {
            attached = true;
            await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project,
                integrations: { ...project.integrations, github: f.project.integrations!.github } }));
        }
        return result;
    } };
    const adapters = providers.map(provider => accepting(provider));
    expect(await discoverThreadIntegrationSync(initial, tombstone, { adapters, store: racing })).toBe(false);
    expect((await f.comments.listSyncPending({ limit: 1000 })).some(source => source.id === tombstone.id)).toBe(true);
    expect(await f.store.query<IntegrationSync>({ type: 'github-sync', pk: integrationPk('github', f.project.id) })).toHaveLength(0);
    const currentProject = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc;
    expect(await discoverThreadIntegrationSync(currentProject, tombstone, { adapters })).toBe(true);
    expect((await currentLedger(f, 'github')).deletion).toEqual({ version: 2, deletedAt: old });
    expect((await f.comments.listSyncPending({ limit: 1000 })).some(source => source.id === tombstone.id)).toBe(false);
});

test('a new operation proven unsent after persistence does not manufacture create ambiguity', async () => {
    const f = await fixture();
    const candidate = await queue(f);
    let interrupted = false;
    let calls = 0;
    const store: AppStore = { ...f.store, async replace<T extends AppDoc>(doc: T, etag: string) {
        const result = await f.store.replace(doc, etag);
        if (result === 'ok' && doc.type === 'notion-sync' && 'attempt' in doc && doc.attempt && !interrupted) {
            interrupted = true;
            await replaceSource(f, { private: true, syncVersion: 2, syncPending: true });
        }
        return result;
    } };
    await processIntegrationDelivery(candidate, baseUrl, adapter('notion', async context => {
        await context.operation({ step: 'create', planHash: hash }, async () => { calls++; });
        return { status: 'accepted' };
    }), { store });
    const saved = await currentLedger(f);
    expect(interrupted).toBe(true);
    expect(calls).toBe(0);
    expect(saved.status).toBe('waiting');
    expect(saved.active).toBe(true);
    expect(saved.lastCode).toBe('projection_changed');
    expect(saved.attempt).toBeUndefined();
    expect(saved.processedVersion).toBe(-1);
});
