import { randomUUID } from 'node:crypto';
import { memberId, workspacePk, type DbMember, type DbProject } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { getIntegrationConnection, IntegrationAccessError } from './connection';
import { enqueueIntegrationSync, integrationProject } from './discovery';
import type { IntegrationConnection, IntegrationProviderId } from './model';

/** Persist a selected bounded source set; the worker, not this request, queues its projection. */
export async function startIntegrationBackfill(project: DbProject, provider: IntegrationProviderId, userId: string) {
    const store = getAppStore();
    const current = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    const member = (await store.get<DbMember>(workspacePk(project.workspaceId), memberId(userId)))?.doc;
    if (!current || current.type !== 'project' || current.workspaceId !== project.workspaceId || member?.role !== 'admin'
        || member.userId !== userId || current.id === PUBLIC_PROJECT_ID) throw new IntegrationAccessError();
    const connection = await getIntegrationConnection(current, provider, store);
    if (!connection || !connection.enabled || connection.status !== 'connected') throw new Error('Turn on the integration before requesting a backfill');
    const cap = provider === 'slack' ? 100 : 1000;
    const sources = (await getCommentsStore().listAll(`project:${current.id}`, cap))
        .filter(source => !source.private && !isPrivateAppFeedback(source));
    const request = { id: `backfill_${randomUUID()}`, threadIds: sources.map(source => source.id), queued: 0,
        requestedAt: new Date().toISOString(), done: sources.length === 0, destinationRevision: connection.destinationRevision };
    const saved = await updateDoc<IntegrationConnection>(connection.pk, connection.id, row => {
        if (row.destinationRevision !== connection.destinationRevision || row.connectedBy !== connection.connectedBy || !row.enabled || row.status !== 'connected')
            throw new Error('Integration connection changed');
        if (row.backfillPending && row.backfill && !row.backfill.done) return row;
        return { ...row, backfill: request, backfillPending: !request.done };
    }, store);
    if (!saved?.backfill) throw new Error('Integration connection was removed');
    return { queued: saved.backfill.queued, total: saved.backfill.threadIds.length, done: saved.backfill.done };
}

/** Connection-specific work: never changes the shared pending flag or another provider's queue. */
export async function queueIntegrationBackfills(provider: IntegrationProviderId, options: {
    deadline: number; maxQueued?: number; store?: AppStore; comments?: CommentsStore; now?: () => number;
}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const now = options.now ?? Date.now;
    const maxQueued = Math.max(1, Math.min(100, options.maxQueued ?? (provider === 'slack' ? 20 : 100)));
    let queued = 0;
    let deferred = 0;
    const connections = await store.query<IntegrationConnection>({ type: `${provider}-connection`,
        where: { backfillPending: true, enabled: true, status: 'connected' }, limit: 100, orderBy: 'id' });
    for (const connection of connections) {
        if (queued >= maxQueued || now() >= options.deadline) { deferred++; continue; }
        const project = await integrationProject(connection.projectId, store);
        const member = project ? (await store.get<DbMember>(project.pk, memberId(connection.connectedBy)))?.doc : null;
        if (!project || project.workspaceId !== connection.workspaceId || project.integrations?.[provider]?.connectionId !== connection.id
            || member?.role !== 'admin' || member.userId !== connection.connectedBy || connection.status !== 'connected' || !connection.backfill) {
            await updateDoc<IntegrationConnection>(connection.pk, connection.id, row => row.backfill?.id !== connection.backfill?.id ? row
                : ({ ...row, ...(row.backfill ? { backfill: { ...row.backfill, done: true, canceled: true } } : {}), backfillPending: false }), store);
            continue;
        }
        const request = connection.backfill;
        if (request.destinationRevision !== undefined && request.destinationRevision !== connection.destinationRevision) {
            await updateDoc<IntegrationConnection>(connection.pk, connection.id, row => row.backfill?.id !== request.id ? row
                : ({ ...row, backfill: { ...row.backfill, done: true, canceled: true }, backfillPending: false }), store);
            continue;
        }
        for (let index = request.queued; index < request.threadIds.length && queued < maxQueued && now() < options.deadline; index++) {
            const current = (await store.get<IntegrationConnection>(connection.pk, connection.id))?.doc;
            if (!current || !current.enabled || current.destinationRevision !== connection.destinationRevision || current.backfill?.id !== request.id) break;
            const source = (await comments.get(`project:${project.id}`, request.threadIds[index]!))?.comment;
            if (source && !source.private && !isPrivateAppFeedback(source)) await enqueueIntegrationSync(project, provider,
                connection.id, source.id, source.syncVersion ?? 0, { store, requestId: request.id, destinationRevision: connection.destinationRevision });
            const saved = await updateDoc<IntegrationConnection>(connection.pk, connection.id, row => {
                if (row.backfill?.id !== request.id || row.destinationRevision !== connection.destinationRevision) return row;
                const count = Math.max(row.backfill.queued, index + 1);
                return { ...row, backfill: { ...row.backfill, queued: count, done: count >= request.threadIds.length },
                    backfillPending: count < request.threadIds.length };
            }, store);
            if (!saved) break;
            queued++;
        }
    }
    return { queued, deferred };
}
