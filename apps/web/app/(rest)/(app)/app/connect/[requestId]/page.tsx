import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { getAppContext } from '@/src/lib/app/context';
import { getBrowserAccounts } from '@/src/lib/app/session';
import { PUBLIC_PROJECT_ID } from '@/src/lib/comments/publicProjectPolicy';
import { getPendingAuthorization } from '@/src/lib/mcp/oauth/authorize';
import { MAX_CONNECTED_APPS, mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { listAccessibleWorkspaces, listConnectedApps } from '@/src/lib/mcp/oauth/grants';
import { ConnectConsent, type ConsentReplace } from '@/src/components/app/mcp/ConnectConsent';

export const metadata: Metadata = {
    title: 'Connect a coding tool'
};

/** Consent for a coding tool's OAuth sign-in to the MCP endpoint, reached through a stored request id */
async function ConnectPageContent({ params }: PageProps<'/app/connect/[requestId]'>) {
    const { requestId } = await params;
    const context = await getAppContext();
    if (!context)
        redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPageLinks.mcpConnect(requestId) })}`);
    const pending = mcpOauthEnabled() ? await getPendingAuthorization(requestId) : null;
    // Always the same component: after Allow or Cancel the page refreshes with the request consumed.
    if (!pending)
        return <ConnectConsent requestId={requestId} request={null} />;

    const { user } = context;
    const [browserAccounts, apps] = await Promise.all([getBrowserAccounts(), listConnectedApps(user.id)]);
    const accounts = await Promise.all(browserAccounts.map(async account => {
        const { workspaces, truncated } = await listAccessibleWorkspaces(account.id, account.email);
        return {
            id: account.id, name: account.name, email: account.email, avatarUrl: account.avatarUrl, truncated,
            workspaces: workspaces.map(({ workspace, projects }) => ({
                id: workspace.id,
                name: workspace.name,
                projects: projects.map(project => ({ id: project.id, name: project.name, guests: project.access === 'guests' || project.id === PUBLIC_PROJECT_ID }))
            }))
        };
    }));
    const sameClient = apps.find(app => app.clientId === pending.clientId);
    const sameName = apps.find(app => app.name === pending.client.name);
    const replace: ConsentReplace | null = apps.length >= MAX_CONNECTED_APPS
        ? { mode: 'required', apps: apps.map(({ id, name }) => ({ id, name })), defaultId: sameClient?.id, limit: MAX_CONNECTED_APPS }
        : sameClient ? { mode: 'optional', app: { id: sameClient.id, name: sameClient.name }, checked: true, update: true }
            : sameName ? { mode: 'optional', app: { id: sameName.id, name: sameName.name }, checked: false }
                : null;

    // The tool asks again (for another operation, or to reconnect): the form starts from what its
    // connection has now. Only profiles signed in to this browser are shown, as in Connected apps.
    const current = sameClient ? { name: sameClient.name, scopes: sameClient.scopes,
        accounts: (sameClient.accounts ?? [{ userId: sameClient.userId, access: sameClient.access }])
            .filter(account => browserAccounts.some(candidate => candidate.id === account.userId)) } : undefined;

    return (
        <ConnectConsent requestId={requestId} request={{
            userId: user.id,
            email: user.email,
            client: pending.client,
            requestedScopes: pending.scopes,
            replace,
            current,
            accounts
        }} />
    );
}

export default function ConnectPage(props: Parameters<typeof ConnectPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading connection" />}><ConnectPageContent {...props} /></Suspense>;
}
