import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdminContext } from '@/src/lib/app/context';
import { getProject } from '@/src/lib/app/projects';
import { loadProjectComments, projectUsage } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { Section } from '@/src/components/app/PageHeader';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { ProjectAccessForm, ProjectNameForm, ProjectPageStateForm, ProjectStatusButton, ProjectUrlsForm } from '@/src/components/app/projects/ProjectSettingsForms';

export const metadata: Metadata = {
    title: 'Project settings'
};

export default async function ProjectSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings'>) {
    const { projectId } = await params;
    const context = await requireAdminContext();
    const project = await getProject(context.workspace.id, projectId);
    if (!project)
        notFound();

    const [comments, members] = await Promise.all([
        loadProjectComments(context, project),
        listProjectMembers(context.workspace.id, project.id)
    ]);
    const usage = projectUsage(comments);
    const usageRows = [
        { label: 'Comments', value: usage.comments },
        { label: 'Open', value: usage.open },
        { label: 'Done', value: usage.done },
        { label: 'Replies', value: usage.replies },
        { label: 'Pages with comments', value: usage.pages },
        { label: 'People with access', value: members.length }
    ];

    return (
        <div className="flex max-w-3xl flex-col gap-6">
            <h2 className="sr-only">Settings</h2>
            <ProjectNameForm projectId={project.id} name={project.name} />
            <ProjectAccessForm projectId={project.id} access={project.access} />
            <ProjectUrlsForm projectId={project.id} urls={project.urls} />
            <ProjectPageStateForm projectId={project.id} policy={project.pageState} />
            <Section
                id="usage"
                title="Usage"
                description={usage.lastCommentAt
                    ? <>Everything is included; nothing here is limited by a plan. Last comment <DateTime value={usage.lastCommentAt} />.</>
                    : 'Everything is included; nothing here is limited by a plan.'}>
                <dl className="m-0 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3">
                    {usageRows.map(row => (
                        <div key={row.label} className="-mr-px -mb-px flex flex-col gap-1 border-r border-b p-4">
                            <dt className="text-sm text-muted-foreground">{row.label}</dt>
                            <dd className="m-0 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{row.value}</dd>
                        </div>
                    ))}
                </dl>
            </Section>
            <Section
                id="status"
                title="Status"
                description={project.status === 'done'
                    ? 'This project is done. Reopen it to move it back to the active projects.'
                    : 'Mark the project as done when the review is over. It moves to the done projects; nothing is deleted.'}
                actions={<ProjectStatusButton projectId={project.id} status={project.status} />} />
        </div>
    );
}
