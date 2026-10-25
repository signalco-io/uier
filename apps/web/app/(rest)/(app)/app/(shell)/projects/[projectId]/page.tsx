import { environmentOptions, environmentSelection } from '@/src/lib/app/environments';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GlobeIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject, reviewUrl } from '@/src/lib/app/projects';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { CopyBlock } from '@/src/components/app/CopyBlock';
import { parseCommentsQuery, ProjectComments } from '@/src/components/app/comments/ProjectComments';

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

    const query = parseCommentsQuery(await searchParams);
    query.environment = environmentSelection(project, query.environment);
    const [comments, members] = await Promise.all([
        loadProjectComments(context, project, query.environment),
        listProjectMembers(context.workspace.id, project.id)
    ]);
    return (
        <>
            {project.access === 'guests' && project.urls[0] && (
                <Alert role="region" aria-labelledby="share-title">
                    <GlobeIcon />
                    <AlertTitle id="share-title">Guest link</AlertTitle>
                    <AlertDescription className="flex flex-col gap-3">
                        Anyone with this link can comment as a guest. They are asked for their name.
                        <div className="w-full">
                            <CopyBlock value={reviewUrl(project.urls[0], project.id)} label="Copy the guest link" />
                        </div>
                    </AlertDescription>
                </Alert>
            )}
            <section id="comments" aria-labelledby="comments-title" className="flex scroll-mt-6 flex-col gap-4">
                <h2 id="comments-title" className="sr-only">Comments</h2>
                <ProjectComments
                    environments={environmentOptions(project)}
                    projectId={project.id}
                    comments={comments}
                    query={query}
                    userId={context.user.id}
                    installHref={KnownPageLinks.projectInstall(project.id)}
                    assignees={members.map(({ member, name }) => ({ userId: member.userId, name }))} />
            </section>
        </>
    );
}
