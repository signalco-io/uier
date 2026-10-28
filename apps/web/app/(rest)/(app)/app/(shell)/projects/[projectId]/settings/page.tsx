import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppContext, type AppContext } from '@/src/lib/app/context';
import { getVisibleProject, listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames } from '@/src/lib/app/clients';
import type { DbProject } from '@/src/lib/app/model';
import { loadProjectComments, projectUsage } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { notificationPreference } from '@/src/lib/notifications/preferences';
import { Section } from '@/src/components/app/PageHeader';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { configuredEnvironments } from '@/src/lib/app/environments';
import {
    ProjectBriefForm, ProjectAccessForm, ProjectClientNameForm, ProjectEmailsButton, ProjectEmailExcerptsForm, ProjectEnvironmentsForm, ProjectNameForm, ProjectPageStateForm, ProjectStatusButton, ProjectUrlsForm
} from '@/src/components/app/projects/ProjectSettingsForms';

export const metadata: Metadata = {
    title: 'Project settings'
};

/** Everyone sets their own project emails; admins also set up the project */
export default async function ProjectSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const notifications = await notificationPreference(project.id, `user:${context.user.id}`);
    const muted = notifications?.muted ?? false;

    return (
        <div className="flex max-w-3xl flex-col gap-6">
            <h2 className="sr-only">Settings</h2>
            {context.isAdmin && <ProjectSetup project={project} clients={clientNames(await listVisibleProjects(context))} />}
            <Section
                id="emails"
                title="Email notifications"
                description={muted
                    ? 'You get no emails from this project. Threads you follow stay followed.'
                    : 'Owners and admins get new feedback. Posting in a thread follows it. Emails are batched for 5 minutes.'}
                actions={<ProjectEmailsButton projectId={project.id} muted={muted} />}>
                {context.isAdmin
                    ? <ProjectEmailExcerptsForm projectId={project.id} enabled={project.emailCommentExcerpts === true} />
                    : <p className="m-0 text-sm text-muted-foreground">Comment excerpts are {project.emailCommentExcerpts ? 'on' : 'off'}. When on, short comment excerpts go to every recipient, verified guests included. Only workspace admins can change this.</p>}
            </Section>
            {context.isAdmin && <ProjectState context={context} project={project} />}
        </div>
    );
}

function ProjectSetup({ project, clients }: { project: DbProject; clients: string[] }) {
    return (
        <>
            <ProjectNameForm projectId={project.id} name={project.name} />
            <ProjectClientNameForm projectId={project.id} clientName={project.clientName} clients={clients} />
            <ProjectAccessForm projectId={project.id} access={project.access} />
            <ProjectBriefForm projectId={project.id} brief={project.brief} access={project.access} />
            <ProjectUrlsForm projectId={project.id} urls={project.urls} />
            <ProjectEnvironmentsForm key={project.urls.join(' ')} projectId={project.id} environments={configuredEnvironments(project)} />
            <ProjectPageStateForm projectId={project.id} policy={project.pageState} />
        </>
    );
}

async function ProjectState({ context, project }: { context: AppContext; project: DbProject }) {
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
        <>
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
        </>
    );
}
