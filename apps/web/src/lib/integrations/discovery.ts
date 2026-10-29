import { randomUUID } from 'node:crypto';
import { projectRefPk, workspacePk, type AppDoc, type DbProject, type DbProjectRef } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import type { DbComment, DbSyncTombstone } from '../db/schema';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { integrationTargets } from './syncSignal';
import { integrationRegistry } from './registry';
import type { IntegrationAdapter, IntegrationConnection, IntegrationProviderId, IntegrationSync } from './model';

export const integrationPk = (provider: IntegrationProviderId, projectId: string) => `${provider}:${projectId}`;
export const integrationSyncId = (provider: IntegrationProviderId, connectionId: string, projectId: string, threadId: string) =>
    `${provider}_${sha256Hex(`${connectionId}:${projectId}:${threadId}`)}`;

export async function integrationProject(projectId: string, store: AppStore = getAppStore()) {
    const ref = (await store.get<DbProjectRef>(projectRefPk(projectId), projectId))?.doc;
    if (!ref || ref.type !== 'project-ref' || projectId === PUBLIC_PROJECT_ID) return null;
    const project = (await store.get<DbProject>(workspacePk(ref.workspaceId), projectId))?.doc;
    return project?.type === 'project' && project.workspaceId === ref.workspaceId ? project : null;
}

/** Idempotent outbox fan-out. Forced requests have a stable id so a backfill crash can replay. */
export async function enqueueIntegrationSync(project: DbProject, provider: IntegrationProviderId, connectionId: string,
    threadId: string, version: number, options: { deletion?: IntegrationSync['deletion']; cleanup?: boolean; requestId?: string;
        destinationRevision?: number; store?: AppStore; now?: number } = {}) {
    const store = options.store ?? getAppStore();
    if (project.id === PUBLIC_PROJECT_ID || !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid integration source');
    const next: IntegrationSync = {
        type: `${provider}-sync`, provider, pk: integrationPk(provider, project.id),
        id: integrationSyncId(provider, connectionId, project.id, threadId),
        workspaceId: project.workspaceId, projectId: project.id, connectionId, threadId,
        requestedVersion: version, processedVersion: -1, requestRevision: 1, processedRequestRevision: 0,
        ...(options.requestId ? { reconcileRequestId: options.requestId } : {}),
        ...(options.destinationRevision !== undefined ? { reconcileDestinationRevision: options.destinationRevision } : {}),
        sourceRequestedVersion: options.requestId ? -1 : version,
        ...(options.deletion ? { deletion: options.deletion } : {}), tombstoned: false,
        active: true, failures: 0, nextAttemptAt: new Date(options.now ?? Date.now()).toISOString(), status: 'queued', state: {}
    };
    if (await store.create(next)) return next;
    const saved = await updateDoc<IntegrationSync>(next.pk, next.id, current => {
        if (current.provider !== provider || current.connectionId !== connectionId || current.projectId !== project.id
            || current.workspaceId !== project.workspaceId || current.threadId !== threadId) throw new Error('Integration ledger identity mismatch');
        const previousSourceVersion = current.sourceRequestedVersion ?? (current.reconcileRequestId ? -1 : current.requestedVersion);
        const changed = version > current.requestedVersion || (!options.requestId && version > previousSourceVersion)
            || (options.requestId !== undefined && options.requestId !== current.reconcileRequestId)
            || (options.deletion !== undefined && (!current.deletion || options.deletion.version > current.deletion.version));
        const cleanupChanged = changed && (options.deletion !== undefined || options.cleanup === true);
        return { ...current, requestedVersion: Math.max(current.requestedVersion, version),
            ...(cleanupChanged ? { status: 'queued' as const, failures: 0, nextAttemptAt: next.nextAttemptAt } : {}),
            ...(options.deletion && (!current.deletion || options.deletion.version >= current.deletion.version) ? { deletion: options.deletion } : {}),
            ...(options.requestId ? { reconcileRequestId: options.requestId } : {}),
            ...(options.destinationRevision !== undefined ? { reconcileDestinationRevision: options.destinationRevision } : {}),
            sourceRequestedVersion: options.requestId ? previousSourceVersion : Math.max(previousSourceVersion, version),
            requestRevision: current.requestRevision + (changed ? 1 : 0),
            // A discovery retry must not bypass an explicit ambiguity/failure review.
            active: cleanupChanged ? true
                : current.status === 'failed' || current.status === 'ambiguous' ? false
                : current.active || changed || current.processedVersion < version };
    }, store);
    if (!saved) throw new Error('Integration ledger disappeared during discovery');
    return saved;
}

export type DiscoveryOptions = { store?: AppStore; comments?: CommentsStore; adapters?: readonly IntegrationAdapter[];
    deadline?: number; maxSources?: number; now?: () => number };

export async function discoverThreadIntegrationSync(project: DbProject, source: DbComment | DbSyncTombstone, options: DiscoveryOptions = {}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    if (project.id === PUBLIC_PROJECT_ID || source.projectId !== project.id || source.domain !== `project:${project.id}`) return false;
    const registry = integrationRegistry(options.adapters);
    const tombstone = 'type' in source && source.type === 'tombstone' ? source : null;
    const projectTargets = integrationTargets(project);
    const targets = tombstone
        ? [...new Map([...tombstone.targets, ...projectTargets].map(target => [`${target.provider}:${target.connectionId}`, target])).values()]
        : projectTargets;
    const version = source.syncVersion ?? 0;
    let unavailable = false;
    for (const target of targets) {
        if (!registry.has(target.provider)) { unavailable = true; continue; }
        await enqueueIntegrationSync(project, target.provider, target.connectionId, tombstone ? tombstone.commentId : source.id,
            version, { store, cleanup: !tombstone && ('private' in source && source.private === true),
                ...(tombstone ? { deletion: { version, deletedAt: tombstone.deletedAt } } : {}) });
    }
    if (unavailable) return false;
    // A binding added midway through fan-out must also receive the observed source version.
    const latestProject = await integrationProject(project.id, store);
    if (!latestProject || JSON.stringify(integrationTargets(latestProject)) !== JSON.stringify(projectTargets)) return false;
    if (tombstone) return await comments.deleteTombstone(source.domain, tombstone.commentId, version) === 'ok';
    const current = await comments.get(source.domain, source.id);
    if (!current || (current.comment.syncVersion ?? 0) !== version) return false;
    return await comments.replace({ ...current.comment, syncPending: false }, current.etag) === 'ok';
}

export async function discoverIntegrationSync(options: DiscoveryOptions = {}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    let checked = 0;
    let deferred = 0;
    const now = options.now ?? Date.now;
    const maxSources = Math.max(1, Math.min(1000, options.maxSources ?? 100));
    type Cursor = AppDoc & { type: 'integration-discovery-cursor'; after?: string };
    const identity = { pk: 'integrations:worker', id: 'pending' };
    let after: string | undefined;
    let sources: (DbComment | DbSyncTombstone)[];
    try {
        after = (await store.get<Cursor>(identity.pk, identity.id))?.doc.after;
        sources = await comments.listSyncPending({ limit: maxSources, after });
        if (!sources.length && after) sources = await comments.listSyncPending({ limit: maxSources });
    } catch { return { checked, deferred: 1 }; }
    let cursor: string | undefined;
    for (const source of sources) {
        if (options.deadline !== undefined && now() >= options.deadline) { deferred += sources.length - checked - deferred; break; }
        cursor = `${source.domain}:${source.id}`;
        try {
            const project = source.projectId ? await integrationProject(source.projectId, store) : null;
            if (!project) { deferred++; continue; }
            if (await discoverThreadIntegrationSync(project, source, { ...options, store, comments })) checked++;
            else deferred++;
        } catch {
            // Leave the outbox flag set. Another project or provider still gets its bounded turn.
            deferred++;
        }
    }
    try {
        const next: Cursor = { ...identity, type: 'integration-discovery-cursor', after: cursor };
        if (!await store.create(next)) await updateDoc<Cursor>(next.pk, next.id, current => ({ ...current, after: cursor }), store);
    } catch { deferred++; }
    return { checked, deferred };
}

/** Explicitly selected provider only. No shared pending flag is changed by a backfill. */
export async function enqueueIntegrationBackfill(project: DbProject, provider: IntegrationProviderId, connectionId: string,
    sources: readonly DbComment[], requestId: string = randomUUID(), store: AppStore = getAppStore()) {
    const latest = (await store.get<DbProject>(project.pk, project.id))?.doc;
    const binding = latest?.integrations?.[provider];
    if (binding?.connectionId !== connectionId) throw new Error('Integration backfill binding changed');
    const connection = (await store.get<IntegrationConnection>(project.pk, connectionId))?.doc;
    if (!connection || connection.type !== `${provider}-connection` || connection.workspaceId !== project.workspaceId
        || connection.projectId !== project.id) throw new Error('Integration backfill connection changed');
    let queued = 0;
    for (const source of sources) {
        if (source.projectId !== project.id || source.domain !== `project:${project.id}` || source.private || isPrivateAppFeedback(source)) continue;
        await enqueueIntegrationSync(project, provider, connectionId, source.id, source.syncVersion ?? 0,
            { store, requestId, destinationRevision: connection.destinationRevision });
        queued++;
    }
    return { requestId, queued };
}
