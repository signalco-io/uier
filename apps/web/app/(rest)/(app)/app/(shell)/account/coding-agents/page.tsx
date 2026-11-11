
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireAppContext } from '@/src/lib/app/context';
import { CodingAgents } from '@/src/components/app/mcp/CodingAgents';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';
import { listAccessibleWorkspaces, listConnectedApps } from '@/src/lib/mcp/oauth/grants';
import { connectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
import { getBrowserAccounts } from '@/src/lib/app/session';

export const metadata: Metadata = {
    title: 'Coding agents · Account'
};

/** Coding tools connected to feedback as this person, and their access tokens */
async function AccountCodingAgentsPageContent() {
    const context = await requireAppContext();
    const { user } = context;
    const [credentials, projects, grants] = await Promise.all([listMcpCredentials(user.id), listVisibleProjects(context), listConnectedApps(user.id)]);
    // Names for chosen workspaces and projects come only from what the person can open now.
    const browserAccounts = await getBrowserAccounts();
    const accountPresentations = await Promise.all(browserAccounts.filter(account => account.id === user.id
        || grants.some(grant => grant.accounts?.some(selection => selection.userId === account.id))
        || credentials.some(credential => credential.actingUserId === account.id))
        .map(async account => ({ userId: account.id, email: account.email,
            workspaces: credentials.some(credential => credential.actingUserId === account.id)
                || grants.some(grant => (grant.accounts?.find(selection => selection.userId === account.id)?.access
                ?? (account.id === user.id ? grant.access : undefined))?.kind === 'selected')
                ? (await listAccessibleWorkspaces(account.id, account.email)).workspaces : [] })));
    const accessible = accountPresentations.find(account => account.userId === user.id)?.workspaces ?? [];
    return (
        <CodingAgents endpoint={`${await appBaseUrl()}/api/mcp`} apps={grants.map(grant => connectedAppView(grant, accessible, accountPresentations))}
            projects={projects.map(({ id, name }) => ({ id, name }))} credentials={credentials.map(({ id, name, projectIds, scopes, expiresAt, createdBy, actingUserId }) => {
                const actor = actingUserId ? accountPresentations.find(account => account.userId === actingUserId) : undefined;
                return { id, name, projectIds, scopes, expiresAt,
                    ...(createdBy ? { createdBy: { name: createdBy.name } } : {}),
                    ...(actingUserId ? { actingAccount: actor?.email ?? 'Another account', projectNames: projectIds.map(projectId =>
                        actor?.workspaces.flatMap(workspace => workspace.projects).find(project => project.id === projectId)?.name ?? projectId) } : {}) };
            })} />
    );
}

export default function AccountCodingAgentsPage() {
    return <Suspense fallback={<PageLoading title="Loading coding agents" />}><AccountCodingAgentsPageContent /></Suspense>;
}
