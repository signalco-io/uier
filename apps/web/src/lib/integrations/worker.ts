import { getAppStore, updateDoc } from '../app/store';
import { getCommentsStore } from '../repo/commentsStore';
import { discoverIntegrationSync, type DiscoveryOptions } from './discovery';
import { processIntegrationDelivery, type DeliveryOptions } from './delivery';
import { isIntegrationProvider, type IntegrationProviderId, type IntegrationSync } from './model';
import { configuredIntegrationAdapters, integrationRegistry } from './registry';

export const INTEGRATION_RUN_BUDGET_MS = 8 * 60_000;
export type IntegrationWorkerOptions = DiscoveryOptions & Pick<DeliveryOptions, 'now' | 'exportFeedback'> & { budgetMs?: number };

/** Providers get independent turns, call budgets and durable retry state within one job deadline. */
export async function runIntegrationWorker(baseUrl: string, options: IntegrationWorkerOptions = {}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const now = options.now ?? Date.now;
    const deadline = now() + Math.max(0, Math.min(options.budgetMs ?? INTEGRATION_RUN_BUDGET_MS, INTEGRATION_RUN_BUDGET_MS));
    const adapters = [...integrationRegistry(options.adapters).values()];
    let discovered: { checked: number; deferred: number };
    try {
        discovered = await discoverIntegrationSync({ ...options, store, comments, deadline: now() + Math.min(30_000, Math.max(0, deadline - now()) / 4) });
    } catch { discovered = { checked: 0, deferred: 1 }; }
    // Deterministic rotation needs no process-local cursor or additional cross-partition write.
    const start = adapters.length ? Math.floor(now() / (5 * 60_000)) % adapters.length : 0;
    const ordered = [...adapters.slice(start), ...adapters.slice(0, start)];
    const results: { provider: IntegrationProviderId; checked: number; blocked: number; deferred: number; calls: number }[] = [];
    for (let index = 0; index < ordered.length; index++) {
        const adapter = ordered[index]!;
        const allowance = Math.max(0, Math.floor((deadline - now()) / (ordered.length - index)));
        const providerDeadline = Math.min(deadline, now() + Math.min(allowance, adapter.maxRunMs ?? allowance));
        let checked = 0;
        let calls = 0;
        let deferred = 0;
        let pending: IntegrationSync[];
        try {
            pending = (await store.query<IntegrationSync>({ type: `${adapter.provider}-sync`, where: { active: true },
                limit: 100, orderBy: 'nextAttemptAt', dueBefore: new Date(now()).toISOString() }))
                .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.id.localeCompare(b.id));
        } catch {
            results.push({ provider: adapter.provider, checked, calls, deferred: 1, blocked: 0 });
            continue;
        }
        for (const ledger of pending) {
            if (now() >= providerDeadline || calls >= (adapter.maxCalls ?? 100)) { deferred++; continue; }
            if (Date.parse(ledger.nextAttemptAt) > now()) continue;
            try {
                await processIntegrationDelivery(ledger, baseUrl, adapter, { ...options, store, comments, deadline: providerDeadline,
                    maxCalls: (adapter.maxCalls ?? 100) - calls, onRequest: () => { calls++; } });
                checked++;
            } catch {
                // One failed store/adapter turn cannot skip every subsequent provider.
                deferred++;
            }
        }
        let stopped: IntegrationSync[] = [];
        try {
            for (const status of ['failed', 'ambiguous'] as const) stopped.push(...await store.query<IntegrationSync>({
                type: `${adapter.provider}-sync`, where: { active: false, status }, limit: 1000 }));
        }
        catch { deferred++; }
        results.push({ provider: adapter.provider, checked, calls, deferred,
            blocked: stopped.filter(ledger => ledger.status === 'failed' || ledger.status === 'ambiguous').length });
    }
    return { discovered, providers: results, checked: results.reduce((n, result) => n + result.checked, 0),
        blocked: results.reduce((n, result) => n + result.blocked, 0) };
}

/** Operator retry retains an uncertain operation, so the adapter must reconcile before resending. */
export async function retryIntegrationSync(input: { provider: IntegrationProviderId; id: string }, store = getAppStore()) {
    if (!isIntegrationProvider(input.provider) || !new RegExp(`^${input.provider}_[a-f0-9]{64}$`).test(input.id))
        throw new Error('Invalid integration ledger id');
    if (!integrationRegistry(configuredIntegrationAdapters).has(input.provider)) throw new Error('Integration provider is unavailable');
    const matches = await store.query<IntegrationSync>({ type: `${input.provider}-sync`, where: { id: input.id } });
    if (matches.length !== 1) throw new Error('Integration ledger was not found');
    const ledger = matches[0]!;
    if (ledger.status !== 'failed' && ledger.status !== 'ambiguous') throw new Error('Integration ledger does not need recovery');
    await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => {
        if (current.lease && Date.parse(current.lease.until) > Date.now()) throw new Error('Integration ledger is still leased');
        return { ...current, active: true, failures: 0, status: 'queued', nextAttemptAt: new Date().toISOString() };
    }, store);
}
