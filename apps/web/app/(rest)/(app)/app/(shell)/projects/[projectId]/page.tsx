import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { Settings } from '@signalco/ui-icons';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { displayUrl, projectAccessLabels } from '@/src/components/app/projects/projectLabels';

export async function generateMetadata({ params }: PageProps<'/app/projects/[projectId]'>): Promise<Metadata> {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    return { title: project?.name ?? 'Project' };
}

export default async function ProjectPage({ params }: PageProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    return (
        <>
            <PageHeader
                title={project.name}
                description={(
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono">{displayUrl(project.urls[0] ?? '')}</span>
                        <span>{projectAccessLabels[project.access].label}</span>
                        {project.status === 'done' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
                                <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                                Done
                            </span>
                        )}
                    </span>
                )}
                actions={(
                    <>
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} />
                        {context.isAdmin && (
                            <Button href={KnownPageLinks.projectSettings(project.id)} variant="plain" startDecorator={<Settings className="size-4" />}>
                                Settings
                            </Button>
                        )}
                    </>
                )} />
            <Section id="comments" title="Comments" description="Comments left on the site with the toolbar show up here.">
                <p className="m-0 text-sm text-muted-foreground">
                    No comments yet. Add the script to the site, then open a review link and pin the first comment.
                </p>
                <Button href={KnownPageLinks.projectInstall(project.id)} variant="outlined" className="self-start">Install the script</Button>
            </Section>
        </>
    );
}
