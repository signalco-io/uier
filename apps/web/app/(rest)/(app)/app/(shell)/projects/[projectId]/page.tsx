import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { loadAppCommentsSnapshot } from '@/src/lib/app/appCommentsSnapshot';
import { ProjectComments } from '@/src/components/app/comments/ProjectComments';
import { parseCommentsQuery } from '@/src/components/app/comments/commentsQuery';

export async function generateMetadata({ params }: PageProps<'/app/projects/[projectId]'>): Promise<Metadata> {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    return { title: project?.name ?? 'Project' };
}

/** The project's comments (the first tab) */
export default async function ProjectPage({ params, searchParams }: PageProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    const snapshot = await loadAppCommentsSnapshot(context, project, parseCommentsQuery(await searchParams));
    if (!snapshot) notFound();
    return (
        <>
            <section id="comments" aria-labelledby="comments-title" className="flex scroll-mt-6 flex-col gap-4">
                <h2 id="comments-title" className="sr-only">Comments</h2>
                <ProjectComments {...snapshot} installHref={KnownPageLinks.projectInstall(project.id)} />
            </section>
        </>
    );
}
