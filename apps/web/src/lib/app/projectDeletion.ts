import { UserFacingError } from './actionErrors';
import { mutateAccess, type AccessChange } from './accessMutations';
import type { AppContext } from './context';
import {
    memberId,
    projectRefPk,
    workspacePk,
    type AppDoc,
    type DbInvitation,
    type DbMember,
    type DbProject,
    type DbRetiredProjectRef,
    type DbTeam
} from './model';
import { isProjectId } from './projects';
import { retireProjectPublicIds } from './projectPublicIds';
import { getAppStore, type AppMutation, type AppStore } from './store';
import { assertMutableProject } from '../comments/publicProjectPolicy';
import { forgetScreenshot } from '../comments/service';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { deleteProjectThread, projectPartition } from '../review/comments';
import { integrationProviders, type IntegrationProviderId } from '../integrations/model';
import { notificationPk } from '../notifications/preferences';
import { removeProjectFromMcpAccess } from '../mcp/credentials';

/**
 * Identifier-only intent, saved before anything is deleted. A pending intent never expires: the
 * scheduled worker repeats the deletion until it completes. A completed one stays for a day, so the
 * worker also removes a comment that a request in flight saved after the deletion.
 */
export type ProjectDeletion = AppDoc & {
    type: 'project-deletion';
    pk: typeof deletionPk;
    /** The project's internal id */
    id: string;
    workspaceId: string;
    publicId?: string;
    requestedBy: string;
    requestedAt: string;
    complete?: boolean;
    completedAt?: string;
};

const deletionPk = 'project-deletion';
/** Threads deleted at once; each delete is a few point operations */
const THREAD_CONCURRENCY = 8;
/** Workspace documents per access transaction, under the 100-operation batch with the workspace and event */
const ACCESS_BATCH = 90;

type Stores = { app?: AppStore; comments?: CommentsStore };

/**
 * Deletes a project of the current workspace with everything it owns. Admins only, never the public
 * feedback project or workspace, and only when `confirmation` is the project's name.
 */
export async function deleteProject(context: AppContext, projectId: string, confirmation: string, stores: Stores = {}) {
    const app = stores.app ?? getAppStore();
    assertMutableProject(context.workspace.id, projectId);
    if (!context.isAdmin)
        throw new UserFacingError('Only workspace admins can delete projects.');
    const project = isProjectId(projectId) ? (await app.get<DbProject>(workspacePk(context.workspace.id), projectId))?.doc : null;
    if (!project || project.type !== 'project' || project.workspaceId !== context.workspace.id)
        throw new UserFacingError('This project no longer exists.');
    // The context can be older than a role change
    const member = (await app.get<DbMember>(workspacePk(context.workspace.id), memberId(context.user.id)))?.doc;
    if (member?.type !== 'member' || member.role !== 'admin')
        throw new UserFacingError('Only workspace admins can delete projects.');
    if (confirmation.trim() !== project.name)
        throw new UserFacingError('Type the project name exactly as it is shown.');

    // What Disconnect does for each service, while the admin and the project still exist: it
    // releases shared provider credentials. Copies already sent stay with the provider.
    await disconnectProjectIntegrations(project, context.user.id, app);
    const intent = await queueProjectDeletion(project, context.user.id, app);
    try {
        await runProjectDeletion(intent, stores);
    } catch (error) {
        // Once the project is gone, the durable intent finishes the rest on the next scheduled run.
        if (await app.get(project.pk, project.id)) throw error;
        console.error('[projects] Project deletion needs scheduled retry');
    }
}

async function disconnectProjectIntegrations(project: DbProject, userId: string, app: AppStore) {
    for (const provider of integrationProviders) {
        const connections = await app.query({ type: `${provider}-connection`, pk: project.pk, where: { projectId: project.id } });
        if (!connections.length && !project.integrations?.[provider]) continue;
        await disconnectProvider(provider, project, userId);
    }
}

/** Loaded on demand, like the integration registry, to keep provider modules out of initialization cycles */
async function disconnectProvider(provider: IntegrationProviderId, project: DbProject, userId: string) {
    switch (provider) {
        case 'notion': return (await import('../integrations/notion/connection')).disconnectNotion(project, userId);
        case 'github': return (await import('../integrations/github/connection')).disconnectGitHub({ userId, workspaceId: project.workspaceId, projectId: project.id });
        case 'linear': return (await import('../integrations/linear/connection')).disconnectLinear(project, userId);
        case 'slack': return (await import('../integrations/slack/connection')).disconnectSlack(project, userId);
    }
}

export async function queueProjectDeletion(project: DbProject, requestedBy: string, app: AppStore = getAppStore()) {
    assertMutableProject(project.workspaceId, project.id);
    const intent: ProjectDeletion = {
        type: 'project-deletion', pk: deletionPk, id: project.id, workspaceId: project.workspaceId,
        ...(project.publicId ? { publicId: project.publicId } : {}),
        requestedBy, requestedAt: new Date().toISOString(), ttl: -1
    };
    if (await app.create(intent)) return intent;
    // A retry continues the earlier request
    const saved = (await app.get<ProjectDeletion>(deletionPk, project.id))?.doc;
    if (!saved || saved.workspaceId !== project.workspaceId) throw new Error('Project deletion intent mismatch');
    return saved;
}

/**
 * Every step is idempotent, so a partial run can be repeated from the start. A completed run only
 * repeats the partition passes: nothing can reach the project or grant access to it any more.
 */
export async function runProjectDeletion(intent: ProjectDeletion, { app = getAppStore(), comments = getCommentsStore() }: Stores = {}) {
    assertMutableProject(intent.workspaceId, intent.id);
    if (!intent.complete) {
        await unpublishProject(intent, app);
        await removeProjectAccess(intent, app);
        await removeProjectFromMcpAccess(intent.workspaceId, intent.id, app);
    }
    await deleteProjectThreads(intent, comments);
    await comments.deleteSequence(projectPartition(intent.id));
    await deleteProjectRecords(intent, app);
    const current = await app.get<ProjectDeletion>(deletionPk, intent.id);
    if (current && !current.doc.complete)
        await app.replace({ ...current.doc, complete: true, completedAt: new Date().toISOString(), ttl: 24 * 60 * 60 }, current.etag);
}

/** The project document and every way to reach it: its code and its public ids. */
async function unpublishProject(intent: ProjectDeletion, app: AppStore) {
    await app.delete(workspacePk(intent.workspaceId), intent.id);
    const ref = await app.get<AppDoc>(projectRefPk(intent.id), intent.id);
    if (ref?.doc.type !== 'project-ref-retired') {
        const retired: DbRetiredProjectRef = { type: 'project-ref-retired', id: intent.id, pk: projectRefPk(intent.id), retiredAt: new Date().toISOString(), ttl: -1 };
        if (!(ref ? await app.replace(retired, ref.etag) === 'ok' : await app.create(retired)))
            throw new Error('The project code changed while it was retired');
    }
    await retireProjectPublicIds(intent.id, intent.publicId, app);
}

/**
 * Team grants, direct member grants and pending invitations, through the workspace access guard.
 * Members are only updated, never deleted or recreated.
 */
async function removeProjectAccess(intent: ProjectDeletion, app: AppStore) {
    const pk = workspacePk(intent.workspaceId);
    const mentions = (doc: DbTeam | DbMember | DbInvitation) => doc.type === 'team'
        ? doc.projectIds.includes(intent.id)
        : (Array.isArray(doc.projects) && doc.projects.includes(intent.id)) || (doc.type === 'invitation' && doc.projectId === intent.id);
    for (let batch = 0; batch < 100; batch++) {
        let more = false;
        let tokens: string[] = [];
        await mutateAccess(intent.workspaceId, intent.requestedBy, async store => {
            tokens = [];
            const found = (await Promise.all((['team', 'member', 'invitation'] as const).map(type =>
                store.query<DbTeam | DbMember | DbInvitation>({ type, pk })))).flat().filter(mentions);
            if (!found.length) return null;
            more = found.length > ACCESS_BATCH;
            const operations: AppMutation[] = [];
            const before: Record<string, unknown> = {};
            const after: Record<string, unknown> = {};
            for (const { id } of found.slice(0, ACCESS_BATCH)) {
                // Change the version the transaction checks, never the query's copy
                const stored = await store.get<DbTeam | DbMember | DbInvitation>(pk, id);
                if (!stored || !mentions(stored.doc)) continue;
                const doc = stored.doc;
                if (doc.type === 'team') {
                    const projectIds = doc.projectIds.filter(projectId => projectId !== intent.id);
                    operations.push({ kind: 'replace', doc: { ...doc, projectIds }, etag: stored.etag });
                    [before[id], after[id]] = [doc.projectIds, projectIds];
                    continue;
                }
                const projects = Array.isArray(doc.projects) ? doc.projects.filter(projectId => projectId !== intent.id) : doc.projects;
                if (doc.type === 'member') {
                    operations.push({ kind: 'replace', doc: { ...doc, projects }, etag: stored.etag });
                    [before[id], after[id]] = [doc.projects, projects];
                    continue;
                }
                const { projectId: _opened, ...invitation } = doc;
                // An invitation for this project alone would let someone join with access to nothing
                const empty = invitation.role !== 'admin' && Array.isArray(projects) && !projects.length && !invitation.teamIds?.length;
                if (empty) tokens.push(invitation.tokenHash);
                // A replace restarts the database expiry: keep it at the invitation's own expiry
                const ttl = Math.max(1, Math.ceil((Date.parse(invitation.expiresAt) - Date.now()) / 1000));
                operations.push(empty ? { kind: 'delete', pk, id, etag: stored.etag } : { kind: 'replace', doc: { ...invitation, projects, ttl }, etag: stored.etag });
                [before[id], after[id]] = [doc.projects, empty ? null : projects];
            }
            if (!operations.length) return null;
            return { operations, action: 'project.deleted', targetIds: [intent.id, ...Object.keys(before)], before, after } satisfies AccessChange;
        }, { admin: false, store: app });
        // The lookup token cannot accept a deleted invitation; it only goes sooner than its expiry
        for (const hash of tokens) await app.delete(`invitation:${hash}`, hash);
        if (!more) return;
    }
    throw new Error('Too many access grants to remove');
}

/** Every thread through the single-thread delete, so images, notification records and read cursors go too. */
async function deleteProjectThreads(intent: ProjectDeletion, comments: CommentsStore) {
    const domain = projectPartition(intent.id);
    // No integration targets: the project's services were disconnected first
    const project = { id: intent.id, integrations: {} } satisfies Pick<DbProject, 'id' | 'integrations'>;
    for (let pass = 0; pass < 1000; pass++) {
        const threads = await comments.listAll(domain, 1000);
        if (!threads.length) return;
        let deleted = 0;
        const queue = [...threads];
        await Promise.all(Array.from({ length: THREAD_CONCURRENCY }, async () => {
            for (let thread = queue.shift(); thread; thread = queue.shift()) {
                const stored = await comments.get(domain, thread.id);
                if (!stored) continue;
                const matching = stored.comment.projectId === undefined || stored.comment.projectId === intent.id;
                const result = matching
                    ? await deleteProjectThread(comments, project, stored.comment, stored.etag)
                    : await comments.delete(domain, thread.id, stored.etag);
                if (result !== 'ok') continue;
                deleted++;
                await forgetScreenshot(comments, domain, thread.id, Boolean(stored.comment.screenshot), null);
            }
        }));
        // A conflict is a concurrent write: the next pass reads the thread again
        if (!deleted && pass > 3) throw new Error('Project threads keep changing during deletion');
    }
    throw new Error('Too many project threads to delete');
}

/** Records keyed by the project that no thread delete reaches. */
async function deleteProjectRecords(intent: ProjectDeletion, app: AppStore) {
    const remove = async (docs: AppDoc[]) => { for (const doc of docs) await app.delete(doc.pk, doc.id); };
    const notifications = notificationPk(intent.id);
    for (const type of ['notification-preference', 'notification-subscription', 'notification-delivery'])
        await remove(await app.query({ type, pk: notifications }));
    await remove(await app.query({ type: 'review-read', where: { domain: projectPartition(intent.id) } }));
    await remove(await app.query({ type: 'review-code', where: { projectId: intent.id } }));
    for (const type of ['comment-author', 'slack-test'])
        await remove(await app.query({ type, pk: workspacePk(intent.workspaceId), where: { projectId: intent.id } }));
    for (const provider of integrationProviders) {
        await remove(await app.query({ type: `${provider}-sync`, pk: `${provider}:${intent.id}` }));
        await remove(await app.query({ type: `${provider}-connection`, pk: workspacePk(intent.workspaceId), where: { projectId: intent.id } }));
        await remove(await app.query({ type: `${provider}-oauth-state`, where: { projectId: intent.id } }));
    }
    await remove(await app.query({ type: 'notion-grant', pk: workspacePk(intent.workspaceId), where: { projectId: intent.id } }));
    await remove(await app.query({ type: 'linear-selection', pk: workspacePk(intent.workspaceId), where: { projectId: intent.id } }));
    await remove(await app.query({ type: 'github-setup', where: { projectId: intent.id, workspaceId: intent.workspaceId } }));
}

/** Scheduled with the comment cleanup. */
export async function sweepProjectDeletions(stores: Stores = {}) {
    const app = stores.app ?? getAppStore();
    let failed = 0;
    for (const intent of await app.query<ProjectDeletion>({ type: 'project-deletion', pk: deletionPk })) {
        try { await runProjectDeletion(intent, { ...stores, app }); }
        catch { failed++; console.error('[projects] Scheduled project deletion needs retry'); }
    }
    return { failed };
}
