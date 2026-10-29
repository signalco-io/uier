import { environmentOptions, environmentSelection } from '@/src/lib/app/environments';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { resolveCommentAuthorFilter } from '@/src/lib/app/commentAuthors';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
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
    const author = query.author ? await resolveCommentAuthorFilter(context, project, query.author) : undefined;
    if (query.author && !author) notFound();
    query.environment = environmentSelection(project, query.environment);
    const [comments, members] = await Promise.all([
        loadProjectComments(context, project, query.environment, author?.authorId),
        listProjectMembers(context.workspace.id, project.id)
    ]);
    return (
        <>
            <section id="comments" aria-labelledby="comments-title" className="flex scroll-mt-6 flex-col gap-4">
                <h2 id="comments-title" className="sr-only">Comments</h2>
                <ProjectComments
                    environments={environmentOptions(project)}
                    projectId={project.id}
                    access={project.access}
                    isAdmin={context.isAdmin}
                    comments={comments}
                    query={query}
                    authorFilter={author?.filter}
                    userId={context.user.id}
                    installHref={KnownPageLinks.projectInstall(project.id)}
                    assignees={members.map(({ member, name }) => ({ userId: member.userId, name }))} />
            </section>
        </>
    );
}
