import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAdminContext } from '@/src/lib/app/context';
import { getProject } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
import { embedScript } from '@/src/lib/app/integration';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { CopyBlock } from '@/src/components/app/CopyBlock';
import { loadProjectComments, projectUsage } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { ProjectAccessForm, ProjectNameForm, ProjectStatusButton, ProjectUrlsForm } from '@/src/components/app/projects/ProjectSettingsForms';

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
        <div className="max-w-3xl">
            <PageHeader
                title="Settings"
                description={project.name}
                actions={<Button href={KnownPageLinks.project(project.id)} variant="plain">Back to the project</Button>} />
            <div className="flex flex-col gap-6">
                <Section id="access" title="Comments" description="Who can see and leave comments with the toolbar on your site.">
                    <ProjectAccessForm projectId={project.id} access={project.access} />
                </Section>
                <Section id="addresses" title="Site addresses" description="The main site first, then staging or preview addresses. The toolbar works only on these.">
                    <ProjectUrlsForm projectId={project.id} urls={project.urls} />
                </Section>
                <Section id="install" title="Install" description="The project code and the script for your site.">
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Project code</span>
                        <CopyBlock value={project.id} label="Copy the project code" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Embed script</span>
                        <CopyBlock value={embedScript(await appBaseUrl(), project.id)} label="Copy the embed script" />
                    </div>
                    <Button href={KnownPageLinks.projectInstall(project.id)} variant="outlined" className="self-start">Install guide</Button>
                </Section>
                <Section id="usage" title="Usage" description="Everything is included; nothing here is limited by a plan.">
                    <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {usageRows.map(row => (
                            <div key={row.label} className="flex flex-col gap-1 rounded-xl border p-4">
                                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                                <dd className="m-0 text-2xl font-semibold tabular-nums tracking-[-0.02em]">{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                    {usage.lastCommentAt && (
                        <p className="m-0 text-sm text-muted-foreground">Last comment <DateTime value={usage.lastCommentAt} /></p>
                    )}
                </Section>
                <Section id="general" title="General">
                    <ProjectNameForm projectId={project.id} name={project.name} />
                </Section>
                <Section
                    id="status"
                    title="Status"
                    description={project.status === 'done'
                        ? 'This project is done. Reopen it to move it back to the active projects.'
                        : 'Mark the project as done when the review is over. It moves to the done projects; nothing is deleted.'}>
                    <ProjectStatusButton projectId={project.id} status={project.status} />
                </Section>
            </div>
        </div>
    );
}
