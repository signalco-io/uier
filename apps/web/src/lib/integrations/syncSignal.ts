import type { DbProject } from '../app/model';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { syncTombstoneId, type DbComment, type DbSyncTombstone } from '../db/schema';
import type { IntegrationProviderId } from './model';

const providers = ['notion', 'github', 'linear', 'slack'] as const satisfies readonly IntegrationProviderId[];
export const syncTombstoneTtlSeconds = 30 * 24 * 60 * 60;

export const syncPendingKey = (domain: string, id: string) => `${domain}:${id}`;

/** A bounded snapshot of destinations; external input never selects an arbitrary provider. */
export function integrationTargets(project: Pick<DbProject, 'id' | 'integrations'>): DbSyncTombstone['targets'] {
    if (project.id === PUBLIC_PROJECT_ID) return [];
    return providers.flatMap(provider => {
        const binding = project.integrations?.[provider];
        return binding && typeof binding.connectionId === 'string' && binding.connectionId.length > 0 && binding.connectionId.length <= 200
            ? [{ provider, connectionId: binding.connectionId }] : [];
    });
}

export function hasIntegrationBindings(project: DbProject) {
    return integrationTargets(project).length > 0;
}

function isPrivate(comment: DbComment) {
    return Boolean(comment.private || isPrivateAppFeedback(comment));
}

function version(comment: DbComment | null | undefined) {
    const current = comment?.syncVersion;
    return typeof current === 'number' && Number.isSafeInteger(current) && current >= 0 ? current : 0;
}

/**
 * Mark every eligible project mutation in its own etag write. Binding snapshots can be stale:
 * gating here would lose a mutation that races connection setup in the other container.
 */
export function withSyncMark(project: DbProject, before: DbComment | null | undefined, after: DbComment): DbComment {
    if (after === before || project.id === PUBLIC_PROJECT_ID || after.domain !== `project:${project.id}`
        || (after.projectId !== undefined && after.projectId !== project.id)
        || ((!before || isPrivate(before)) && isPrivate(after))) return after;
    return { ...after, projectId: project.id, syncKey: syncPendingKey(after.domain, after.id), syncVersion: Math.max(version(before), version(after)) + 1, syncPending: true };
}

/** Only identifiers and a version survive deletion; never copy feedback, image or author data. */
export function syncTombstone(project: Pick<DbProject, 'id' | 'integrations'>, comment: DbComment): DbSyncTombstone {
    if (project.id === PUBLIC_PROJECT_ID || comment.domain !== `project:${project.id}`
        || (comment.projectId !== undefined && comment.projectId !== project.id))
        throw new Error('Deletion intent requires a matching project.');
    return {
        id: syncTombstoneId(comment.id), syncKey: syncPendingKey(comment.domain, syncTombstoneId(comment.id)), domain: comment.domain, type: 'tombstone',
        projectId: project.id, commentId: comment.id, syncVersion: version(comment) + 1,
        targets: integrationTargets(project), deletedAt: new Date().toISOString(), syncPending: true,
        ttl: syncTombstoneTtlSeconds
    };
}
