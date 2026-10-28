import type { DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { setIntegrationBinding } from '../connection';
import { field, linearGraphql, LinearApiError, object, uuid, bounded } from './client';
import { isLinearConfigured } from './config';
import { currentLinearGrant, linearAccessToken, linearConnection, LinearSetupError, pauseLinearGrant, requireLinearAdmin } from './connection';
import type { LinearConnection, LinearDestination, LinearOptionPage, LinearSelection } from './model';
import { getLinearSettings } from './view';

type MetadataNode = { id: string; name: string; type?: string };
type Page = { nodes: MetadataNode[]; hasNext: boolean; cursor?: string };
function page(value: unknown): Page {
    if (!object(value) || !Array.isArray(value.nodes) || !object(value.pageInfo) || typeof value.pageInfo.hasNextPage !== 'boolean') throw new LinearApiError('invalid_response');
    const nodes = value.nodes.map(node => {
        if (!object(node) || !uuid(node.id) || !bounded(node.name, 100)) throw new LinearApiError('invalid_response');
        return { id: node.id, name: bounded(node.name, 100), ...(typeof node.type === 'string' ? { type: node.type } : {}) };
    });
    const cursor = typeof value.pageInfo.endCursor === 'string' && value.pageInfo.endCursor.length <= 500 ? value.pageInfo.endCursor : undefined;
    if (value.pageInfo.hasNextPage && !cursor) throw new LinearApiError('invalid_response');
    return { nodes, hasNext: value.pageInfo.hasNextPage, cursor };
}

async function metadata(project: DbProject, userId: string, kind: 'teams' | 'projects' | 'states' | 'labels', teamId?: string) {
    const current = await requireLinearAdmin(project, userId);
    if (!isLinearConfigured()) throw new LinearSetupError('not_configured');
    const connection = await linearConnection(current);
    if (!connection) throw new LinearSetupError('connect_first');
    const grant = await currentLinearGrant(connection);
    if (kind !== 'teams' && !uuid(teamId)) throw new LinearSetupError('invalid_team');
    let after: string | undefined;
    const items: MetadataNode[] = [];
    const seen = new Set<string>();
    do {
        const token = await linearAccessToken(connection);
        const selection = kind === 'states' ? 'id name type' : 'id name';
        const operationName = `UierLinear${kind[0]!.toUpperCase()}${kind.slice(1)}`;
        const query = kind === 'teams' ? `query ${operationName}($after: String) { teams(first: 100, after: $after) { nodes { ${selection} } pageInfo { hasNextPage endCursor } } }`
            : `query ${operationName}($teamId: String!, $after: String) { team(id: $teamId) { id organization { id } ${kind}(first: 100, after: $after) { nodes { ${selection} } pageInfo { hasNextPage endCursor } } } }`;
        const result = await linearGraphql(token, operationName, query, { ...(teamId ? { teamId } : {}), ...(after ? { after } : {}) }, data => {
            if (kind === 'teams') return page(data.teams);
            const team = field(data, 'team'); const organization = field(team, 'organization');
            if (team.id !== teamId || organization.id !== grant.organizationId) throw new LinearSetupError('destination_not_available');
            return page(team[kind]);
        }, undefined, { bucketKey: `${grant.clientId}:${grant.appUserId}` }).catch(async error => {
            if (error instanceof LinearApiError && error.code === 'rate_limited' && error.retryAt) await pauseLinearGrant(grant, error.retryAt);
            throw error;
        });
        for (const item of result.nodes) if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
        if (items.length >= 500) return { items: items.slice(0, 500), truncated: result.hasNext || items.length > 500 };
        if (!result.hasNext) return { items, truncated: false };
        if (result.cursor === after) throw new LinearApiError('pagination_stalled');
        after = result.cursor;
    } while (true);
}
export const loadLinearTeams = (project: DbProject, userId: string): Promise<LinearOptionPage> => metadata(project, userId, 'teams');
export const loadLinearProjects = (project: DbProject, userId: string, teamId: string): Promise<LinearOptionPage> => metadata(project, userId, 'projects', teamId);
export const loadLinearStates = (project: DbProject, userId: string, teamId: string): Promise<LinearOptionPage> => metadata(project, userId, 'states', teamId);
export const loadLinearLabels = (project: DbProject, userId: string, teamId: string): Promise<LinearOptionPage> => metadata(project, userId, 'labels', teamId);

export type SaveLinearDestination = { teamId: string; projectId?: string; openStateId: string; doneStateId: string; labelIds?: string[]; screenshots?: boolean };
export async function saveLinearDestination(project: DbProject, userId: string, input: SaveLinearDestination) {
    const current = await requireLinearAdmin(project, userId);
    if (![input.teamId, input.openStateId, input.doneStateId, ...(input.projectId ? [input.projectId] : []), ...(input.labelIds ?? [])].every(uuid)
        || input.openStateId === input.doneStateId || (input.labelIds?.length ?? 0) > 20) throw new LinearSetupError('invalid_mapping');
    const connection = await linearConnection(current);
    if (!connection) throw new LinearSetupError('connect_first');
    const grant = await currentLinearGrant(connection);
    const [teams, projects, states, labels] = await Promise.all([
        metadata(current, userId, 'teams'), input.projectId ? metadata(current, userId, 'projects', input.teamId) : Promise.resolve({ items: [], truncated: false }),
        metadata(current, userId, 'states', input.teamId), input.labelIds?.length ? metadata(current, userId, 'labels', input.teamId) : Promise.resolve({ items: [], truncated: false })
    ]);
    const team = teams.items.find(item => item.id === input.teamId);
    const destinationProject = input.projectId ? projects.items.find(item => item.id === input.projectId) : undefined;
    const open = states.items.find(item => item.id === input.openStateId);
    const done = states.items.find(item => item.id === input.doneStateId);
    if (!team || (input.projectId && !destinationProject) || !open || !done
        || !['triage', 'backlog', 'unstarted', 'started'].includes(open.type ?? '') || !['completed', 'canceled'].includes(done.type ?? '')
        || (input.labelIds ?? []).some(id => !labels.items.some(label => label.id === id))) throw new LinearSetupError('mapping_not_available');
    const config: LinearDestination = { organizationId: grant.organizationId, organizationSlug: grant.organizationSlug,
        teamId: team.id, teamName: team.name, ...(destinationProject ? { projectId: destinationProject.id, projectName: destinationProject.name } : {}),
        openStateId: open.id, openStateName: open.name, doneStateId: done.id, doneStateName: done.name,
        labelIds: [...new Set(input.labelIds ?? [])], screenshots: input.screenshots === true };
    await requireLinearAdmin(current, userId);
    const changedDestination = Boolean(connection.config.teamId && (connection.config.teamId !== config.teamId || connection.config.projectId !== config.projectId));
    const time = new Date().toISOString();
    const saved = await updateDoc<LinearConnection>(connection.pk, connection.id, old => {
        if (old.destinationRevision !== connection.destinationRevision || old.grantId !== connection.grantId || old.connectedBy !== connection.connectedBy)
            throw new LinearSetupError('connection_changed');
        return { ...old, config, destinationRevision: old.destinationRevision + 1, connectedBy: userId,
            enabled: true, status: 'connected', statusCode: undefined, updatedAt: time };
    });
    if (!saved) throw new LinearSetupError('connection_changed');
    const selection: LinearSelection = { type: 'linear-selection', id: `linear_selection_${current.id}`, pk: current.pk, projectId: current.id, connectionId: saved.id };
    if (!await getAppStore().create(selection)) await updateDoc<LinearSelection>(selection.pk, selection.id, old => ({ ...old, connectionId: saved.id }));
    await setIntegrationBinding(current.workspaceId, current.id, 'linear', { connectionId: saved.id, since: changedDestination ? time : current.integrations?.linear?.since ?? time });
    return getLinearSettings(current, userId);
}
