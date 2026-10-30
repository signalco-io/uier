import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { PageHeader } from '@/src/components/app/PageHeader';
import { requireAdminContext } from '@/src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { WorkspaceNameForm } from './WorkspaceNameForm';

export const metadata: Metadata = {
    title: 'Workspace settings'
};

/** The current workspace's own settings, for its admins (the uier workspace is managed by uier) */
export default async function WorkspaceSettingsPage() {
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID)
        redirect(KnownPages.AppProjects);

    return (
        <div className="flex max-w-3xl flex-col">
            <PageHeader title="Workspace settings" description="Settings for everyone in this workspace." />
            <div className="flex flex-col gap-6">
                <WorkspaceNameForm name={context.workspace.name} />
            </div>
        </div>
    );
}
