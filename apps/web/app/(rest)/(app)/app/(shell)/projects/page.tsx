import type { Metadata } from 'next';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FolderOpenIcon, MessageSquareIcon, PlusIcon } from 'lucide-react';
import { buttonVariants } from '@/src/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadClients, projectClient, projectClients } from '@/src/lib/app/clients';
import { loadProjectUsage } from '@/src/lib/app/projectComments';
import type { ProjectStatus } from '@/src/lib/app/model';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectActionsMenu } from '@/src/components/app/projects/ProjectActionsMenu';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import { ClientFilter } from '@/src/components/app/projects/ClientFilter';
import { ProjectStatusPanel, ProjectStatusTabs } from '@/src/components/app/projects/ProjectStatusTabs';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { AccessIcon, projectAccessLabels } from '@/src/components/app/projects/projectLabels';

export const metadata: Metadata = {
    title: 'Projects'
};

export default async function ProjectsPage({ searchParams }: PageProps<'/app/projects'>) {
    const context = await requireAppContext();
    const canManageProjects = context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID;
    const { status: statusParam, client: clientParam } = await searchParams;
    const status = statusParam === 'done' ? 'done' : 'active';
    const projects = await listVisibleProjects(context);
    const clientDocs = await loadClients(context.workspace.id);
    // Only clients of visible projects: a filter never names a client of a project the person cannot open
    const clients = projectClients(projects, clientDocs);
    // Links from before clients had ids filter by name (`name:<name>`); they open the client's id link
    const named = typeof clientParam === 'string' && clientParam.startsWith('name:')
        ? clients.find(({ name }) => clientParam === `name:${name}`) : undefined;
    if (named)
        redirect(KnownPageLinks.clientProjects(named.id, status));
    const client = typeof clientParam === 'string' && (clientParam === 'none' || clients.some(({ id }) => clientParam === id))
        ? clientParam : undefined;
    const clientOf = (project: (typeof projects)[number]) => projectClient(project, clientDocs);
    const matching = projects.filter(project => !client || (client === 'none' ? !clientOf(project) : project.clientId === client));
    const statusHref = (next: ProjectStatus) => {
        const query = new URLSearchParams();
        if (next === 'done') query.set('status', next);
        if (client) query.set('client', client);
        return `${KnownPages.AppProjects}${query.size ? `?${query}` : ''}`;
    };
    // Both lists come with the page, so Active and Done switch at once in the browser (`ProjectStatusTabs`)
    const lists: Record<ProjectStatus, typeof matching> = {
        active: matching.filter(project => project.status !== 'done'),
        done: matching.filter(project => project.status === 'done')
    };
    // Open comments per project, as the person sees them (private comments only for admins and authors)
    const openCounts = new Map(await Promise.all(matching.map(async project =>
        [project.id, (await loadProjectUsage(context, project)).open] as const)));
    const createProject = canManageProjects && (
        <Link href={KnownPages.AppNewProject} className={buttonVariants()}>
            <PlusIcon data-icon="inline-start" />
            Create project
        </Link>
    );

    // One status's list, or its empty state
    const statusPanel = (listStatus: ProjectStatus, shown = lists[listStatus]) => (
        <ProjectStatusPanel status={listStatus}>
            {shown.length ? (
                <ul aria-label={`${listStatus === 'done' ? 'Done' : 'Active'} projects`} className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map(project => {
                        const open = openCounts.get(project.id) ?? 0;
                        const access = projectAccessLabels[project.access];
                        const projectClientSummary = clientOf(project);
                        return (
                            <li key={project.id} className="flex">
                                <Card size="sm" className="relative flex-1 transition-colors hover:border-foreground/20">
                                    {/* The project header's layout: the favicon beside the name and the row under it (client, then who can comment).
                                        The favicon and the actions button sit at the top, level with the name, however far the row wraps */}
                                    <CardHeader className="flex items-start gap-3">
                                        <ProjectMark name={project.name} url={project.urls[0]} className="size-11 rounded-lg text-base [&>img]:p-2" />
                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                            <CardTitle className="truncate">
                                                {/* The whole card opens the project; the buttons sit above the link */}
                                                <Link
                                                    href={KnownPageLinks.project(project.id)}
                                                    className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset">
                                                    {project.name}
                                                </Link>
                                            </CardTitle>
                                            <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                                                {projectClientSummary && (
                                                    <span className="flex min-w-0 items-center gap-1.5">
                                                        <ClientMark client={projectClientSummary} />
                                                        <span className="truncate">Client: {projectClientSummary.name}</span>
                                                    </span>
                                                )}
                                                <span className="flex min-w-0 items-center gap-1.5">
                                                    <AccessIcon access={project.access} className="size-4 shrink-0" aria-hidden="true" />
                                                    <span className="truncate">{access.label}</span>
                                                </span>
                                            </CardDescription>
                                        </div>
                                        {canManageProjects && (
                                            <ProjectActionsMenu projectId={project.id} projectName={project.name} status={project.status} className="relative z-10 -mr-1.5" />
                                        )}
                                    </CardHeader>
                                    <CardFooter className="mt-auto flex-wrap justify-between gap-2">
                                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
                                            <MessageSquareIcon className="size-4" aria-hidden="true" />
                                            {open} open
                                        </span>
                                        <div className="relative z-10">
                                            <ReviewLinksMenu projectId={project.id} urls={project.urls} size="sm" />
                                        </div>
                                    </CardFooter>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <FolderOpenIcon />
                        </EmptyMedia>
                        <EmptyTitle>{listStatus === 'done' ? 'No done projects' : 'No active projects'}</EmptyTitle>
                        <EmptyDescription>
                            {client
                                ? 'No projects match this client and status. Choose another filter to see more projects.'
                                : listStatus === 'done'
                                ? 'Projects you mark as done move here. You can reopen them any time.'
                                : canManageProjects
                                    ? 'Create a project for the site you want to review, then add one script tag to it.'
                                    : 'Projects you are invited to show up here.'}
                        </EmptyDescription>
                    </EmptyHeader>
                    {listStatus === 'active' && canManageProjects && (
                        <EmptyContent>
                            <Link href={KnownPages.AppNewProject} className={buttonVariants()}>
                                <PlusIcon data-icon="inline-start" />
                                Create project
                            </Link>
                        </EmptyContent>
                    )}
                </Empty>
            )}
        </ProjectStatusPanel>
    );

    return (
        <>
            <PageHeader
                title="Projects"
                // The empty active list has its own Create project
                actions={createProject && (lists.active.length > 0 ? createProject : <ProjectStatusPanel status="done">{createProject}</ProjectStatusPanel>)}>
                <div className="flex flex-wrap items-center gap-3">
                    <ProjectStatusTabs
                        hrefs={{ active: statusHref('active'), done: statusHref('done') }}
                        counts={{ active: lists.active.length, done: lists.done.length }} />
                    {/* Only when a project has a client, like the sidebar's Clients link */}
                    {clients.length > 0 && <ClientFilter clients={clients.map(({ id, name }) => ({ id, name }))} value={client} />}
                </div>
            </PageHeader>
            {statusPanel('active')}
            {statusPanel('done')}
        </>
    );
}
