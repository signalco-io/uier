import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { CodingAgents } from '@/src/components/app/mcp/CodingAgents';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';
import { listAccessibleWorkspaces, listConnectedApps } from '@/src/lib/mcp/oauth/grants';
import { connectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { appBaseUrl } from '@/src/lib/app/request';
import { AccountForm, AppearanceSection } from './AccountForm';

export const metadata: Metadata = {
    title: 'Account'
};

export default async function AccountPage() {
    const context = await requireAppContext();
    const { user } = context;
    const [credentials, projects, access, grants] = await Promise.all([listMcpCredentials(user.id), listVisibleProjects(context), loadWorkspaceAccess(context.workspace.id), listConnectedApps(user.id)]);
    // Names for chosen workspaces and projects come only from what the person can open now.
    const accessible = grants.some(grant => grant.access.kind === 'selected') ? (await listAccessibleWorkspaces(user.id, user.email)).workspaces : [];
    return (
        <div className="flex max-w-3xl flex-col">
            <PageHeader title="Account" description={<span className="font-mono text-[13px]">{user.email}</span>} />
            <div className="flex flex-col gap-6">
                <Section id="my-access" title="Your workspace access" description="Your teams and projects in the selected workspace.">
                    <p className="m-0 text-sm">{context.member.role === 'admin' ? 'Workspace admin' : 'Commenter'} · {context.member.relationship ?? 'Unspecified'}</p>
                    <p className="m-0 text-sm">Teams: {access.teams.filter(team => context.member.teamIds?.includes(team.id)).map(team => team.name).join(', ') || 'None'}</p>
                    <p className="m-0 text-sm">Projects: {projects.map(project => project.name).join(', ') || 'None'}</p>
                </Section>
                <AccountForm name={user.name} />
                <AppearanceSection />
                <CodingAgents endpoint={`${await appBaseUrl()}/api/mcp`} apps={grants.map(grant => connectedAppView(grant, accessible))}
                    projects={projects.map(({ id, name }) => ({ id, name }))} credentials={credentials.map(({ id, name, projectIds, scopes, expiresAt }) => ({ id, name, projectIds, scopes, expiresAt }))} />
                <Section id="session" title="Sign out" description="Sign out of uier on this browser." actions={<SignOutButton />} />
            </div>
        </div>
    );
}
