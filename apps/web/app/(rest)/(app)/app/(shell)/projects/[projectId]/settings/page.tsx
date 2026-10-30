import type { Metadata } from 'next';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext, type AppContext } from '@/src/lib/app/context';
import { getVisibleProject, listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames, loadClients, projectClient } from '@/src/lib/app/clients';
import type { DbProject } from '@/src/lib/app/model';
import { loadProjectComments, projectUsage } from '@/src/lib/app/projectComments';
import { loadQueryFieldSuggestions } from '@/src/lib/app/pageStateSuggestions';
import { listProjectMembers } from '@/src/lib/app/members';
import { notificationPreference } from '@/src/lib/notifications/preferences';
import { ProjectPeopleAndTeams } from '@/src/components/app/teams/ProjectAccess';
import { Section } from '@/src/components/app/PageHeader';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { configuredEnvironments } from '@/src/lib/app/environments';
import { PUBLIC_PROJECT_ID } from '@/src/lib/comments/publicProject';
import { getGitHubSettings } from '@/src/lib/integrations/github';
import { getLinearSettings } from '@/src/lib/integrations/linear';
import { getNotionSettings } from '@/src/lib/integrations/notion';
import { GitHubSection } from '@/src/components/app/github/GitHubSection';
import { LinearSection } from '@/src/components/app/linear/LinearSection';
import { NotionSection } from '@/src/components/app/notion/NotionSection';
import { SlackSection } from '@/src/components/app/slack/SlackSection';
import { getSlackSettings } from '@/src/lib/integrations/slack/settings';
import {
    DeleteProjectButton, ProjectBriefForm, ProjectAccessForm, ProjectClientNameForm, ProjectEmailsButton, ProjectEmailExcerptsForm, ProjectEnvironmentsForm, ProjectNameForm, ProjectPageStateForm, ProjectStatusButton, ProjectUrlsForm
} from '@/src/components/app/projects/ProjectSettingsForms';

export const metadata: Metadata = {
    title: 'Project settings',
    referrer: 'same-origin'
};

/** Everyone sets their own project emails; admins also set up the project */
export default async function ProjectSettingsPage({ params, searchParams }: PageProps<'/app/projects/[projectId]/settings'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const canConfigure = context.isAdmin && project.workspaceId !== PUBLIC_WORKSPACE_ID;
    const notifications = await notificationPreference(project.id, `user:${context.user.id}`);
    const muted = notifications?.muted ?? false;

    return (
        <div className="flex max-w-3xl flex-col gap-6">
            <h2 className="sr-only">Settings</h2>
            {canConfigure && <ProjectSetup project={project} context={context} />}
            {/* The install guide, once the empty comments list no longer links to it */}
            <Section
                id="installation"
                title="Installation"
                description="The script for your site, steps for common platforms and the installation check."
                actions={(
                    <Button variant="outline" asChild>
                        <Link href={KnownPageLinks.projectInstall(project.id)}>Open install guide</Link>
                    </Button>
                )} />
            <Section
                id="emails"
                title="Email notifications"
                actions={<ProjectEmailsButton projectId={project.id} muted={muted} />}>
                {canConfigure
                    ? <ProjectEmailExcerptsForm projectId={project.id} enabled={project.emailCommentExcerpts === true} />
                    : <p className="m-0 text-sm text-muted-foreground">Comment excerpts are {project.emailCommentExcerpts ? 'on' : 'off'}. When on, short comment excerpts go to every recipient, verified guests included. {project.workspaceId === PUBLIC_WORKSPACE_ID ? 'The public feedback project settings are fixed.' : 'Only workspace admins can change this.'}</p>}
            </Section>
            {canConfigure && project.id !== PUBLIC_PROJECT_ID
                && <ProjectIntegrations project={project} context={context} query={await searchParams} />}
            {canConfigure && <ProjectPeopleAndTeams context={context} project={project} />}
            {canConfigure && <ProjectState context={context} project={project} />}
        </div>
    );
}

async function ProjectIntegrations({ project, context, query }: { project: DbProject; context: AppContext;
    query: Record<string, string | string[] | undefined> }) {
    const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : undefined;
    const [notion, github, linear, slack] = await Promise.all([getNotionSettings(project, context.user.id),
        getGitHubSettings(project, context.user.id, value('githubSetup')), getLinearSettings(project, context.user.id),
        getSlackSettings(project, context.user.id)]);
    return <>
        <NotionSection projectId={project.id} settings={notion} outcome={value('notion')} />
        <GitHubSection projectId={project.id} settings={github} outcome={value('github')} />
        <LinearSection projectId={project.id} settings={linear} outcome={value('linear')} />
        <SlackSection projectId={project.id} settings={slack} outcome={value('slack')} />
    </>;
}

async function ProjectSetup({ project, context }: { project: DbProject; context: AppContext }) {
    const [querySuggestions, projects] = await Promise.all([loadQueryFieldSuggestions(project), listVisibleProjects(context)]);
    const clients = await loadClients(context.workspace.id);
    return (
        <>
            <ProjectNameForm projectId={project.id} name={project.name} />
            <ProjectClientNameForm projectId={project.id} clientName={projectClient(project, clients)?.name} clients={clientNames(projects, clients)} />
            <ProjectAccessForm projectId={project.id} access={project.access} />
            <ProjectBriefForm projectId={project.id} brief={project.brief} access={project.access} />
            <ProjectUrlsForm projectId={project.id} urls={project.urls} />
            <ProjectEnvironmentsForm key={project.urls.join(' ')} projectId={project.id} environments={configuredEnvironments(project)} />
            <ProjectPageStateForm projectId={project.id} policy={project.pageState} suggestions={querySuggestions} />
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
            {/* Changes to the whole project, each a row with its button */}
            <Section id="danger-zone" title="Danger zone" className="border-destructive/40">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <h3 className="m-0 text-sm font-medium">{project.status === 'done' ? 'Reopen project' : 'Mark as done'}</h3>
                            <p className="m-0 text-sm text-muted-foreground">
                                {project.status === 'done'
                                    ? 'This project is done. Reopen it to move it back to the active projects.'
                                    : 'Mark the project as done when the review is over. It moves to the done projects; nothing is deleted.'}
                            </p>
                        </div>
                        <ProjectStatusButton projectId={project.id} status={project.status} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <h3 className="m-0 text-sm font-medium">Delete project</h3>
                            <p className="m-0 text-sm text-muted-foreground">
                                Deletes the project with its comments, screenshots, review links and integration settings. This can't be undone.
                            </p>
                        </div>
                        <DeleteProjectButton projectId={project.id} name={project.name} />
                    </div>
                </div>
            </Section>
        </>
    );
}
