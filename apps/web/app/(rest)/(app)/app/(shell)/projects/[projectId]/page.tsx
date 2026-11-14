
import { getAppI18n } from '@/src/lib/i18n/server';
import { ProjectCommentsLoading } from '@/src/components/app/comments/ProjectCommentsLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProjectForPage as getVisibleProject } from '@/src/lib/app/projectLinkPage';
import { loadAppCommentsSnapshot } from '@/src/lib/app/appCommentsSnapshot';
import { ProjectComments } from '@/src/components/app/comments/ProjectComments';
import { CommentsSection } from '@/src/components/app/comments/CommentsSection';
import { parseCommentsQuery } from '@/src/components/app/comments/commentsQuery';
import { getCommentsView } from '@/src/lib/app/commentsViewCookie';

export async function generateMetadata({ params }: PageProps<'/app/projects/[projectId]'>): Promise<Metadata> {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    const { t } = await getAppI18n();
    return { title: project?.name ?? t('Project') };
}

/** The project's comments (the first tab) */
async function ProjectPageContent({ params, searchParams }: PageProps<'/app/projects/[projectId]'>) {
    const { t } = await getAppI18n();
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    const [search, initialView] = await Promise.all([searchParams, getCommentsView()]);
    const query = parseCommentsQuery(search);
    if (!search.view && initialView) query.view = initialView;
    const snapshot = await loadAppCommentsSnapshot(context, project, query, undefined, t, {
        openId: typeof search.comment === 'string' ? search.comment : undefined, budgetFallback: true
    });
    if (!snapshot) notFound();
    return <ProjectComments {...snapshot} initialView={initialView} installHref={KnownPageLinks.projectInstall(project.id)} />;
}

export default function ProjectPage(props: Parameters<typeof ProjectPageContent>[0]) {
    // The comments region needs no data, so it is the page's static shell; inside it the comments load in the view they
    // will open in and as wide (uier #344, #362): the controls every project has, skeletons where data goes (uier #439)
    return (
        <CommentsSection>
            <Suspense fallback={<ProjectCommentsLoading />}><ProjectPageContent {...props} /></Suspense>
        </CommentsSection>
    );
}
