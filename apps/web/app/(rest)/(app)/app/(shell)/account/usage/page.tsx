import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { KnownPageLinks, KnownPages, projectUsageAnchor } from '@/src/knownPages';
import { Section } from '@/src/components/app/PageHeader';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { UsageMeter } from '@/src/components/app/usage/UsageMeter';
import { resetsIn } from '@/src/components/app/usage/resetsIn';
import { requireAppContext } from '@/src/lib/app/context';
import { accountUsage, hourlyResetSeconds } from '@/src/lib/app/usage';

export const metadata: Metadata = {
    title: 'Usage · Account'
};

/**
 * The person's own limits in every project they can see, in all their workspaces (the open one first),
 * so a link from the toolbar finds its project whichever workspace is open. What a whole project shares
 * is the workspace's Usage tab.
 */
async function AccountUsagePageContent() {
    const context = await requireAppContext();
    const { workspaces, network } = await accountUsage(context);
    const reset = resetsIn(hourlyResetSeconds());
    // Workspace names head the projects only when there is more than one
    const ProjectHeading = workspaces.length > 1 ? 'h4' : 'h3';

    return (
        <>
            <Section
                id="limits"
                title="Your limits"
                description={(
                    <>
                        What you can send to each project in an hour. Counts start again on the hour, {reset}.
                        {' '}Limits a whole project shares are in <Link href={KnownPages.AppWorkspaceUsage} className="underline underline-offset-4 hover:text-foreground">workspace usage</Link>.
                    </>
                )}>
                {workspaces.length > 0
                    ? (
                        <div className="flex flex-col gap-8">
                            {workspaces.map(({ workspace, projects }) => (
                                <section key={workspace.id} aria-label={workspaces.length > 1 ? workspace.name : undefined} className="flex flex-col gap-3">
                                    {workspaces.length > 1 && <h3 className="m-0 text-xs font-medium text-muted-foreground">{workspace.name}</h3>}
                                    <ul className="m-0 flex list-none flex-col divide-y p-0" aria-label="Projects">
                                        {projects.map(({ project, meters }) => (
                                            <li key={project.id} id={projectUsageAnchor(project.publicId ?? project.id)} className="flex scroll-mt-6 flex-col gap-4 py-5 first:pt-0 last:pb-0">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <ProjectMark name={project.name} projectId={project.id} url={project.urls[0]} />
                                                    {/* A project of another workspace opens only from that workspace */}
                                                    <ProjectHeading className="m-0 min-w-0 truncate text-sm font-medium">
                                                        {workspace.id === context.workspace.id
                                                            ? <Link href={KnownPageLinks.project(project.id)} className="hover:underline hover:underline-offset-4">{project.name}</Link>
                                                            : project.name}
                                                    </ProjectHeading>
                                                </div>
                                                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                                                    {meters.map(meter => <UsageMeter key={meter.label} {...meter} />)}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    )
                    : <p className="m-0 text-sm text-muted-foreground">No projects here yet.</p>}
            </Section>
            {network && (
                <Section
                    id="network"
                    title="Your network"
                    description={`Shared with everyone who uses uier on your internet connection. Counts start again on the hour, ${reset}.`}>
                    <UsageMeter {...network} />
                </Section>
            )}
        </>
    );
}

export default function AccountUsagePage() {
    return <Suspense fallback={<PageLoading title="Loading usage" />}><AccountUsagePageContent /></Suspense>;
}
