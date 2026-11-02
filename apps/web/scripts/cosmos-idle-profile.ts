import type { Container } from '@azure/cosmos';
import type { AppDoc } from '../src/lib/app/model';
import { createCosmosAppStore, type AppStore } from '../src/lib/app/store';
import { runNotificationWorker } from '../src/lib/notifications/delivery';
import { runIntegrationWorker } from '../src/lib/integrations/worker';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { IntegrationAdapter } from '../src/lib/integrations/model';

/** Real app-container idle turns, isolated from every existing preview document and provider. */
export async function profileIdle(container: Container, prefix: string) {
    if (container.id !== 'app-preview' || !prefix.startsWith('profile279:')) throw new Error('Idle profile write guard rejected');
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COSMOS_WORKLOAD = 'scheduled';
    process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE = '1';
    // The scheduled worker's comments queries are measured separately by the read-only probe.
    // Keep outbox discovery empty here: it must never reach a real user or external provider.
    if (process.env.COSMOSDB_ENDPOINT || process.env.COSMOSDB_CONNECTION_STRING) throw new Error('Idle profile needs an unconfigured default store');
    const inner = createCosmosAppStore(() => container);
    const created = new Map<string, { pk: string; id: string }>();
    const logs: Record<string, number | string>[] = [];
    const original = console.info;
    const physicalPk = (pk: string) => `${prefix}:${pk}`;
    const logical = <T extends AppDoc>(doc: T) => ({ ...doc, pk: doc.pk.slice(prefix.length + 1) });
    const unsupported = async (): Promise<never> => { throw new Error('Unexpected idle profile mutation'); };
    const store: AppStore = {
        async get<T extends AppDoc>(pk: string, id: string) {
            const found = await inner.get<T>(physicalPk(pk), id);
            return found ? { ...found, doc: logical(found.doc) } : null;
        },
        async create(doc) {
            const identity = { pk: physicalPk(doc.pk), id: doc.id };
            created.set(`${identity.pk}:${identity.id}`, identity);
            return inner.create({ ...doc, ...identity, profileRun: prefix, ttl: 3600 });
        },
        async replace(doc, etag) { return inner.replace({ ...doc, pk: physicalPk(doc.pk), profileRun: prefix, ttl: 3600 }, etag); },
        createAll: unsupported, replaceAndDelete: unsupported, transact: unsupported, delete: unsupported,
        async query<T extends AppDoc>(input: Parameters<AppStore['query']>[0]) {
            return (await inner.query<T>({ ...input, ...(input.pk ? { pk: physicalPk(input.pk) } : {}),
                where: { ...input.where, profileRun: prefix } })).map(logical);
        },
        async count(input) { return inner.count({ ...input, ...(input.pk ? { pk: physicalPk(input.pk) } : {}), where: { ...input.where, profileRun: prefix } }); }
    };
    console.info = (...args) => { if (args[0] === '[cosmos]') logs.push(JSON.parse(String(args[1])) as Record<string, number | string>); };
    const begin = performance.now();
    try {
        const notifications = await runNotificationWorker('https://example.test', unsupported, store);
        const adapters: IntegrationAdapter[] = (['github', 'linear', 'notion', 'slack', 'azure-devops'] as const)
            .map(provider => ({ provider, isConfigured: () => false, deliver: unsupported }));
        const integrations = await runIntegrationWorker('https://example.test', { store, comments: getMemoryCommentsStore(), adapters });
        if (notifications.checked || notifications.blocked || integrations.checked || integrations.blocked || integrations.discovered.deferred)
            throw new Error('Idle profile unexpectedly found work');
        return { durationMs: Math.round(performance.now() - begin), measurements: logs };
    } finally {
        console.info = original;
        process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE = '0';
        for (const identity of created.values()) await inner.delete(identity.pk, identity.id);
        if (await inner.count({ type: 'integration-discovery-cursor', where: { profileRun: prefix } })) throw new Error('Idle cleanup incomplete');
    }
}
