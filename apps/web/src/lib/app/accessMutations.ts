import { assertWorkspaceWritable } from './accountDeletionGuard';
import { nanoid } from 'nanoid';
import { UserFacingError } from './actionErrors';
import { ACCESS_EVENT_TTL_SECONDS } from './limits';
import {
    memberId,
    userPk,
    workspacePk,
    type DbUser,
    type DbMember,
    type DbWorkspace,
    type DbAccessEvent,
    type DbAccessGeneration
} from './model';
import { getAppStore, type AppMutation, type AppStore, type StoredDoc } from './store';
import { sha256Hex } from './tokens';
import { assertMutableWorkspace } from '../comments/publicProjectPolicy';

export type AccessChange = {
    operations: AppMutation[];
    action: string;
    targetIds: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
};

export function accessEvent(workspaceId: string, actorId: string, change: AccessChange): DbAccessEvent {
    return {
        type: 'access-event', id: `access_${Date.now()}_${nanoid()}`, pk: workspacePk(workspaceId), workspaceId,
        actorId, at: new Date().toISOString(), action: change.action, targetIds: change.targetIds,
        before: change.before, after: change.after, ttl: ACCESS_EVENT_TTL_SECONDS
    };
}

export async function memberRemovalChange(member: StoredDoc<DbMember>, store: AppStore): Promise<AccessChange> {
    const { doc, etag } = member;
    return {
        operations: [
            { kind: 'delete', pk: doc.pk, id: doc.id, etag },
            await bumpAccessGeneration(doc.workspaceId, doc.email, store)
        ],
        action: 'member.removed', targetIds: [doc.id],
        before: { role: doc.role, projects: doc.projects, teamIds: doc.teamIds ?? [] }, after: {}
    };
}

/** The actor of access changes a scheduled job makes when no person is behind them any more */
export const SYSTEM_ACTOR = 'system';

/**
 * All permission mutations serialize through this workspace ETag, including accept/offboard. The actor
 * must be an existing account (and an admin, unless `admin: false`); only a scheduled cleanup that
 * removes access may act as `SYSTEM_ACTOR`, never with `admin`.
 */
export async function mutateAccess(
    workspaceId: string,
    actorId: string,
    prepare: (store: AppStore) => Promise<AccessChange | null>,
    {
        admin = true,
        store = getAppStore(),
        expectedRevision
    }: { admin?: boolean; store?: AppStore; expectedRevision?: number } = {}
) {
    assertMutableWorkspace(workspaceId);
    const system = actorId === SYSTEM_ACTOR;
    if (system && admin)
        throw new Error('The system actor cannot act as an admin');
    const pk = workspacePk(workspaceId);
    for (let attempt = 0; attempt < 8; attempt++) {
        const workspace = await store.get<DbWorkspace>(pk, workspaceId);
        const actor = system ? undefined : (await store.get<DbMember>(pk, memberId(actorId)))?.doc;
        const user = system ? undefined : (await store.get<DbUser>(userPk(actorId), actorId))?.doc;
        if (
            !workspace ||
            (!system && !user) ||
            (admin && (actor?.type !== 'member' || actor.workspaceId !== workspaceId || actor.role !== 'admin'))
        )
            throw new UserFacingError('This workspace is unavailable or your access changed.');
        await assertWorkspaceWritable(workspace.doc, store);
        if (expectedRevision !== undefined && (workspace.doc.accessRevision ?? 0) !== expectedRevision)
            throw new UserFacingError('Access changed since this preview. Refresh and review the changes again.');
        const change = await prepare(store);
        if (!change) return workspace.doc.accessRevision ?? 0;
        if (
            await store.transact([
                {
                    kind: 'replace',
                    doc: { ...workspace.doc, accessRevision: (workspace.doc.accessRevision ?? 0) + 1 },
                    etag: workspace.etag
                },
                ...change.operations,
                { kind: 'create', doc: accessEvent(workspaceId, actorId, change) }
            ])
        )
            return (workspace.doc.accessRevision ?? 0) + 1;
    }
    throw new UserFacingError('Access changed while saving. Refresh and try again.');
}

export const generationId = (email: string) => `access_generation_${sha256Hex(email)}`;
export async function accessGeneration(workspaceId: string, email: string, store = getAppStore()) {
    return (await store.get<DbAccessGeneration>(workspacePk(workspaceId), generationId(email)))?.doc.generation ?? 0;
}
export async function bumpAccessGeneration(workspaceId: string, email: string, store: AppStore): Promise<
    { kind: 'create'; doc: DbAccessGeneration } | { kind: 'replace'; doc: DbAccessGeneration; etag: string }
> {
    const pk = workspacePk(workspaceId),
        id = generationId(email);
    const old = await store.get<DbAccessGeneration>(pk, id);
    const doc: DbAccessGeneration = { type: 'access-generation', pk, id, generation: (old?.doc.generation ?? 0) + 1 };
    return old ? { kind: 'replace', doc, etag: old.etag } : { kind: 'create', doc };
}
