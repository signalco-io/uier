import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { getAppContext } from '@/src/lib/app/context';
import { PUBLIC_PROJECT_ID } from '@/src/lib/comments/publicProjectPolicy';
import { getPendingAuthorization } from '@/src/lib/mcp/oauth/authorize';
import { MAX_CONNECTED_APPS, mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { listAccessibleWorkspaces, listConnectedApps } from '@/src/lib/mcp/oauth/grants';
import { ConnectConsent, type ConsentReplace } from '@/src/components/app/mcp/ConnectConsent';

export const metadata: Metadata = {
    title: 'Connect a coding tool'
};

/** Consent for a coding tool's OAuth sign-in to the MCP endpoint, reached through a stored request id */
export default async function ConnectPage({ params }: PageProps<'/app/connect/[requestId]'>) {
    const { requestId } = await params;
    const context = await getAppContext();
    if (!context)
        redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPageLinks.mcpConnect(requestId) })}`);
    const pending = mcpOauthEnabled() ? await getPendingAuthorization(requestId) : null;
    // Always the same component: after Allow or Cancel the page refreshes with the request consumed.
    if (!pending)
        return <ConnectConsent requestId={requestId} request={null} />;

    const { user } = context;
    const [{ workspaces, truncated }, apps] = await Promise.all([listAccessibleWorkspaces(user.id, user.email), listConnectedApps(user.id)]);
    const sameClient = apps.find(app => app.clientId === pending.clientId);
    const sameName = apps.find(app => app.name === pending.client.name);
    const replace: ConsentReplace | null = apps.length >= MAX_CONNECTED_APPS
        ? { mode: 'required', apps: apps.map(({ id, name }) => ({ id, name })), defaultId: sameClient?.id, limit: MAX_CONNECTED_APPS }
        : sameClient ? { mode: 'optional', app: { id: sameClient.id, name: sameClient.name }, checked: true }
            : sameName ? { mode: 'optional', app: { id: sameName.id, name: sameName.name }, checked: false }
                : null;

    return (
        <ConnectConsent requestId={requestId} request={{
            email: user.email,
            client: pending.client,
            requestedScopes: pending.scopes,
            truncated,
            replace,
            workspaces: workspaces.map(({ workspace, projects }) => ({
                id: workspace.id,
                name: workspace.name,
                projects: projects.map(project => ({ id: project.id, name: project.name, guests: project.access === 'guests' || project.id === PUBLIC_PROJECT_ID }))
            }))
        }} />
    );
}
