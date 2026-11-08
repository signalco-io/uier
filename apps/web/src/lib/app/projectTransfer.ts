import { UserFacingError } from './actionErrors';
import { mutateAccess, type AccessChange } from './accessMutations';
import type { AppContext } from './context';
import { clientNamed, getClient, projectClientNameSchema } from './clients';
import {
    memberId,
    projectRefPk,
    workspacePk,
    type AppDoc,
    type DbClient,
    type DbInvitation,
    type DbMember,
    type DbProject,
    type DbProjectRef,
    type DbTeam,
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
import { getAppStore, type AppMutation, type AppStore, type StoredDoc } from './store';
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
 */

/**
 * Identifier-only intent, saved before anything moves. It keeps two transfers of one project apart
 * and lets a retry continue where the last one stopped. A completed one stays for a day.
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
};

const transferPk = 'project-transfer';
/** A request ends well within this; a pending transfer older than it was interrupted */
const TRANSFER_LEASE_MS = 15 * 60 * 1000;
/** Workspace documents per access transaction, under the 100-operation batch with the project, its client, the workspace and the event */
const ACCESS_BATCH = 80;

const adminOnly = 'Only workspace admins can transfer projects.';
const gone = 'This project no longer exists.';

/** A transfer of the project that may still be running; project deletion waits for it. */
export async function activeProjectTransfer(projectId: string, store: AppStore = getAppStore()) {
    const intent = (await store.get<ProjectTransfer>(transferPk, projectId))?.doc;
    return intent?.type === 'project-transfer' && !intent.complete && Date.now() - Date.parse(intent.requestedAt) < TRANSFER_LEASE_MS
        ? intent : null;
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
    /** People who are not admins and see the project through their own or a team's access to it */
    people: number;
    /** Teams with the project */
    teams: number;
    /** Pending invitations that include the project */
    invitations: number;
    /** The project's client: the new workspace's client with this name, or a new one there */
    client?: string;
};

export async function projectTransferPreview(project: DbProject, store: AppStore = getAppStore()): Promise<TransferPreview> {
    const pk = workspacePk(project.workspaceId);
    const [teams, members, invitations, connected, client] = await Promise.all([
        store.query<DbTeam>({ type: 'team', pk, where: { state: 'active' } }),
        store.query<DbMember>({ type: 'member', pk }),
        store.query<DbInvitation>({ type: 'invitation', pk }),
        Promise.all(integrationProviders.map(async provider => Boolean(project.integrations?.[provider])
            || (await store.query({ type: `${provider}-connection`, pk, where: { projectId: project.id, enabled: true }, limit: 1 })).length > 0)),
        project.clientId ? getClient(project.workspaceId, project.clientId, store) : null
    ]);
    const teamIds = new Set(teams.filter(team => team.projectIds.includes(project.id)).map(team => team.id));
    const granted = (access: DbMember | DbInvitation) => access.role !== 'admin' && access.projects !== 'all'
        && (access.projects.includes(project.id) || Boolean(access.teamIds?.some(id => teamIds.has(id))));
    return {
        integrations: integrationProviders.filter((_, index) => connected[index]).map(provider => integrationLabels[provider]),
        people: members.filter(granted).length,
        teams: teamIds.size,
        invitations: invitations.filter(granted).length,
        ...(client ? { client: client.doc.name } : {})
    };
}

/**
 * Moves a project of the current workspace to another workspace. The person must be an admin of
 * both, now (the stored memberships, not the context), and confirm with the project's name. The
 * public project and workspace never move. Safe to repeat: a retry continues an interrupted move.
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
    // A copy an interrupted transfer left behind is not the project: its code names where it lives
    const ref = (await store.get<DbProjectRef>(projectRefPk(projectId), projectId))?.doc;
    if (ref?.type !== 'project-ref' || (ref.workspaceId !== from && ref.workspaceId !== toWorkspaceId))
        throw new UserFacingError(gone);
    if (await store.get(deletionPk, projectId))
        throw new UserFacingError('This project is being deleted.');

    // Review links and embeds keep the project's public id: assign it first, as the first read would
    await ensureProjectPublicId(project, store);
    const intent = await claimProjectTransfer(project, toWorkspaceId, context.user.id, ref, store);
    await runProjectTransfer(intent, store);
}

const deletionPk = 'project-deletion';

async function claimProjectTransfer(project: DbProject, toWorkspaceId: string, requestedBy: string, ref: DbProjectRef, store: AppStore) {
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
            // A retry continues the earlier request
            if (earlier.fromWorkspaceId === intent.fromWorkspaceId && earlier.toWorkspaceId === toWorkspaceId)
                return earlier;
            if (ref.workspaceId === earlier.toWorkspaceId) {
                // It moved: only its old copy is left to remove
                await pointProjectPublicIds(project.id, ref.workspaceId, store);
                await removeProjectCopy(earlier.fromWorkspaceId, project.id, requestedBy, store);
            } else {
                if (Date.now() - Date.parse(earlier.requestedAt) < TRANSFER_LEASE_MS)
                    throw new UserFacingError('This project is being transferred to another workspace. Try again in a few minutes.');
                // Interrupted before it moved: review links come back, and the copy it made there goes
                await pointProjectPublicIds(project.id, ref.workspaceId, store);
                await removeProjectCopy(earlier.toWorkspaceId, project.id, requestedBy, store);
            }
        }
        if (await store.replace(intent, saved.etag) === 'ok')
            return intent;
    }
    throw new Error('Project transfer changed too often');
}

/**
 * Every step is idempotent, so an interrupted run can be repeated. Until the project code names the
 * new workspace, the old document is the project and every run copies it again.
 */
export async function runProjectTransfer(intent: ProjectTransfer, store: AppStore = getAppStore()) {
    const { id, fromWorkspaceId: from, toWorkspaceId: to, requestedBy } = intent;
    assertMutableProject(from, id);
    assertMutableWorkspace(to);
    const ref = (await store.get<DbProjectRef>(projectRefPk(id), id))?.doc;
    if (ref?.type === 'project-ref' && ref.workspaceId === from) {
        const project = (await store.get<DbProject>(workspacePk(from), id))?.doc;
        if (!project || project.type !== 'project')
            throw new UserFacingError(gone);
        // Workspace-bound settings stay behind, while the admin and the project are still here:
        // connected services are disconnected and their records go; copies already sent stay with
        // the provider. Coding tools of this workspace lose the project, and its webhooks end.
        await disconnectProjectIntegrations(project, requestedBy, store);
        await deleteProjectIntegrationRecords(id, from, store);
        await deleteProjectWorkspaceRecords(id, from, store);
        await deleteProjectMcpEvents(id, store);
        await removeProjectFromMcpAccess(from, id, store);
        // Selections left from an earlier stay in the new workspace do not come back
        await removeProjectFromMcpAccess(to, id, store);
        await copyProject(intent, store);
        // Public ids first: the code is what most reads follow, and both find the copy now
        await pointProjectPublicIds(id, to, store);
        await switchProjectCode(id, from, to, store);
    } else if (ref?.type !== 'project-ref' || ref.workspaceId !== to) {
        throw new UserFacingError(gone);
    }
    await removeProjectCopy(from, id, requestedBy, store);
    const current = await store.get<ProjectTransfer>(transferPk, id);
    if (current && !current.doc.complete && current.doc.fromWorkspaceId === from && current.doc.toWorkspaceId === to)
        await store.replace({ ...current.doc, complete: true, completedAt: new Date().toISOString(), ttl: 24 * 60 * 60 }, current.etag);
}

/** The project as it is in the new workspace: no services, and its client is the one with the same name there */
function projectCopy(source: DbProject, to: string, clientId: string | undefined): DbProject {
    const { integrations: _integrations, clientId: _clientId, clientName: _clientName, ...rest } = source;
    return { ...rest, pk: workspacePk(to), workspaceId: to, ...(clientId ? { clientId } : {}), updatedAt: new Date().toISOString() };
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
async function copyProject({ id, fromWorkspaceId: from, toWorkspaceId: to, requestedBy }: ProjectTransfer, store: AppStore) {
    for (let batch = 0; batch < 100; batch++) {
        let more = false;
        let tokens: string[] = [];
        await mutateAccess(to, requestedBy, async current => {
            const source = (await current.get<DbProject>(workspacePk(from), id))?.doc;
            if (!source || source.type !== 'project' || source.workspaceId !== from)
                throw new UserFacingError(gone);
            const removals = await projectGrantRemovals(current, to, id, ACCESS_BATCH);
            ({ more, tokens } = removals);
            const operations: AppMutation[] = [...removals.operations];
            if (!more) {
                const client = await targetClient(source, to, requestedBy, current);
                const copy = projectCopy(source, to, client?.doc.id);
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

async function switchProjectCode(id: string, from: string, to: string, store: AppStore) {
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
 * another one), one access transaction per batch; the document goes with the last batch. Members
 * are only updated, never deleted or recreated.
 */
async function removeProjectCopy(workspaceId: string, id: string, actorId: string, store: AppStore) {
    for (let batch = 0; batch < 100; batch++) {
        let more = false;
        let tokens: string[] = [];
        await mutateAccess(workspaceId, actorId, async current => {
            const ref = (await current.get<DbProjectRef>(projectRefPk(id), id))?.doc;
            if (ref?.type !== 'project-ref' || ref.workspaceId === workspaceId)
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
                operations, action: 'project.transferred-out', targetIds: [id, ...Object.keys(removals.before)],
                before: removals.before, after: { ...removals.after, ...(copy ? { projectName: copy.doc.name } : {}) }
            } satisfies AccessChange;
        }, { admin: false, store });
        await deleteInvitationTokens(tokens, store);
        if (!more)
            return;
    }
    throw new Error('Too many access grants to remove');
}
