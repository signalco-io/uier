import { UserFacingError } from './actionErrors';
import { mutateAccess, SYSTEM_ACTOR, type AccessChange } from './accessMutations';
import type { AppContext } from './context';
import { clientNamed, getClient, projectClientNameSchema } from './clients';
import { hasProjectAccess, loadWorkspaceAccess } from './access';
import {
    memberId,
    projectRefPk,
    userPk,
    workspacePk,
    type AppDoc,
    type DbClient,
    type DbInvitation,
    type DbMember,
    type DbProject,
    type DbProjectRef,
    type DbUser,
    type DbWorkspace
} from './model';
import { isProjectId } from './projects';
import { ensureProjectPublicId, pointProjectPublicIds } from './projectPublicIds';
import {
    deleteInvitationTokens,
    deleteProjectIntegrationRecords,
    deleteProjectMcpEvents,
    deleteProjectWorkspaceRecords,
    disconnectProjectIntegrations,
    projectGrantRemovals
} from './projectRecords';
import { getAppStore, updateDoc, type AppMutation, type AppStore, type StoredDoc } from './store';
import { assertMutableProject, assertMutableWorkspace, PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { integrationLabels, integrationProviders } from '../integrations/model';
import { removeProjectFromMcpAccess } from '../mcp/credentials';

/*
 * Moving a project to another workspace. Its comments, screenshots, read state, notification
 * settings and sequence live in partitions keyed by the project and stay where they are. The
 * project document is in its workspace's partition, so it is copied to the new workspace, the
 * project code and public ids are pointed at the copy, and the old document is deleted together
 * with the access it gave. Workspace-bound settings stay behind: connected services are
 * disconnected, coding tools lose the project, and grants, teams and invitations do not follow.
 *
 * While it runs, both documents carry `transfer`, and only the one whose workspace the project code
 * names is the project (`isLiveProject`): the new workspace sees nothing before the switch, the old
 * one nothing after it, however a run is interrupted.
 */

/**
 * Identifier-only intent, saved before anything moves. It keeps two transfers of one project apart
 * and lets a retry, or the scheduled sweep, finish or abandon an interrupted one. A completed one
 * stays for a day.
 */
export type ProjectTransfer = AppDoc & {
    type: 'project-transfer';
    pk: typeof transferPk;
    /** The project's internal id */
    id: string;
    fromWorkspaceId: string;
    toWorkspaceId: string;
    requestedBy: string;
    requestedAt: string;
    complete?: boolean;
    completedAt?: string;
    /** Interrupted before the switch and given up (set first, then undone): the project stays where it was */
    abandoned?: boolean;
};

const transferPk = 'project-transfer';
/** A request ends well within this; a pending transfer older than it was interrupted */
const TRANSFER_LEASE_MS = 15 * 60 * 1000;
/** Workspace documents per access transaction, under the 100-operation batch with the project, its client, the workspace and the event */
const ACCESS_BATCH = 80;

const adminOnly = 'Only workspace admins can transfer projects.';
const gone = 'This project no longer exists.';
const busy = 'This project is being transferred to another workspace. Try again in a few minutes.';
const deletionPk = 'project-deletion';

const projectCode = async (id: string, store: AppStore) => {
    const code = (await store.get<DbProjectRef>(projectRefPk(id), id))?.doc;
    return code?.type === 'project-ref' ? code.workspaceId : null;
};
const running = (intent: ProjectTransfer) => Date.now() - Date.parse(intent.requestedAt) < TRANSFER_LEASE_MS;

/** The project's transfer that has not finished, if any */
export async function pendingProjectTransfer(projectId: string, store: AppStore = getAppStore()) {
    const intent = (await store.get<ProjectTransfer>(transferPk, projectId))?.doc;
    return intent?.type === 'project-transfer' && !intent.complete ? intent : null;
}

export type TransferTarget = { id: string; name: string };

/** Workspaces the person administers, other than the project's own and uier's */
export function projectTransferTargets(context: AppContext): TransferTarget[] {
    return context.memberships
        .filter(({ member, workspace }) => member.role === 'admin' && workspace.id !== context.workspace.id && workspace.id !== PUBLIC_WORKSPACE_ID)
        .map(({ workspace }) => ({ id: workspace.id, name: workspace.name }));
}

/** What stays behind in the project's workspace, for the confirmation */
export type TransferPreview = {
    /** Connected services, by name: the transfer disconnects them */
    integrations: string[];
    /** Other people who can open the project here now (admins, all projects, their own or a team's access) */
    people: number;
    /** Teams with the project */
    teams: number;
    /** Pending invitations that include the project */
    invitations: number;
    /** The project's client: the new workspace's client with this name, or a new one there */
    client?: string;
};

export async function projectTransferPreview(project: DbProject, requesterId: string, store: AppStore = getAppStore()): Promise<TransferPreview> {
    const pk = workspacePk(project.workspaceId);
    const [access, members, invitations, connected, client] = await Promise.all([
        loadWorkspaceAccess(project.workspaceId, store),
        store.query<DbMember>({ type: 'member', pk }),
        store.query<DbInvitation>({ type: 'invitation', pk }),
        Promise.all(integrationProviders.map(async provider => Boolean(project.integrations?.[provider])
            || (await store.query({ type: `${provider}-connection`, pk, where: { projectId: project.id, enabled: true }, limit: 1 })).length > 0)),
        project.clientId ? getClient(project.workspaceId, project.clientId, store) : null
    ]);
    const teamIds = new Set(access.teams.filter(team => team.projectIds.includes(project.id)).map(team => team.id));
    return {
        integrations: integrationProviders.filter((_, index) => connected[index]).map(provider => integrationLabels[provider]),
        people: members.filter(member => member.userId !== requesterId && hasProjectAccess(access, member, project)).length,
        teams: teamIds.size,
        invitations: invitations.filter(invitation => invitation.projects !== 'all' && (invitation.projects.includes(project.id)
            || invitation.projectId === project.id || Boolean(invitation.teamIds?.some(id => teamIds.has(id))))).length,
        ...(client ? { client: client.doc.name } : {})
    };
}

/**
 * Moves a project of the current workspace to another workspace. The person must be an admin of
 * both, now (the stored memberships, not the context), and confirm with the project's name. The
 * public project and workspace never move. Safe to repeat: a retry continues an interrupted move,
 * as the person retrying.
 */
export async function transferProject(context: AppContext, projectId: string, toWorkspaceId: string, confirmation: string, store: AppStore = getAppStore()) {
    const from = context.workspace.id;
    assertMutableProject(from, projectId);
    assertMutableWorkspace(toWorkspaceId);
    if (!context.isAdmin)
        throw new UserFacingError(adminOnly);
    if (toWorkspaceId === from)
        throw new UserFacingError('Choose another workspace.');
    const project = isProjectId(projectId) ? (await store.get<DbProject>(workspacePk(from), projectId))?.doc : null;
    if (!project || project.type !== 'project' || project.workspaceId !== from)
        throw new UserFacingError(gone);
    const [member, targetMember, target] = await Promise.all([
        store.get<DbMember>(workspacePk(from), memberId(context.user.id)),
        store.get<DbMember>(workspacePk(toWorkspaceId), memberId(context.user.id)),
        store.get<DbWorkspace>(workspacePk(toWorkspaceId), toWorkspaceId)
    ]);
    if (member?.doc.type !== 'member' || member.doc.role !== 'admin')
        throw new UserFacingError(adminOnly);
    if (target?.doc.type !== 'workspace' || targetMember?.doc.type !== 'member' || targetMember.doc.role !== 'admin')
        throw new UserFacingError('Choose a workspace where you are an admin.');
    if (confirmation.trim() !== project.name)
        throw new UserFacingError('Type the project name exactly as it is shown.');
    // A copy a transfer left behind is not the project: its code names where it lives
    if (await projectCode(projectId, store) !== from)
        throw new UserFacingError(gone);
    if (await store.get(deletionPk, projectId))
        throw new UserFacingError('This project is being deleted.');

    // Review links and embeds keep the project's public id: assign it first, as the first read would
    await ensureProjectPublicId(project, store);
    const intent = await claimProjectTransfer(project, toWorkspaceId, context.user.id, store);
    await runProjectTransfer(intent, context.user.id, store);
}

async function claimProjectTransfer(project: DbProject, toWorkspaceId: string, requestedBy: string, store: AppStore) {
    const intent: ProjectTransfer = {
        type: 'project-transfer', pk: transferPk, id: project.id, fromWorkspaceId: project.workspaceId, toWorkspaceId,
        requestedBy, requestedAt: new Date().toISOString(), ttl: -1
    };
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await store.create(intent))
            return intent;
        const saved = await store.get<ProjectTransfer>(transferPk, project.id);
        if (!saved)
            continue;
        const earlier = saved.doc;
        if (!earlier.complete) {
            // A retry continues the earlier request as a running one, so the sweep leaves it alone
            if (earlier.fromWorkspaceId === intent.fromWorkspaceId && earlier.toWorkspaceId === toWorkspaceId && !earlier.abandoned) {
                const retried: ProjectTransfer = { ...earlier, requestedAt: intent.requestedAt };
                if (await store.replace(retried, saved.etag) === 'ok')
                    return retried;
                continue;
            }
            if (!await settleProjectTransfer(earlier, requestedBy, store))
                throw new UserFacingError(busy);
            continue;
        }
        if (await store.replace(intent, saved.etag) === 'ok')
            return intent;
    }
    throw new Error('Project transfer changed too often');
}

/**
 * Every step is idempotent, so an interrupted run can be repeated. Until the project code names the
 * new workspace, the old document is the project. Everything that can refuse (the new workspace's
 * access guard, its client) runs before anything is disconnected or removed.
 */
export async function runProjectTransfer(intent: ProjectTransfer, actorId: string, store: AppStore = getAppStore()) {
    const { id, fromWorkspaceId: from, toWorkspaceId: to } = intent;
    assertMutableProject(from, id);
    assertMutableWorkspace(to);
    const code = await projectCode(id, store);
    if (code === from) {
        // From here both documents carry the transfer, so only the one the code names is the project
        if (!await markProject(from, intent, store))
            throw new UserFacingError(gone);
        await copyProject(intent, actorId, store);
        // Workspace-bound settings stay behind, while the admin and the project are still here:
        // connected services are disconnected and their records go; copies already sent stay with
        // the provider. Coding tools of either workspace lose the project, and its webhooks end.
        const project = (await store.get<DbProject>(workspacePk(from), id))?.doc;
        if (!project)
            throw new UserFacingError(gone);
        await disconnectProjectIntegrations(project, actorId, store);
        await deleteProjectIntegrationRecords(id, from, store);
        await deleteProjectWorkspaceRecords(id, from, store);
        await deleteProjectMcpEvents(id, store);
        await removeProjectFromMcpAccess(from, id, store);
        await removeProjectFromMcpAccess(to, id, store);
        // Settings saved meanwhile
        await refreshCopy(intent, store);
        // Never point links at the new workspace once the transfer was given up meanwhile
        await assertStillTransferring(intent, store);
        // Public ids first; a lookup that finds them ahead of the code follows the code
        await pointProjectPublicIds(id, to, store);
        await switchProjectCode(intent, store);
    } else if (code !== to) {
        throw new UserFacingError(gone);
    }
    await finishTransfer(intent, actorId, store);
}

/**
 * Finishes or abandons a transfer that is not running any more; `false` while it may still be running.
 * After the switch it finishes (the old copy goes); before it, once the request is long over, it is
 * abandoned: review links point back, the copy in the new workspace goes and the project stays.
 */
export async function settleProjectTransfer(intent: ProjectTransfer, actorId: string, store: AppStore = getAppStore()) {
    const code = await projectCode(intent.id, store);
    if (code === intent.toWorkspaceId) {
        await finishTransfer(intent, actorId, store);
        return true;
    }
    if (code === intent.fromWorkspaceId) {
        if (!await claimAbandonment(intent, store))
            return false;
        await pointProjectPublicIds(intent.id, intent.fromWorkspaceId, store);
        await removeProjectCopy(intent.toWorkspaceId, intent.id, actorId, 'project.transfer-abandoned', store);
        await unmarkProject(intent.fromWorkspaceId, intent, store);
    } else {
        // The project was deleted meanwhile: no copy of it stays anywhere
        for (const workspaceId of [intent.fromWorkspaceId, intent.toWorkspaceId])
            await removeProjectCopy(workspaceId, intent.id, actorId, 'project.transfer-abandoned', store);
    }
    await completeTransfer(intent, store, true);
    return true;
}

/**
 * Scheduled with project deletions: every transfer an interrupted request left, as its requester, or as
 * uier itself (`SYSTEM_ACTOR`) once the requester's account is gone. One failure never stops the rest.
 */
export async function sweepProjectTransfers(store: AppStore = getAppStore()) {
    let failed = 0;
    for (const intent of await store.query<ProjectTransfer>({ type: 'project-transfer', pk: transferPk })) {
        if (intent.complete) continue;
        try {
            const requester = (await store.get<DbUser>(userPk(intent.requestedBy), intent.requestedBy))?.doc;
            if (requester?.type !== 'user')
                console.info('[projects] Settling a project transfer whose requester left, as uier');
            await settleProjectTransfer(intent, requester?.type === 'user' ? intent.requestedBy : SYSTEM_ACTOR, store);
        }
        catch { failed++; console.error('[projects] Scheduled project transfer needs retry'); }
    }
    return { failed };
}

/**
 * Takes over a transfer that never switched over and is no longer running, before anything is undone:
 * a retry that starts after this settles it first, and one still running stops before the switch.
 * `false` while it may still be running.
 */
async function claimAbandonment(intent: ProjectTransfer, store: AppStore) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get<ProjectTransfer>(transferPk, intent.id);
        if (!stored || stored.doc.complete || stored.doc.abandoned)
            return true;
        if (stored.doc.fromWorkspaceId !== intent.fromWorkspaceId || stored.doc.toWorkspaceId !== intent.toWorkspaceId || running(stored.doc))
            return false;
        if (await store.replace({ ...stored.doc, abandoned: true }, stored.etag) === 'ok')
            return true;
    }
    return false;
}

/** The transfer is still this one, still pending, and its copy is in the new workspace */
async function assertStillTransferring({ id, fromWorkspaceId: from, toWorkspaceId: to }: ProjectTransfer, store: AppStore) {
    const current = (await store.get<ProjectTransfer>(transferPk, id))?.doc;
    const copy = (await store.get<DbProject>(workspacePk(to), id))?.doc;
    if (!current || current.complete || current.abandoned || current.fromWorkspaceId !== from || current.toWorkspaceId !== to
        || copy?.transfer?.from !== from || copy.transfer.to !== to)
        throw new UserFacingError('The transfer was stopped before it finished. Try again.');
}

/** The old copy and its access go, then the new one is a plain project again */
async function finishTransfer(intent: ProjectTransfer, actorId: string, store: AppStore) {
    await removeProjectCopy(intent.fromWorkspaceId, intent.id, actorId, 'project.transferred-out', store);
    await unmarkProject(intent.toWorkspaceId, intent, store);
    await completeTransfer(intent, store);
}

async function completeTransfer(intent: ProjectTransfer, store: AppStore, abandoned = false) {
    const current = await store.get<ProjectTransfer>(transferPk, intent.id);
    if (current && !current.doc.complete && current.doc.fromWorkspaceId === intent.fromWorkspaceId && current.doc.toWorkspaceId === intent.toWorkspaceId)
        await store.replace({ ...current.doc, complete: true, completedAt: new Date().toISOString(), ttl: 24 * 60 * 60,
            ...(abandoned ? { abandoned } : {}) }, current.etag);
}

/** Changes the project's document in a workspace unless it already is as wanted; `false` when it is gone */
async function changeProject(workspaceId: string, id: string, change: (project: DbProject) => DbProject | null, store: AppStore) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get<DbProject>(workspacePk(workspaceId), id);
        if (stored?.doc.type !== 'project')
            return false;
        const next = change(stored.doc);
        if (!next || await store.replace(next, stored.etag) === 'ok')
            return true;
    }
    throw new Error('The project changed too often during a transfer');
}

const markProject = (workspaceId: string, { id, fromWorkspaceId: from, toWorkspaceId: to }: ProjectTransfer, store: AppStore) =>
    changeProject(workspaceId, id, project => project.transfer?.from === from && project.transfer.to === to ? null : { ...project, transfer: { from, to } }, store);

/** Only this transfer's mark: a later transfer's stays */
const unmarkProject = (workspaceId: string, { id, fromWorkspaceId: from, toWorkspaceId: to }: ProjectTransfer, store: AppStore) =>
    changeProject(workspaceId, id, ({ transfer, ...project }) => transfer?.from === from && transfer.to === to ? project : null, store);

/** The project as it is in the new workspace while the transfer runs: no services, its client the one with the same name there */
function projectCopy(source: DbProject, { fromWorkspaceId: from, toWorkspaceId: to }: ProjectTransfer, clientId: string | undefined): DbProject {
    const { integrations: _integrations, clientId: _clientId, clientName: _clientName, transfer: _transfer, ...rest } = source;
    return { ...rest, pk: workspacePk(to), workspaceId: to, ...(clientId ? { clientId } : {}), transfer: { from, to }, updatedAt: new Date().toISOString() };
}

/** The new workspace's client with the project's client's name, created there with its details when it has none */
async function targetClient(source: DbProject, to: string, actorId: string, store: AppStore): Promise<StoredDoc<DbClient> | null> {
    const client = source.clientId ? (await getClient(source.workspaceId, source.clientId, store))?.doc : undefined;
    const name = client?.name ?? projectClientNameSchema.safeParse(source.clientName ?? '').data;
    if (!name)
        return null;
    return await clientNamed(store, to, name, actorId, { description: client?.description, icon: client?.icon, color: client?.color });
}

/**
 * Writes the copy in the new workspace through its access guard (the person must still be an admin
 * there), with any grants an earlier stay of the project left: it arrives with no grants of its own.
 */
async function copyProject(intent: ProjectTransfer, actorId: string, store: AppStore) {
    const { id, fromWorkspaceId: from, toWorkspaceId: to } = intent;
    for (let batch = 0; batch < 100; batch++) {
        let more = false;
        let tokens: string[] = [];
        await mutateAccess(to, actorId, async current => {
            const source = (await current.get<DbProject>(workspacePk(from), id))?.doc;
            if (!source || source.type !== 'project' || source.workspaceId !== from)
                throw new UserFacingError(gone);
            const removals = await projectGrantRemovals(current, to, id, ACCESS_BATCH);
            ({ more, tokens } = removals);
            const operations: AppMutation[] = [...removals.operations];
            if (!more) {
                const client = await targetClient(source, to, actorId, current);
                const copy = projectCopy(source, intent, client?.doc.id);
                const existing = await current.get<DbProject>(workspacePk(to), id);
                operations.push(existing ? { kind: 'replace', doc: copy, etag: existing.etag } : { kind: 'create', doc: copy });
                // Rewriting the client fails the transaction if it was deleted since it was read
                if (client)
                    operations.push({ kind: 'replace', doc: client.doc, etag: client.etag });
            }
            return {
                operations, action: 'project.transferred-in', targetIds: [id, ...Object.keys(removals.before)],
                before: removals.before, after: { ...removals.after, projectName: source.name }
            } satisfies AccessChange;
        }, { store });
        await deleteInvitationTokens(tokens, store);
        if (!more)
            return;
    }
    throw new Error('Too many access grants to remove');
}

/** Settings saved in the old workspace while services were disconnected; the copy keeps its client */
async function refreshCopy(intent: ProjectTransfer, store: AppStore) {
    const source = (await store.get<DbProject>(workspacePk(intent.fromWorkspaceId), intent.id))?.doc;
    if (!source)
        throw new UserFacingError(gone);
    const comparable = ({ updatedAt: _updatedAt, ...project }: DbProject) => JSON.stringify(project);
    await changeProject(intent.toWorkspaceId, intent.id, copy => {
        const next = projectCopy(source, intent, copy.clientId);
        return comparable(next) === comparable(copy) ? null : next;
    }, store);
}

async function switchProjectCode({ id, fromWorkspaceId: from, toWorkspaceId: to }: ProjectTransfer, store: AppStore) {
    // Never to a workspace without this transfer's copy (a request that outlived its abandonment)
    const copy = (await store.get<DbProject>(workspacePk(to), id))?.doc;
    if (copy?.transfer?.from !== from || copy.transfer.to !== to)
        throw new Error('The project copy changed during a transfer');
    for (let attempt = 0; attempt < 8; attempt++) {
        const ref = await store.get<DbProjectRef>(projectRefPk(id), id);
        if (ref?.doc.type !== 'project-ref' || (ref.doc.workspaceId !== from && ref.doc.workspaceId !== to))
            throw new Error('The project code changed during a transfer');
        if (ref.doc.workspaceId === to || await store.replace({ ...ref.doc, workspaceId: to }, ref.etag) === 'ok')
            return;
    }
    throw new Error('The project code changed too often during a transfer');
}

/**
 * The project's document and the access it gave in a workspace it does not live in (its code names
 * another one, or the project was deleted), one access transaction per batch; the document goes with
 * the last batch. Members are only updated, never deleted or recreated.
 */
async function removeProjectCopy(workspaceId: string, id: string, actorId: string, action: 'project.transferred-out' | 'project.transfer-abandoned', store: AppStore) {
    for (let batch = 0; batch < 100; batch++) {
        let more = false;
        let tokens: string[] = [];
        await mutateAccess(workspaceId, actorId, async current => {
            if (await projectCode(id, current) === workspaceId)
                throw new Error('Only a copy of a project that lives elsewhere can be removed');
            const removals = await projectGrantRemovals(current, workspaceId, id, ACCESS_BATCH);
            ({ more, tokens } = removals);
            const copy = more ? null : await current.get<DbProject>(workspacePk(workspaceId), id);
            const operations: AppMutation[] = [...removals.operations];
            if (copy)
                operations.push({ kind: 'delete', pk: copy.doc.pk, id, etag: copy.etag });
            if (!operations.length)
                return null;
            return {
                operations, action, targetIds: [id, ...Object.keys(removals.before)],
                before: removals.before, after: { ...removals.after, ...(copy ? { projectName: copy.doc.name } : {}) }
            } satisfies AccessChange;
        }, { admin: false, store });
        await deleteInvitationTokens(tokens, store);
        if (!more)
            return;
    }
    throw new Error('Too many access grants to remove');
}
