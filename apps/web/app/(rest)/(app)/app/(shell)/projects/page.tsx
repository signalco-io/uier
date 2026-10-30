import type { Metadata } from 'next';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FolderOpenIcon, MessageSquareIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadClients, projectClient, projectClients } from '@/src/lib/app/clients';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { PageHeader } from '@/src/components/app/PageHeader';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { ProjectActionsMenu } from '@/src/components/app/projects/ProjectActionsMenu';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import { ClientFilter } from '@/src/components/app/projects/ClientFilter';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { AccessIcon, displayUrl, projectAccessLabels } from '@/src/components/app/projects/projectLabels';

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
    const statusHref = (next: 'active' | 'done') => {
        const query = new URLSearchParams();
        if (next === 'done') query.set('status', next);
        if (client) query.set('client', client);
        return `${KnownPages.AppProjects}${query.size ? `?${query}` : ''}`;
    };
    const counts = {
        active: matching.filter(project => project.status !== 'done').length,
        done: matching.filter(project => project.status === 'done').length
    };
    const shown = matching.filter(project => (project.status === 'done' ? 'done' : 'active') === status);
    // Open comments per project, as the person sees them (private comments only for admins and authors)
    const openCounts = await Promise.all(shown.map(async project =>
        (await loadProjectComments(context, project)).filter(comment => !comment.resolved).length));

    return (
        <>
            <PageHeader
                title="Projects"
                // The empty active list has its own Create project
                actions={canManageProjects && (shown.length > 0 || status === 'done') && (
                    <Button asChild>
                        <Link href={KnownPages.AppNewProject}>
                            <PlusIcon data-icon="inline-start" />
                            Create project
                        </Link>
                    </Button>
                )}>
                <div className="flex flex-wrap items-center gap-3">
                    <LinkTabs
                        label="Project status"
                        variant="segmented"
                        tabs={[
                            { href: statusHref('active'), label: 'Active', count: counts.active, current: status === 'active' },
                            { href: statusHref('done'), label: 'Done', count: counts.done, current: status === 'done' }
                        ]} />
                    {/* Only when a project has a client, like the sidebar's Clients link */}
                    {clients.length > 0 && <ClientFilter clients={clients.map(({ id, name }) => ({ id, name }))} value={client} status={status} />}
                </div>
            </PageHeader>
            {shown.length ? (
                <ul aria-label={`${status === 'done' ? 'Done' : 'Active'} projects`} className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((project, index) => {
                        const open = openCounts[index] ?? 0;
                        const access = projectAccessLabels[project.access];
                        const projectClientSummary = clientOf(project);
                        return (
                            <li key={project.id} className="flex">
                                <Card size="sm" className="relative flex-1 transition-colors hover:border-foreground/20">
                                    <CardHeader className="flex items-center gap-3">
                                        <ProjectMark name={project.name} url={project.urls[0]} className="size-9 rounded-lg text-sm [&>img]:p-2" />
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <CardTitle className="truncate">
                                                {/* The whole card opens the project; the buttons sit above the link */}
                                                <Link
                                                    href={KnownPageLinks.project(project.id)}
                                                    className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset">
                                                    {project.name}
                                                </Link>
                                            </CardTitle>
                                            <CardDescription className="truncate font-mono text-[13px]">
                                                {displayUrl(project.urls[0] ?? '')}
                                                {project.urls.length > 1 && ` +${project.urls.length - 1}`}
                                            </CardDescription>
                                            {projectClientSummary && (
                                                <CardDescription className="flex min-w-0 items-center gap-1.5">
                                                    <ClientMark client={projectClientSummary} />
                                                    <span className="truncate">Client: {projectClientSummary.name}</span>
                                                </CardDescription>
                                            )}
                                        </div>
                                        {canManageProjects && (
                                            <ProjectActionsMenu projectId={project.id} projectName={project.name} status={project.status} className="relative z-10 -mr-1.5" />
                                        )}
                                    </CardHeader>
                                    <CardFooter className="mt-auto flex-wrap justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                                                <MessageSquareIcon className="size-4" aria-hidden="true" />
                                                {open} open
                                            </span>
                                            <span className="inline-flex items-center gap-1.5">
                                                <AccessIcon access={project.access} className="size-4" aria-hidden="true" />
                                                {access.label}
                                            </span>
                                        </div>
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
                        <EmptyTitle>{status === 'done' ? 'No done projects' : 'No active projects'}</EmptyTitle>
                        <EmptyDescription>
                            {client
                                ? 'No projects match this client and status. Choose another filter to see more projects.'
                                : status === 'done'
                                ? 'Projects you mark as done move here. You can reopen them any time.'
                                : canManageProjects
                                    ? 'Create a project for the site you want to review, then add one script tag to it.'
                                    : 'Projects you are invited to show up here.'}
                        </EmptyDescription>
                    </EmptyHeader>
                    {status === 'active' && canManageProjects && (
                        <EmptyContent>
                            <Button asChild>
                                <Link href={KnownPages.AppNewProject}>
                                    <PlusIcon data-icon="inline-start" />
                                    Create project
                                </Link>
                            </Button>
                        </EmptyContent>
                    )}
                </Empty>
            )}
        </>
    );
}
