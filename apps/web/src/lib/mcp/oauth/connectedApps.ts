import type { McpScope } from '../scopes';
import { describeAccess, type AgentAccess, type AccessibleWorkspace, type ClientPresentation, type McpGrant } from './grants';

type AccessView = { all: boolean; summary: string; workspaces: { name: string; projects: string }[] };
export type ConnectedAccountPresentation = { userId: string; email: string; workspaces: AccessibleWorkspace[] };

/**
 * What Account shows of a connected app: an allowlisted view, with no client id beyond its hosts
 * and no token data. Workspace and project names come only from what the person can open now.
 */
export type ConnectedAppView = {
    id: string;
    name: string;
    client: ClientPresentation;
    access: AccessView & { accounts?: Array<AccessView & { label: string }> };
    scopes: McpScope[];
    createdAt: string;
    lastUsedAt?: string;
    expiresAt: string;
    activeCreatedTokenCount: number;
};

function accessView(access: AgentAccess, accessible: AccessibleWorkspace[]): AccessView {
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
    return { all: access.kind === 'all', summary: describeAccess(access), workspaces };
}

export function connectedAppView(grant: McpGrant & { activeCreatedTokenCount?: number }, accessible: AccessibleWorkspace[],
    accounts: ConnectedAccountPresentation[] = []): ConnectedAppView {
    const includesOtherAccounts = grant.accounts?.some(account => account.userId !== grant.userId);
    const access = includesOtherAccounts ? {
        all: false,
        summary: `${grant.accounts!.length} ${grant.accounts!.length === 1 ? 'account' : 'accounts'}`,
        workspaces: [],
        accounts: grant.accounts!.map(account => {
            const signedIn = accounts.find(candidate => candidate.userId === account.userId);
            return { label: signedIn?.email ?? 'Another account',
                ...accessView(account.access, signedIn?.workspaces ?? []) };
        })
    } : accessView(grant.access, accessible);
    return {
        id: grant.id,
        activeCreatedTokenCount: grant.activeCreatedTokenCount ?? 0,
        name: grant.name,
        client: { name: grant.client.name, kind: grant.client.kind, metadataHost: grant.client.metadataHost, redirectHost: grant.client.redirectHost },
        access,
        scopes: grant.scopes,
        createdAt: grant.createdAt,
        lastUsedAt: grant.lastUsedAt,
        expiresAt: grant.idleExpiresAt < grant.absoluteExpiresAt ? grant.idleExpiresAt : grant.absoluteExpiresAt
    };
}
