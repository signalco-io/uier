import type { AppDoc } from '../app/model';
import { getAppStore, updateDoc } from '../app/store';
import { processIntegrationDelivery, type DeliveryOptions } from './delivery';
import type { IntegrationAdapter, IntegrationSync } from './model';

type StatusCursor = AppDoc & { type: 'integration-status-cursor'; afterId?: string };

/** Rotating bounded scan. Polling shares each ledger's outbound lease and provider call budget. */
export async function pollIntegrationStatuses(baseUrl: string, adapter: IntegrationAdapter, options: DeliveryOptions = {}) {
    if (!adapter.supportsStatusSync || !adapter.isConfigured()) return { checked: 0, calls: 0 };
    const store = options.store ?? getAppStore();
    const now = options.now ?? Date.now;
    const pk = 'integration-status'; const id = adapter.provider;
    await store.create<StatusCursor>({ type: 'integration-status-cursor', pk, id });
    const cursor = (await store.get<StatusCursor>(pk, id))!.doc;
    const rows = await store.query<IntegrationSync>({ type: `${adapter.provider}-sync`, where: { status: 'accepted', active: false },
        limit: 100, orderBy: 'id', ...(cursor.afterId ? { afterId: cursor.afterId } : {}) });
    let checked = 0; let calls = 0; let afterId = cursor.afterId;
    for (const row of rows) {
        if (now() >= (options.deadline ?? Infinity) || calls >= (options.maxCalls ?? 20)) break;
        try {
            await processIntegrationDelivery(row, baseUrl, adapter, { ...options, statusOnly: true,
                maxCalls: (options.maxCalls ?? 20) - calls, onRequest: () => { calls++; options.onRequest?.(); } });
        } catch { /* A failed row must not starve later projects. Its cursor cycles back. */ }
        afterId = row.id; checked++;
    }
    if (checked === rows.length && rows.length < 100) afterId = undefined;
    await updateDoc<StatusCursor>(pk, id, current => ({ ...current, afterId }), store);
    return { checked, calls };
}
