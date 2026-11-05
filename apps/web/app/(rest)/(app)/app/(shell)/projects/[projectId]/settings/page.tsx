import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppPageLoading } from '@/src/components/app/AppPageLoading';
import type { AppContext } from '@/src/lib/app/context';
import type { DbProject } from '@/src/lib/app/model';
import { redirect } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames, loadClients, projectClient } from '@/src/lib/app/clients';
import { loadProjectUsage } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { Section } from '@/src/components/app/PageHeader';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { ProjectGeneralForm } from '@/src/components/app/projects/ProjectSettingsForms';
import { projectSettingsContext } from './settingsContext';

export const metadata: Metadata = {
    title: 'Project settings'
};

/** General: the name, client and usage, for admins; everyone else starts at their own project emails */
export default async function ProjectSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings'>) {
    const { projectId } = await params;
    const { context, project, canConfigure } = await projectSettingsContext(projectId);
    if (!canConfigure)
        redirect(KnownPageLinks.projectSettings(project.id, 'notifications'));
    const [projects, clients] = await Promise.all([
        listVisibleProjects(context),
        loadClients(context.workspace.id)
    ]);

    return (
        <>
            <ProjectGeneralForm projectId={project.id} name={project.name} clientName={projectClient(project, clients)?.name} clients={clientNames(projects, clients)} />
            <Suspense fallback={<AppPageLoading />}>
                <ProjectUsageSection context={context} project={project} />
            </Suspense>
        </>
    );
}

async function ProjectUsageSection({ context, project }: { context: AppContext; project: DbProject }) {
    const [usage, members] = await Promise.all([loadProjectUsage(context, project), listProjectMembers(project.workspaceId, project.id)]);
    const usageRows = [
        { label: 'Comments', value: usage.comments },
        { label: 'Open', value: usage.open },
        { label: 'Done', value: usage.done },
        { label: 'Replies', value: usage.replies },
        { label: 'Pages with comments', value: usage.pages },
        { label: 'People with access', value: members.length }
    ];

    return (
        <Section
            id="usage"
            title="Usage"
            description={usage.lastCommentAt
                ? <>Nothing here is limited by a plan. Last comment <DateTime value={usage.lastCommentAt} />.</>
                : 'Nothing here is limited by a plan.'}>
            <dl className="m-0 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3">
                {usageRows.map(row => (
                    <div key={row.label} className="-mr-px -mb-px flex flex-col gap-1 border-r border-b p-4">
                        <dt className="text-sm text-muted-foreground">{row.label}</dt>
                        <dd className="m-0 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{row.value}</dd>
                    </div>
                ))}
            </dl>
        </Section>
    );
}
