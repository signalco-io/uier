import type { Metadata } from 'next';
import Link from 'next/link';
import { GaugeIcon } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { KnownPageLinks, projectUsageAnchor } from '@/src/knownPages';
import { WorkspaceTabHeader } from '@/src/components/app/workspace/WorkspaceTabHeader';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { UsageMeter } from '@/src/components/app/usage/UsageMeter';
import { resetsIn } from '@/src/components/app/usage/resetsIn';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { dailyResetSeconds, pageCommentsPerDay, projectInOtherWorkspace, sharedProjectUsage } from '@/src/lib/app/usage';
import { openProjectWorkspaceUsageAction } from './actions';

export const metadata: Metadata = {
    title: 'Usage'
};

/**
 * What each project the person can see shares in a day, whoever sends it. A toolbar link names its
 * project (`?project=<public id>`); when that project is in another of the person's workspaces, the page
 * offers to open it.
 */
export default async function WorkspaceUsagePage({ searchParams }: PageProps<'/app/workspace/usage'>) {
    const context = await requireAppContext();
    const requested = (await searchParams).project;
    const code = typeof requested === 'string' ? requested : undefined;
    const projects = await listVisibleProjects(context);
    const [usage, elsewhere] = await Promise.all([
        Promise.all(projects.map(async project => ({ project, meters: await sharedProjectUsage(project) }))),
        code && !projects.some(project => project.publicId === code || project.id === code) ? projectInOtherWorkspace(context, code) : null
    ]);

    return (
        <>
            <WorkspaceTabHeader description={(
                <>
                    What each project shares in a day, whoever sends it. Counts start again at midnight UTC, {resetsIn(dailyResetSeconds())}.
                    {' '}Your own limits are in <Link href={KnownPageLinks.accountUsage()} className="underline underline-offset-4 hover:text-foreground">your account</Link>.
                </>
            )} />
            {elsewhere && (
                <Alert className="mb-6">
                    <AlertTitle>{elsewhere.project.name} is in {elsewhere.workspace.name}</AlertTitle>
                    <AlertDescription>Open that workspace to see its usage.</AlertDescription>
                    <AlertAction>
                        <form action={openProjectWorkspaceUsageAction.bind(null, code!)}>
                            <Button type="submit" size="sm" variant="outline">Open workspace</Button>
                        </form>
                    </AlertAction>
                </Alert>
            )}
            {usage.length > 0
                ? (
                    <Card className="gap-0 py-0">
                        <ul className="m-0 flex list-none flex-col divide-y p-0" aria-label="Projects">
                            {usage.map(({ project, meters }) => (
                                <li key={project.id} id={projectUsageAnchor(project.publicId ?? project.id)} className="flex scroll-mt-6 flex-col gap-4 p-6">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <ProjectMark name={project.name} projectId={project.id} url={project.urls[0]} />
                                        <h2 className="m-0 min-w-0 truncate text-sm font-medium">
                                            <Link href={KnownPageLinks.project(project.id)} className="hover:underline hover:underline-offset-4">{project.name}</Link>
                                        </h2>
                                    </div>
                                    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                                        {meters.map(meter => <UsageMeter key={meter.label} {...meter} />)}
                                    </div>
                                    <p className="m-0 text-xs text-muted-foreground">Each page takes up to {pageCommentsPerDay} new comments a day.</p>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )
                : (
                    <Empty className="border">
                        <EmptyHeader>
                            <EmptyMedia variant="icon"><GaugeIcon /></EmptyMedia>
                            <EmptyTitle>No projects yet</EmptyTitle>
                            <EmptyDescription>Usage shows here once this workspace has a project.</EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
        </>
    );
}
