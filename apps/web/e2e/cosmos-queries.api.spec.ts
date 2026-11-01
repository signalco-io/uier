import { randomUUID } from 'node:crypto';
import type { Container, QueryIterator } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import type { AppDoc } from '../src/lib/app/model';
import { createCosmosAppStore, createMemoryAppStore } from '../src/lib/app/store';
import { cosmosPoint, cosmosQueryAll } from '../src/lib/db/diagnostics';
import { runIntegrationWorker } from '../src/lib/integrations/worker';
import { runNotificationWorker, type NotificationDelivery } from '../src/lib/notifications/delivery';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

test('complete queries drain empty continuation pages and accumulate safe diagnostics once', async () => {
    const previous = process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE;
    const original = console.info;
    const logs: unknown[][] = [];
    process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE = '1';
    console.info = (...values) => { logs.push(values); };
    let index = 0;
    // Equal ids in different partitions must survive; telemetry must not retain either value.
    const pages = [
        { resources: [{ id: 'same-secret-id', pk: 'secret-one' }], requestCharge: 4 },
        { resources: [], requestCharge: 2 },
        { resources: [{ id: 'same-secret-id', pk: 'secret-two' }], requestCharge: 3,
            diagnostics: { clientSideRequestStatistics: { retryDiagnostics: { failedAttempts: [{ statusCode: 429 }, { statusCode: 503 }] } }, secret: 'never-log' } }
    ];
    try {
        const rows = await cosmosQueryAll({ hasMoreResults: () => index < pages.length,
            fetchNext: async () => pages[index++] } as unknown as QueryIterator<unknown>,
        { operation: 'app.query.member.all', container: 'app-preview', partition: 'cross' });
        expect(rows).toHaveLength(2);
        expect(logs).toHaveLength(1);
        expect(JSON.parse(String(logs[0]?.[1]))).toMatchObject({ requestCharge: 9, rows: 2, pages: 3, retries: 2, throttles: 1, failed: false });
        expect(JSON.stringify(logs)).not.toMatch(/secret|never-log/);
        await expect(cosmosPoint(async () => { throw null; }, { operation: 'app.get.user', container: 'app', partition: 'single' })).rejects.toBeNull();
        expect(JSON.parse(String(logs[1]?.[1]))).toMatchObject({ failed: true, requestCharge: 0 });
    } finally {
        console.info = original;
        if (previous === undefined) delete process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE;
        else process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE = previous;
    }
});

test('Cosmos exact counts use the same parameterized filters and known partition without TOP', async () => {
    const captured: { input: { query: string; parameters: unknown[] }; options: unknown }[] = [];
    const container = { id: 'app-preview', items: { query(input: { query: string; parameters: unknown[] }, options: unknown) {
        captured.push({ input, options });
        let pending = true;
        return { hasMoreResults: () => pending, async fetchNext() { pending = false; return { resources: [1201], requestCharge: 3 }; } };
    } } } as unknown as Container;
    expect(await createCosmosAppStore(() => container).count({ type: 'github-sync', pk: 'github:private-project',
        where: { active: false, status: 'failed' } })).toBe(1201);
    expect(captured[0]?.options).toEqual({ partitionKey: 'github:private-project' });
    expect(captured[0]?.input.query).toBe('SELECT VALUE COUNT(1) FROM c WHERE c.type = @type AND c.pk = @pk AND c.active = @p0 AND c.status = @p1');
    expect(captured[0]?.input.parameters).toContainEqual({ name: '@p1', value: 'failed' });
    await expect(createCosmosAppStore(() => container).count({ type: 'member', where: { 'id OR true': 'bad' } })).rejects.toThrow('Unsupported query field');
});

test('counts are complete across partitions and notification due work has no new truncation', async () => {
    const store = createMemoryAppStore();
    const prefix = `cost-test:${randomUUID()}`;
    const docs = [];
    for (let index = 0; index < 1201; index++) {
        const doc = { type: 'github-sync', pk: `${prefix}:${index % 12}`, id: String(Math.floor(index / 12)), active: false, status: 'failed' };
        docs.push(doc); await store.create(doc);
    }
    // A filter on the unique fixture keeps independent in-process tests out of this invocation.
    const isolated = { ...store, async count(input: Parameters<typeof store.count>[0]) {
        return (await store.query(input)).filter(row => row.pk.startsWith(prefix)).length;
    } };
    try {
        expect(await isolated.count({ type: 'github-sync', where: { active: false, status: 'failed' } })).toBe(1201);
        expect((await runIntegrationWorker('https://example.test', { store: isolated, comments: { ...getMemoryCommentsStore(), listSyncPending: async () => [] },
            adapters: [{ provider: 'github', isConfigured: () => false, deliver: async () => ({ status: 'accepted' }) }] })).blocked).toBe(1201);
        for (const [index, time] of ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'].entries()) {
            const doc = { type: 'notification-delivery', pk: `${prefix}:notifications:${index}`, id: 'equal-id', active: true, nextAttemptAt: time };
            docs.push(doc); await store.create(doc);
        }
        const selected: NotificationDelivery[] = [];
        const notificationStore = { ...store, async query<T extends AppDoc>(input: Parameters<typeof store.query>[0]) {
            const rows = (await store.query<T>(input)).filter(row => row.pk.startsWith(prefix));
            if (input.where?.active === true) {
                expect(input.dueBefore).toBeDefined(); expect(input.limit).toBeUndefined();
                selected.push(...rows as unknown as NotificationDelivery[]);
                // Change/delete on the selection boundary: the existing leased point recheck must win.
                for (const row of rows) {
                    if (row.pk === `${prefix}:notifications:1`) {
                        const current = (await store.get(row.pk, row.id))!;
                        await store.replace({ ...current.doc, nextAttemptAt: '2099-01-01T00:00:00.000Z' }, current.etag);
                    } else await store.delete(row.pk, row.id);
                }
            }
            return rows;
        } };
        await runNotificationWorker('https://example.test', async () => { throw new Error('Deleted delivery must not send'); }, notificationStore);
        expect(selected).toHaveLength(2);
        expect((await store.get(`${prefix}:notifications:1`, 'equal-id'))?.doc).toMatchObject({ active: true, nextAttemptAt: '2099-01-01T00:00:00.000Z' });
        expect((await store.get(`${prefix}:notifications:2`, 'equal-id'))?.doc).toMatchObject({ active: true });
    } finally { for (const doc of docs) await store.delete(doc.pk, doc.id); }
});
