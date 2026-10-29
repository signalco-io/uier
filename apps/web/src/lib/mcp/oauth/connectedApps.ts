import type { McpScope } from '../scopes';
import { describeAccess, type AccessibleWorkspace, type ClientPresentation, type McpGrant } from './grants';

/**
 * What Account shows of a connected app: an allowlisted view, with no client id beyond its hosts
 * and no token data. Workspace and project names come only from what the person can open now.
 */
export type ConnectedAppView = {
    id: string;
    name: string;
    client: ClientPresentation;
    access: { all: boolean; summary: string; workspaces: { name: string; projects: string }[] };
    scopes: McpScope[];
    createdAt: string;
    lastUsedAt?: string;
    expiresAt: string;
};

export function connectedAppView(grant: McpGrant, accessible: AccessibleWorkspace[]): ConnectedAppView {
    const { access } = grant;
    const workspaces = access.kind === 'all' ? [] : access.workspaces.map(entry => {
        const workspace = accessible.find(candidate => candidate.workspace.id === entry.workspaceId);
        if (!workspace)
            return { name: 'A workspace you can no longer open', projects: '' };
        if (entry.projects === 'all')
            return { name: workspace.workspace.name, projects: 'All projects, including new ones' };
        const names = entry.projects.flatMap(id => workspace.projects.find(project => project.id === id)?.name ?? []);
        const unavailable = entry.projects.length - names.length;
        return {
            name: workspace.workspace.name,
            projects: [...names, ...(unavailable ? [`${unavailable} ${unavailable === 1 ? 'project' : 'projects'} you can no longer open`] : [])].join(', ')
        };
    });
    return {
        id: grant.id,
        name: grant.name,
        client: { name: grant.client.name, kind: grant.client.kind, metadataHost: grant.client.metadataHost, redirectHost: grant.client.redirectHost },
        access: { all: access.kind === 'all', summary: describeAccess(access), workspaces },
        scopes: grant.scopes,
        createdAt: grant.createdAt,
        lastUsedAt: grant.lastUsedAt,
        expiresAt: grant.idleExpiresAt < grant.absoluteExpiresAt ? grant.idleExpiresAt : grant.absoluteExpiresAt
    };
}
