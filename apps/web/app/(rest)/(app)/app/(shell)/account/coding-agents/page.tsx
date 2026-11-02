import type { Metadata } from 'next';
import { requireAppContext } from '@/src/lib/app/context';
import { CodingAgents } from '@/src/components/app/mcp/CodingAgents';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';
import { listAccessibleWorkspaces, listConnectedApps } from '@/src/lib/mcp/oauth/grants';
import { connectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';

export const metadata: Metadata = {
    title: 'Coding agents · Account'
};

/** Coding tools connected to feedback as this person, and their access tokens */
export default async function AccountCodingAgentsPage() {
    const context = await requireAppContext();
    const { user } = context;
    const [credentials, projects, grants] = await Promise.all([listMcpCredentials(user.id), listVisibleProjects(context), listConnectedApps(user.id)]);
    // Names for chosen workspaces and projects come only from what the person can open now.
    const accessible = grants.some(grant => grant.access.kind === 'selected') ? (await listAccessibleWorkspaces(user.id, user.email)).workspaces : [];
    return (
        <CodingAgents endpoint={`${await appBaseUrl()}/api/mcp`} apps={grants.map(grant => connectedAppView(grant, accessible))}
            projects={projects.map(({ id, name }) => ({ id, name }))} credentials={credentials.map(({ id, name, projectIds, scopes, expiresAt }) => ({ id, name, projectIds, scopes, expiresAt }))} />
    );
}
