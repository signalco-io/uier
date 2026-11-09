import type { AppContext } from '../app/context';
import { workspacePk, type DbProject } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { getMember } from '../app/workspaces';
import { isLiveProject } from '../app/projectPublicIds';
import { isUierFeedbackProject } from '../comments/publicProject';
import { integrationProviders, type IntegrationBinding, type IntegrationConnection, type IntegrationProviderId, type IntegrationSync } from './model';
import { configuredIntegrationAdapters } from './registry';
import { UserFacingError } from '../app/actionErrors';
import { slackReplyScopes } from './slack/config';
import type { SlackGrant } from './slack/model';

export class IntegrationAccessError extends Error {
    constructor() {
        super('Only a current workspace admin can manage this integration.');
        this.name = 'IntegrationAccessError';
    }
}

export async function requireIntegrationAdmin(context: AppContext, projectId: string) {
    const member = await getMember(context.workspace.id, context.user.id);
    const stored = await getAppStore().get<DbProject>(workspacePk(context.workspace.id), projectId);
    if (member?.role !== 'admin' || !stored || stored.doc.type !== 'project'
        || stored.doc.workspaceId !== context.workspace.id || isUierFeedbackProject(projectId) || !await isLiveProject(stored.doc))
        throw new IntegrationAccessError();
    return stored.doc;
}

/** Only this provider's entry is changed; etag retries retain all sibling bindings. */
export async function setIntegrationBinding(workspaceId: string, projectId: string, provider: IntegrationProviderId,
    binding: IntegrationBinding | null, store = getAppStore(), expectedConnectionId?: string) {
    if (isUierFeedbackProject(projectId)) throw new Error('Public feedback cannot have integrations');
    return updateDoc<DbProject>(workspacePk(workspaceId), projectId, project => {
        if (project.type !== 'project' || project.workspaceId !== workspaceId) throw new Error('Integration project mismatch');
        if (expectedConnectionId && project.integrations?.[provider]?.connectionId !== expectedConnectionId)
            throw new Error('Integration binding changed');
        const integrations = { ...project.integrations };
        if (binding) integrations[provider] = binding;
        else delete integrations[provider];
        return { ...project, integrations, updatedAt: new Date().toISOString() };
    }, store);
}

export async function getIntegrationConnection(project: DbProject, provider: IntegrationProviderId, store = getAppStore()) {
    const binding = project.integrations?.[provider];
    if (!binding || isUierFeedbackProject(project.id)) return null;
    const connection = (await store.get<IntegrationConnection>(workspacePk(project.workspaceId), binding.connectionId))?.doc;
    return connection?.type === `${provider}-connection` && connection.provider === provider
        && connection.workspaceId === project.workspaceId && connection.projectId === project.id ? connection : null;
}

/** Disable remains available even if provider credentials are unavailable. */
export async function setIntegrationTwoWaySync(project: DbProject, provider: IntegrationProviderId, userId: string,
    enabled: boolean, store = getAppStore()) {
    if (typeof enabled !== 'boolean') throw new UserFacingError('Choose whether two-way status sync is on.');
    const member = await getMember(project.workspaceId, userId);
    const currentProject = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    if (member?.role !== 'admin' || currentProject?.type !== 'project' || currentProject.workspaceId !== project.workspaceId
        || isUierFeedbackProject(currentProject.id)) throw new IntegrationAccessError();
    const adapter = configuredIntegrationAdapters.find(value => value.provider === provider);
    if (!adapter?.supportsStatusSync) throw new UserFacingError('This integration does not support two-way status sync.');
    const connection = await getIntegrationConnection(currentProject, provider, store);
    if (!connection) throw new UserFacingError('Connect this integration first.');
    return updateDoc<IntegrationConnection>(connection.pk, connection.id, current => {
        if (current.destinationRevision !== connection.destinationRevision || current.grantId !== connection.grantId
            || current.connectedBy !== connection.connectedBy) throw new UserFacingError('The connection changed. Reload and try again.');
        if (enabled && (!adapter.isConfigured() || current.status !== 'connected')) throw new UserFacingError('Reconnect this integration first.');
        const mapping = current.config.mapping as { status?: unknown } | undefined;
        if (enabled && provider === 'notion' && !mapping?.status)
            throw new UserFacingError('Map a Notion status field before enabling two-way status sync.');
        return { ...current, twoWaySync: enabled, updatedAt: new Date().toISOString() };
    }, store);
}

/** Reply import is independent of status sync and remains an explicit admin opt-in. */
export async function setIntegrationReplySync(project: DbProject, provider: IntegrationProviderId, userId: string,
    enabled: boolean, store = getAppStore()) {
    if (typeof enabled !== 'boolean') throw new UserFacingError('Choose whether reply sync is on.');
    const member = await getMember(project.workspaceId, userId);
    const currentProject = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    if (member?.role !== 'admin' || currentProject?.type !== 'project' || currentProject.workspaceId !== project.workspaceId
        || isUierFeedbackProject(currentProject.id)) throw new IntegrationAccessError();
    const adapter = configuredIntegrationAdapters.find(value => value.provider === provider);
    if (!adapter?.supportsReplySync) throw new UserFacingError('This integration does not support reply sync.');
    const connection = await getIntegrationConnection(currentProject, provider, store);
    if (!connection) throw new UserFacingError('Connect this integration first.');
    if (enabled && provider === 'slack') {
        const grant = connection.grantId ? (await store.get<SlackGrant>(connection.pk, connection.grantId))?.doc : null;
        if (!grant || !slackReplyScopes.every(scope => grant.scopes.includes(scope)))
            throw new UserFacingError('Reconnect Slack to allow reading thread replies.');
    }
    return updateDoc<IntegrationConnection>(connection.pk, connection.id, current => {
        if (current.destinationRevision !== connection.destinationRevision || current.grantId !== connection.grantId
            || current.connectedBy !== connection.connectedBy) throw new UserFacingError('The connection changed. Reload and try again.');
        if (enabled && (!adapter.isConfigured() || current.status !== 'connected')) throw new UserFacingError('Reconnect this integration first.');
        return { ...current, replySync: { enabled, since: enabled && !current.replySync?.enabled ? new Date().toISOString()
            : current.replySync?.since ?? new Date().toISOString() }, updatedAt: new Date().toISOString() };
    }, store);
}

/** A pause retains the destination and uncertain delivery identities for safe reconciliation. */
export async function setIntegrationEnabled(project: DbProject, provider: IntegrationProviderId, userId: string, enabled: boolean,
    store = getAppStore()) {
    const member = await getMember(project.workspaceId, userId);
    const currentProject = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    if (member?.role !== 'admin' || currentProject?.type !== 'project' || currentProject.workspaceId !== project.workspaceId
        || isUierFeedbackProject(currentProject.id)) throw new IntegrationAccessError();
    const connection = await getIntegrationConnection(currentProject, provider, store);
    if (!connection) throw new Error('Integration is not connected');
    if (enabled && (!configuredIntegrationAdapters.find(adapter => adapter.provider === provider)?.isConfigured()
        || connection.status !== 'connected')) throw new Error('Reconnect this integration first');
    const updated = await updateDoc<IntegrationConnection>(connection.pk, connection.id, current => {
        if (current.destinationRevision !== connection.destinationRevision || current.grantId !== connection.grantId
            || current.connectedBy !== connection.connectedBy || current.status !== connection.status)
            throw new Error('Integration connection changed');
        return { ...current, enabled, updatedAt: new Date().toISOString() };
    }, store);
    if (enabled) {
        // Existing attempts remain intact. The worker rechecks authority before every call.
        for (const ledger of await store.query<IntegrationSync>({ type: `${provider}-sync`, pk: `${provider}:${project.id}`,
            where: { connectionId: connection.id, active: true }, limit: 1000 }))
            await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => ({ ...current,
                nextAttemptAt: new Date().toISOString() }), store);
    }
    return updated;
}

/** Disable before removing a pointer; stale workers still recheck the current row. */
export async function disconnectIntegration(project: DbProject, provider: IntegrationProviderId, store = getAppStore()) {
    const connection = await getIntegrationConnection(project, provider, store);
    if (!connection) return;
    await updateDoc<IntegrationConnection>(connection.pk, connection.id, current => {
        if (current.destinationRevision !== connection.destinationRevision || current.connectedBy !== connection.connectedBy)
            throw new Error('Integration connection changed');
        return { ...current, enabled: false, status: 'needs_reconnect', statusCode: 'disconnected', updatedAt: new Date().toISOString() };
    }, store);
    await setIntegrationBinding(project.workspaceId, project.id, provider, null, store, connection.id);
    for (const ledger of await store.query<IntegrationSync>({ type: `${provider}-sync`, pk: `${provider}:${project.id}`, where: { connectionId: connection.id } }))
        await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => ({ ...current,
            active: false, status: 'suppressed', lastCode: 'disconnected' }), store);
    // Retain the disabled record and external ids for reconciliation. Provider credential cleanup
    // uses the grant service and never deletes another project's shared installation.
}

export async function revokeIntegrationGrantsOf(workspaceId: string, userId: string, store: AppStore = getAppStore()) {
    for (const provider of integrationProviders) {
        for (const connection of await store.query<IntegrationConnection>({ type: `${provider}-connection`,
            pk: workspacePk(workspaceId), where: { connectedBy: userId } })) {
            await updateDoc<IntegrationConnection>(connection.pk, connection.id, current => current.connectedBy !== userId ? current : ({ ...current,
                enabled: false, status: 'needs_reconnect', statusCode: 'member_left', updatedAt: new Date().toISOString() }), store);
        }
        await configuredIntegrationAdapters.find(adapter => adapter.provider === provider)?.revokeAdmin?.(workspaceId, userId);
    }
}
