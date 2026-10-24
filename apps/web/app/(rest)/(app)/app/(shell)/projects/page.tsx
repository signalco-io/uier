import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@signalco/ui-primitives/Button';
import { Add } from '@signalco/ui-icons';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectActionsMenu } from '@/src/components/app/projects/ProjectActionsMenu';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { displayUrl, projectAccessLabels } from '@/src/components/app/projects/projectLabels';

export const metadata: Metadata = {
    title: 'Projects'
};

const filters = [
    { status: 'active', label: 'Active' },
    { status: 'done', label: 'Done' }
] as const;

export default async function ProjectsPage({ searchParams }: PageProps<'/app/projects'>) {
    const context = await requireAppContext();
    const { status: statusParam } = await searchParams;
    const status = statusParam === 'done' ? 'done' : 'active';
    const projects = await listVisibleProjects(context);
    const counts = {
        active: projects.filter(project => project.status !== 'done').length,
        done: projects.filter(project => project.status === 'done').length
    };
    const shown = projects.filter(project => (project.status === 'done' ? 'done' : 'active') === status);

    return (
        <>
            <PageHeader
                title="Projects"
                description="Each project is one site you review, with its addresses and its comments."
                actions={context.isAdmin && (
                    <Button href={KnownPages.AppNewProject} variant="solid" startDecorator={<Add className="size-4" />}>
                        Create project
                    </Button>
                )}>
                <nav aria-label="Project status" className="flex gap-1">
                    {filters.map(filter => (
                        <Button
                            key={filter.status}
                            href={filter.status === 'active' ? KnownPages.AppProjects : `${KnownPages.AppProjects}?status=${filter.status}`}
                            variant={status === filter.status ? 'soft' : 'plain'}
                            size="sm"
                            aria-current={status === filter.status ? 'page' : undefined}>
                            {filter.label}
                            <span className="ml-1.5 tabular-nums text-muted-foreground">{counts[filter.status]}</span>
                        </Button>
                    ))}
                </nav>
            </PageHeader>
            {shown.length ? (
                <ul aria-label={`${status === 'done' ? 'Done' : 'Active'} projects`} className="m-0 flex list-none flex-col divide-y rounded-xl border p-0">
                    {shown.map(project => (
                        <li key={project.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                            <div className="flex min-w-0 flex-1 basis-60 flex-col">
                                <Link href={KnownPageLinks.project(project.id)} className="truncate font-medium hover:underline">
                                    {project.name}
                                </Link>
                                <span className="truncate font-mono text-[13px] text-muted-foreground">
                                    {displayUrl(project.urls[0] ?? '')}
                                    {project.urls.length > 1 && ` +${project.urls.length - 1}`}
                                </span>
                            </div>
                            <span className="text-sm text-muted-foreground">{projectAccessLabels[project.access].label}</span>
                            <div className="flex items-center gap-1">
                                <ReviewLinksMenu projectId={project.id} urls={project.urls} size="sm" />
                                {context.isAdmin && (
                                    <ProjectActionsMenu projectId={project.id} projectName={project.name} status={project.status} />
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-8">
                    <p className="m-0 font-medium">
                        {status === 'done' ? 'No done projects.' : 'No active projects.'}
                    </p>
                    <p className="m-0 text-sm text-muted-foreground">
                        {status === 'done'
                            ? 'Projects you mark as done move here. You can reopen them any time.'
                            : context.isAdmin
                                ? 'Create a project for the site you want to review, then add one script tag to it.'
                                : 'Projects you are invited to show up here.'}
                    </p>
                    {status === 'active' && context.isAdmin && (
                        <Button href={KnownPages.AppNewProject} variant="solid" startDecorator={<Add className="size-4" />}>
                            Create project
                        </Button>
                    )}
                </div>
            )}
        </>
    );
}
