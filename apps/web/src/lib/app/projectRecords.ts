import { workspacePk, type AppDoc, type DbInvitation, type DbMember, type DbProject, type DbTeam } from './model';
import type { AppMutation, AppStore } from './store';
import { integrationProviders, type IntegrationProviderId } from '../integrations/model';
import { eventsPk as mcpEventsPk } from '../mcp/events/subscriptions';

/*
 * What a project leaves in its workspace: access grants, connected services and their records.
 * Deleting a project removes them; so does transferring it to another workspace, where none of
 * them apply. Every helper is idempotent.
 */

/** Removals of one batch of the project's grants in a workspace, for one `mutateAccess` transaction */
export type GrantRemovals = {
    operations: AppMutation[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    /** Lookup tokens of invitations deleted because they would grant nothing */
    tokens: string[];
    /** More grants remain after this batch */
    more: boolean;
};

/**
 * Team grants, direct member grants and pending invitations of the project, read from the store the
 * transaction checks. Members are only updated, never deleted or recreated. An invitation for this
 * project alone is deleted with its lookup token (pass `tokens` to `deleteInvitationTokens` after
 * the transaction).
 */
export async function projectGrantRemovals(store: AppStore, workspaceId: string, projectId: string, limit: number): Promise<GrantRemovals> {
    const pk = workspacePk(workspaceId);
    const mentions = (doc: DbTeam | DbMember | DbInvitation) => doc.type === 'team'
        ? doc.projectIds.includes(projectId)
        : (Array.isArray(doc.projects) && doc.projects.includes(projectId)) || (doc.type === 'invitation' && doc.projectId === projectId);
    const found = (await Promise.all((['team', 'member', 'invitation'] as const).map(type =>
        store.query<DbTeam | DbMember | DbInvitation>({ type, pk })))).flat().filter(mentions);
    const removals: GrantRemovals = { operations: [], before: {}, after: {}, tokens: [], more: found.length > limit };
    const { operations, before, after, tokens } = removals;
    for (const { id } of found.slice(0, limit)) {
        // Change the version the transaction checks, never the query's copy
        const stored = await store.get<DbTeam | DbMember | DbInvitation>(pk, id);
        if (!stored || !mentions(stored.doc)) continue;
        const doc = stored.doc;
        if (doc.type === 'team') {
            const projectIds = doc.projectIds.filter(other => other !== projectId);
            operations.push({ kind: 'replace', doc: { ...doc, projectIds }, etag: stored.etag });
            [before[id], after[id]] = [doc.projectIds, projectIds];
            continue;
        }
        const projects = Array.isArray(doc.projects) ? doc.projects.filter(other => other !== projectId) : doc.projects;
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
    return removals;
}

/** The lookup token cannot accept a deleted invitation; it only goes sooner than its expiry */
export async function deleteInvitationTokens(tokens: string[], store: AppStore) {
    for (const hash of tokens) await store.delete(`invitation:${hash}`, hash);
}

/**
 * What Disconnect does for each connected service, as the given admin, while the project is still in
 * its workspace: it releases shared provider credentials and stops delivery. Copies already sent stay
 * with the provider.
 */
export async function disconnectProjectIntegrations(project: DbProject, userId: string, store: AppStore) {
    for (const provider of integrationProviders) {
        const connections = await store.query({ type: `${provider}-connection`, pk: project.pk, where: { projectId: project.id } });
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
        case 'azure-devops': return (await import('../integrations/azure-devops/connection')).disconnectAzureDevOps(project, userId);
    }
}

async function removeAll(docs: AppDoc[], store: AppStore) {
    for (const doc of docs) await store.delete(doc.pk, doc.id);
}

/**
 * The project's integration records in a workspace once its services are disconnected: every sync
 * ledger of the project (they name the workspace they were made in), connections, OAuth states,
 * grants, selections and GitHub setups.
 */
export async function deleteProjectIntegrationRecords(projectId: string, workspaceId: string, store: AppStore) {
    const pk = workspacePk(workspaceId);
    for (const provider of integrationProviders) {
        await removeAll(await store.query({ type: `${provider}-sync`, pk: `${provider}:${projectId}` }), store);
        await removeAll(await store.query({ type: `${provider}-connection`, pk, where: { projectId } }), store);
        await removeAll(await store.query({ type: `${provider}-oauth-state`, where: { projectId } }), store);
    }
    for (const type of ['notion-grant', 'linear-selection', 'azure-devops-selection', 'azure-devops-grant'])
        await removeAll(await store.query({ type, pk, where: { projectId } }), store);
    await removeAll(await store.query({ type: 'github-setup', where: { projectId, workspaceId } }), store);
}

/** Records in the workspace's partition that name the project: admins' author filters and Slack test receipts */
export async function deleteProjectWorkspaceRecords(projectId: string, workspaceId: string, store: AppStore) {
    for (const type of ['comment-author', 'slack-test', 'comment-query-view', 'comment-query-link'])
        await removeAll(await store.query({ type, pk: workspacePk(workspaceId), where: { projectId } }), store);
}

/** MCP event subscriptions (callback URLs, encrypted secrets), the discovery cursor and delivery rows */
export async function deleteProjectMcpEvents(projectId: string, store: AppStore) {
    for (const type of ['mcp-event-subscription', 'mcp-event-cursor', 'mcp-event-delivery'])
        await removeAll(await store.query({ type, pk: mcpEventsPk(projectId) }), store);
}
