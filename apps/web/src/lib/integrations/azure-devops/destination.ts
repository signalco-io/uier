import type { DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { setIntegrationBinding } from '../connection';
import { AzureDevOpsApiError, azureDevOpsProfileUrl, azureDevOpsRequest, azureDevOpsUrl, bounded, object, type AzureDevOpsResponse } from './client';
import { guid, isAzureDevOpsConfigured, validOrganization } from './config';
import { azureDevOpsAccessToken, azureDevOpsConnection, AzureDevOpsSetupError, azureDevOpsProfile, currentAzureDevOpsGrant,
    pauseAzureDevOpsGrant, requireAzureDevOpsAdmin } from './connection';
import { doneCategories, openCategories, type AzureDevOpsBodyField, type AzureDevOpsConnection, type AzureDevOpsDestination,
    type AzureDevOpsOption, type AzureDevOpsOptionPage, type AzureDevOpsProjectOptions, type AzureDevOpsSelection,
    type AzureDevOpsTypeOption } from './model';
import { getAzureDevOpsSettings } from './view';

const LIMIT = 500;
/** Work item type and state names are path and field values; keep them to bounded printable text. */
export const validName = (value: unknown, max = 128): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
const validAreaPath = (value: unknown): value is string => validName(value, 1000) && !/\\\\|^\\|\\$/.test(value);

/** Explicit admin action only: metadata reads never run while settings render. */
async function metadataClient(project: DbProject, userId: string) {
    const current = await requireAzureDevOpsAdmin(project, userId);
    if (!isAzureDevOpsConfigured()) throw new AzureDevOpsSetupError('not_configured');
    const connection = await azureDevOpsConnection(current);
    if (!connection || connection.statusCode === 'disconnected') throw new AzureDevOpsSetupError('connect_first');
    const grant = await currentAzureDevOpsGrant(connection);
    let token = await azureDevOpsAccessToken(connection);
    const get = async <T>(url: string, decode: (response: AzureDevOpsResponse) => T, retried = false): Promise<T> => {
        try { return await azureDevOpsRequest(token, url, { bucketKey: `grant:${grant.id}` }, decode); }
        catch (error) {
            if (error instanceof AzureDevOpsApiError && error.code === 'rate_limited' && error.retryAt) await pauseAzureDevOpsGrant(grant, error.retryAt);
            if (error instanceof AzureDevOpsApiError && error.code === 'unauthenticated' && !retried) {
                token = await azureDevOpsAccessToken(connection, undefined, true);
                return get(url, decode, true);
            }
            throw error;
        }
    };
    return { current, connection, grant, get, token: () => token };
}

const list = (body: unknown) => { if (!object(body) || !Array.isArray(body.value)) throw new AzureDevOpsApiError('invalid_response'); return body.value; };

async function organizations(client: Awaited<ReturnType<typeof metadataClient>>): Promise<AzureDevOpsOptionPage> {
    const profile = await azureDevOpsProfile(client.token());
    const items = await client.get(azureDevOpsProfileUrl('_apis/accounts', { memberId: profile.id }), ({ body }) => list(body).map(account => {
        if (!object(account) || !guid(account.accountId) || !validOrganization(account.accountName)) throw new AzureDevOpsApiError('invalid_response');
        return { id: account.accountId.toLowerCase(), name: account.accountName };
    }));
    return { items: items.slice(0, LIMIT), truncated: items.length > LIMIT };
}

async function projects(client: Awaited<ReturnType<typeof metadataClient>>, organization: string): Promise<AzureDevOpsOptionPage> {
    const items: AzureDevOpsOption[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < 10; page++) {
        const result = await client.get(azureDevOpsUrl(organization, '_apis/projects', { $top: '100', stateFilter: 'wellFormed',
            ...(continuation ? { continuationToken: continuation } : {}) }), response => ({ continuation: response.continuation,
            items: list(response.body).map(item => {
                if (!object(item) || !guid(item.id) || !bounded(item.name, 100)) throw new AzureDevOpsApiError('invalid_response');
                return { id: item.id.toLowerCase(), name: bounded(item.name, 100) };
            }) }));
        for (const item of result.items) if (!items.some(existing => existing.id === item.id)) items.push(item);
        if (items.length >= LIMIT) return { items: items.slice(0, LIMIT), truncated: true };
        if (!result.continuation || result.continuation === continuation || !result.items.length) return { items, truncated: false };
        continuation = result.continuation;
    }
    return { items, truncated: true };
}

async function projectOptions(client: Awaited<ReturnType<typeof metadataClient>>, organization: string, projectId: string): Promise<AzureDevOpsProjectOptions> {
    const base = `${projectId}/_apis/wit`;
    const [types, hidden, areas] = await Promise.all([
        client.get(azureDevOpsUrl(organization, `${base}/workitemtypes`), ({ body }) => list(body).flatMap(type => {
            if (!object(type) || !validName(type.name) || !Array.isArray(type.states)) throw new AzureDevOpsApiError('invalid_response');
            if (type.isDisabled === true) return [];
            const states = type.states.flatMap(state => object(state) && validName(state.name) && typeof state.category === 'string'
                ? [{ name: state.name, category: state.category }] : []);
            return [{ name: type.name, states }];
        })),
        // Hidden types (test, review and feedback request types) are not tracked on boards.
        client.get(azureDevOpsUrl(organization, `${base}/workitemtypecategories`), ({ body }) => new Set(list(body).flatMap(category =>
            object(category) && category.referenceName === 'Microsoft.HiddenCategory' && Array.isArray(category.workItemTypes)
                ? category.workItemTypes.flatMap(type => object(type) && typeof type.name === 'string' ? [type.name] : []) : []))),
        client.get(azureDevOpsUrl(organization, `${base}/classificationnodes/areas`, { $depth: '10' }), ({ body }) => {
            const paths: string[] = [];
            const walk = (node: unknown, parent?: string) => {
                if (!object(node) || !validName(node.name, 255) || node.name.includes('\\') || paths.length > LIMIT) return;
                const path = parent ? `${parent}\\${node.name}` : node.name;
                paths.push(path);
                if (Array.isArray(node.children)) for (const child of node.children) walk(child, path);
            };
            walk(body);
            return paths;
        })
    ]);
    const visible: AzureDevOpsTypeOption[] = types.filter(type => !hidden.has(type.name)).slice(0, LIMIT);
    return { organization, projectId, types: visible, areaPaths: areas.slice(0, LIMIT), truncated: types.length > LIMIT || areas.length > LIMIT };
}

export async function loadAzureDevOpsOrganizations(project: DbProject, userId: string) {
    return organizations(await metadataClient(project, userId));
}
export async function loadAzureDevOpsProjects(project: DbProject, userId: string, organization: string) {
    if (!validOrganization(organization)) throw new AzureDevOpsSetupError('invalid_mapping');
    return projects(await metadataClient(project, userId), organization);
}
export async function loadAzureDevOpsProjectOptions(project: DbProject, userId: string, organization: string, projectId: string) {
    if (!validOrganization(organization) || !guid(projectId)) throw new AzureDevOpsSetupError('invalid_mapping');
    return projectOptions(await metadataClient(project, userId), organization, projectId.toLowerCase());
}

export type SaveAzureDevOpsDestination = { organization: string; projectId: string; workItemType: string; openState: string; doneState: string; areaPath?: string };
/** Rechecks every choice against the live organization with the connected user's access before saving. */
export async function saveAzureDevOpsDestination(project: DbProject, userId: string, input: SaveAzureDevOpsDestination) {
    if (!validOrganization(input.organization) || !guid(input.projectId) || !validName(input.workItemType) || !validName(input.openState)
        || !validName(input.doneState) || input.openState === input.doneState || (input.areaPath !== undefined && !validAreaPath(input.areaPath)))
        throw new AzureDevOpsSetupError('invalid_mapping');
    const client = await metadataClient(project, userId);
    const projectId = input.projectId.toLowerCase();
    const organization = (await organizations(client)).items.find(item => item.name.toLowerCase() === input.organization.toLowerCase());
    if (!organization) throw new AzureDevOpsSetupError('mapping_not_available');
    const remote = await client.get(azureDevOpsUrl(organization.name, `_apis/projects/${projectId}`), ({ body }) => {
        if (!object(body) || !guid(body.id) || body.id.toLowerCase() !== projectId || !bounded(body.name, 100) || body.state !== 'wellFormed')
            throw new AzureDevOpsSetupError('mapping_not_available');
        return { id: projectId, name: bounded(body.name, 100) };
    });
    const options = await projectOptions(client, organization.name, projectId);
    const type = options.types.find(item => item.name === input.workItemType);
    const open = type?.states.find(state => state.name === input.openState);
    const done = type?.states.find(state => state.name === input.doneState);
    if (!type || !open || !done || !openCategories.includes(open.category) || !doneCategories.includes(done.category)
        || (input.areaPath !== undefined && !options.areaPaths.includes(input.areaPath))) throw new AzureDevOpsSetupError('mapping_not_available');
    const fields = await client.get(azureDevOpsUrl(organization.name, `${projectId}/_apis/wit/workitemtypes/${encodeURIComponent(type.name)}/fields`),
        ({ body }) => new Set(list(body).flatMap(field => object(field) && typeof field.referenceName === 'string' ? [field.referenceName] : [])));
    // Bugs show repro steps on their form instead of the description.
    const bodyField: AzureDevOpsBodyField | undefined = fields.has('Microsoft.VSTS.TCM.ReproSteps') ? 'Microsoft.VSTS.TCM.ReproSteps'
        : fields.has('System.Description') ? 'System.Description' : undefined;
    if (!bodyField) throw new AzureDevOpsSetupError('type_unsupported');
    const config: AzureDevOpsDestination = { organization: organization.name, organizationId: organization.id, projectId: remote.id,
        projectName: remote.name, workItemType: type.name, bodyField, openState: open.name, doneState: done.name,
        ...(input.areaPath !== undefined ? { areaPath: input.areaPath } : {}) };
    const current = await requireAzureDevOpsAdmin(client.current, userId);
    const connection = client.connection;
    const previous = connection.config;
    const changedDestination = Boolean(previous.projectId && (previous.organizationId !== config.organizationId || previous.projectId !== config.projectId
        || previous.workItemType !== config.workItemType));
    const time = new Date().toISOString();
    const saved = await updateDoc<AzureDevOpsConnection>(connection.pk, connection.id, old => {
        if (old.destinationRevision !== connection.destinationRevision || old.grantId !== connection.grantId || old.connectedBy !== connection.connectedBy)
            throw new AzureDevOpsSetupError('connection_changed');
        return { ...old, config, destinationRevision: old.destinationRevision + 1, connectedBy: userId,
            enabled: true, status: 'connected', statusCode: undefined, updatedAt: time };
    });
    if (!saved) throw new AzureDevOpsSetupError('connection_changed');
    const selection: AzureDevOpsSelection = { type: 'azure-devops-selection', id: `azure_devops_selection_${current.id}`, pk: current.pk,
        projectId: current.id, connectionId: saved.id };
    if (!await getAppStore().create(selection)) await updateDoc<AzureDevOpsSelection>(selection.pk, selection.id, old => ({ ...old, connectionId: saved.id }));
    await setIntegrationBinding(current.workspaceId, current.id, 'azure-devops', { connectionId: saved.id,
        since: changedDestination ? time : current.integrations?.['azure-devops']?.since ?? time });
    return getAzureDevOpsSettings(current, userId);
}
