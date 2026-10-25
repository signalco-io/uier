import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { McpCredentials } from '@/src/components/app/mcp/McpCredentials';
import { listMcpCredentials } from '@/src/lib/mcp/credentials';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
import { AccountForm, AppearanceSection } from './AccountForm';

export const metadata: Metadata = {
    title: 'Account'
};

export default async function AccountPage() {
    const context = await requireAppContext();
    const { user } = context;
    const [credentials, projects] = await Promise.all([listMcpCredentials(user.id), listVisibleProjects(context)]);
    return (
        <div className="flex max-w-3xl flex-col">
            <PageHeader title="Account" description={<span className="font-mono text-[13px]">{user.email}</span>} />
            <div className="flex flex-col gap-6">
                <AccountForm name={user.name} />
                <AppearanceSection />
                <McpCredentials projects={projects.map(({ id, name }) => ({ id, name }))} credentials={credentials.map(({ id, name, projectIds, scopes, expiresAt }) => ({ id, name, projectIds, scopes, expiresAt }))} endpoint={`${await appBaseUrl()}/api/mcp`} />
                <Section id="session" title="Sign out" description="Sign out of uier on this browser." actions={<SignOutButton />} />
            </div>
        </div>
    );
}
