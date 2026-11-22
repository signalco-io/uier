import { getAppStore, type AppStore } from '../app/store';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { processIntegrationDelivery } from './delivery';
import { discoverThreadIntegrationSync, integrationPk, integrationProject, integrationSyncId } from './discovery';
import type { IntegrationAdapter, IntegrationSync } from './model';
import { integrationRegistry } from './registry';
import { integrationTargets } from './syncSignal';
import type { DbProject } from '../app/model';
import type { DbReviewRelease } from '../db/schema';
import { getIntegrationConnection } from './connection';
import { reviewGroupIdentity } from './reviewGroups';

/**
 * Updates the copies a thread already has now instead of on the next worker run, for providers
 * that opt in (`deliversAfterChange`). A thread without a copy waits for the worker, which keeps
 * the batching window for a new comment's edits and deletion. This uses the worker's discovery,
 * ledger leases and authority checks; whatever it skips or cannot finish stays queued for it.
 */
export async function deliverThreadNow(projectId: string, threadId: string, options: {
    baseUrl: string; deadline: number; store?: AppStore; comments?: CommentsStore; adapters?: readonly IntegrationAdapter[];
}) {
    const store = options.store ?? getAppStore(); const comments = options.comments ?? getCommentsStore();
    const project = await integrationProject(projectId, store);
    if (!project) return 0;
    const registry = integrationRegistry(options.adapters);
    const ready: { ledger: IntegrationSync; adapter: IntegrationAdapter }[] = [];
    for (const target of integrationTargets(project)) {
        const adapter = registry.get(target.provider);
        if (!adapter?.deliversAfterChange || !adapter.isConfigured()) continue;
        const ledger = (await store.get<IntegrationSync>(integrationPk(target.provider, projectId),
            integrationSyncId(target.provider, target.connectionId, projectId, threadId)))?.doc;
        if (ledger && adapter.deliversAfterChange(ledger)) ready.push({ ledger, adapter });
    }
    if (!ready.length) return 0;
    const source = (await comments.get(`project:${projectId}`, threadId))?.comment;
    if (source?.syncPending) await discoverThreadIntegrationSync(project, source, { store, comments, adapters: options.adapters });
    let checked = 0;
    for (const { ledger, adapter } of ready) {
        if (Date.now() >= options.deadline) break;
        await processIntegrationDelivery(ledger, options.baseUrl, adapter, { store, comments, deadline: options.deadline });
        checked++;
    }
    return checked;
}

/** Spend a short post-response turn on this committed review. Scheduled discovery owns the tail. */
export async function deliverReviewNow(project: DbProject, release: DbReviewRelease, options: {
    baseUrl: string; deadline: number; store?: AppStore; comments?: CommentsStore; adapters?: readonly IntegrationAdapter[];
}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const registry = integrationRegistry(options.adapters);
    const targets = integrationTargets(project);
    const ids: string[] = [];
    for (const id of release.threadIds) {
        if (Date.now() >= options.deadline) break;
        const source = (await comments.get(release.domain, id))?.comment;
        if (source?.syncPending) await discoverThreadIntegrationSync(project, source, { store, comments, adapters: options.adapters });
        if (source) ids.push(id);
        // The first group-eligible child can register the whole published revision.
        if (ids.length >= 5) break;
    }
    let checked = 0;
    for (const [index, target] of targets.entries()) {
        if (Date.now() >= options.deadline) break;
        const adapter = registry.get(target.provider);
        if (!adapter?.supportsSessionGroups || !adapter.isConfigured()) continue;
        const connection = await getIntegrationConnection(project, target.provider, store);
        if (!connection || connection.id !== target.connectionId) continue;
        const deadline = Date.now() + Math.floor((options.deadline - Date.now()) / (targets.length - index));
        const { pk, id } = reviewGroupIdentity(project, connection, release.sessionId);
        const parent = (await store.get<IntegrationSync>(pk, id))?.doc;
        if (parent?.active) await processIntegrationDelivery(parent, options.baseUrl, adapter, { store, comments, deadline });
        for (const threadId of ids) {
            if (Date.now() >= deadline) break;
            const ledger = (await store.get<IntegrationSync>(pk, integrationSyncId(target.provider, connection.id, project.id, threadId)))?.doc;
            if (!ledger?.active) continue;
            await processIntegrationDelivery(ledger, options.baseUrl, adapter, { store, comments, deadline });
            checked++;
        }
    }
    return checked;
}
