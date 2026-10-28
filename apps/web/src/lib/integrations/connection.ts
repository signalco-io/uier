import type { AppContext } from '../app/context';
import { workspacePk, type DbProject } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { getMember } from '../app/workspaces';
import { PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { integrationProviders, type IntegrationBinding, type IntegrationConnection, type IntegrationProviderId, type IntegrationSync } from './model';
import { configuredIntegrationAdapters } from './registry';

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
        || stored.doc.workspaceId !== context.workspace.id || projectId === PUBLIC_PROJECT_ID)
        throw new IntegrationAccessError();
    return stored.doc;
}

/** Only this provider's entry is changed; etag retries retain all sibling bindings. */
export async function setIntegrationBinding(workspaceId: string, projectId: string, provider: IntegrationProviderId,
    binding: IntegrationBinding | null, store = getAppStore(), expectedConnectionId?: string) {
    if (projectId === PUBLIC_PROJECT_ID) throw new Error('Public feedback cannot have integrations');
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
    if (!binding || project.id === PUBLIC_PROJECT_ID) return null;
    const connection = (await store.get<IntegrationConnection>(workspacePk(project.workspaceId), binding.connectionId))?.doc;
    return connection?.type === `${provider}-connection` && connection.provider === provider
        && connection.workspaceId === project.workspaceId && connection.projectId === project.id ? connection : null;
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
