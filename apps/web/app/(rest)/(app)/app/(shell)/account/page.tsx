import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { McpCredentials } from '@/src/components/app/mcp/McpCredentials';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';
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
    const [credentials, projects, access] = await Promise.all([listMcpCredentials(user.id), listVisibleProjects(context), loadWorkspaceAccess(context.workspace.id)]);
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
                <McpCredentials projects={projects.map(({ id, name }) => ({ id, name }))} credentials={credentials.map(({ id, name, projectIds, scopes, expiresAt }) => ({ id, name, projectIds, scopes, expiresAt }))} endpoint={`${await appBaseUrl()}/api/mcp`} />
                <Section id="session" title="Sign out" description="Sign out of uier on this browser." actions={<SignOutButton />} />
            </div>
        </div>
    );
}
