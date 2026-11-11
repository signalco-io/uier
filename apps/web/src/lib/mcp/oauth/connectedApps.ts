import type { AppI18n } from '../../i18n/types';
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

function accessView(access: AgentAccess, accessible: AccessibleWorkspace[], i18n?: AppI18n): AccessView {
    const t = i18n?.t ?? ((message: string) => message);
    const workspaces = access.kind === 'all' ? [] : access.workspaces.map(entry => {
        const workspace = accessible.find(candidate => candidate.workspace.id === entry.workspaceId);
        if (!workspace)
            return { name: t('A workspace you can no longer open'), projects: '' };
        if (entry.projects === 'all')
            return { name: workspace.workspace.name, projects: t('All projects, including new ones') };
        const names = entry.projects.flatMap(id => workspace.projects.find(project => project.id === id)?.name ?? []);
        const unavailable = entry.projects.length - names.length;
        return {
            name: workspace.workspace.name,
            projects: [...names, ...(unavailable ? [i18n ? i18n.t(unavailable === 1 ? '{count} project you can no longer open' : '{count} projects you can no longer open', { count: new Intl.NumberFormat(i18n.language).format(unavailable) }) : `${unavailable} ${unavailable === 1 ? 'project' : 'projects'} you can no longer open`] : [])].join(', ')
        };
    });
    return { all: access.kind === 'all', summary: describeAccess(access, i18n), workspaces };
}

export function connectedAppView(grant: McpGrant & { activeCreatedTokenCount?: number }, accessible: AccessibleWorkspace[],
    accounts: ConnectedAccountPresentation[] = [], i18n?: AppI18n): ConnectedAppView {
    const includesOtherAccounts = grant.accounts?.some(account => account.userId !== grant.userId);
    const access = includesOtherAccounts ? {
        all: false,
        summary: i18n ? i18n.t(grant.accounts!.length === 1 ? '{count} account' : '{count} accounts', { count: new Intl.NumberFormat(i18n.language).format(grant.accounts!.length) }) : `${grant.accounts!.length} ${grant.accounts!.length === 1 ? 'account' : 'accounts'}`,
        workspaces: [],
        accounts: grant.accounts!.map(account => {
            const signedIn = accounts.find(candidate => candidate.userId === account.userId);
            return { label: signedIn?.email ?? i18n?.t('Another account') ?? 'Another account',
                ...accessView(account.access, signedIn?.workspaces ?? [], i18n) };
        })
    } : accessView(grant.access, accessible, i18n);
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
