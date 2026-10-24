import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPages } from '@/src/knownPages';
import { requireAdminContext } from '@/src/lib/app/context';
import { listProjects } from '@/src/lib/app/projects';
import { PageHeader } from '@/src/components/app/PageHeader';
import { InviteForm } from '@/src/components/app/users/InviteForm';

export const metadata: Metadata = {
    title: 'Invite'
};

export default async function InvitePage({ searchParams }: PageProps<'/app/users/invite'>) {
    const context = await requireAdminContext();
    const { project } = await searchParams;
    const projects = await listProjects(context.workspace.id);
    const fromProject = projects.find(p => p.id === project);

    return (
        <div className="max-w-xl">
            <PageHeader
                title="Invite someone"
                description={fromProject
                    ? `They get an email with a link that signs them in and opens ${fromProject.name} for review.`
                    : 'They get an email with a link that signs them in.'}
                actions={<Button href={KnownPages.AppUsers} variant="plain">Back to users</Button>} />
            <InviteForm
                projects={projects.filter(p => p.status !== 'done' || p.id === fromProject?.id).map(({ id, name }) => ({ id, name }))}
                fromProjectId={fromProject?.id} />
        </div>
    );
}
