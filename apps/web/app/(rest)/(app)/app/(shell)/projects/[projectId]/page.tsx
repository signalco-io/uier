
import { getAppI18n } from '@/src/lib/i18n/server';
import { CommentsLoading } from '@/src/components/app/comments/CommentsLoading';
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

    const [snapshot, initialView] = await Promise.all([
        loadAppCommentsSnapshot(context, project, parseCommentsQuery(await searchParams), undefined, t),
        getCommentsView()
    ]);
    if (!snapshot) notFound();
    return (
        <CommentsSection title={t("Comments")}>
            <ProjectComments {...snapshot} initialView={initialView} installHref={KnownPageLinks.projectInstall(project.id)} />
        </CommentsSection>
    );
}

export default function ProjectPage(props: Parameters<typeof ProjectPageContent>[0]) {
    // Shaped like the comments, in the view they will open in and as wide (uier #344)
    return <Suspense fallback={<CommentsLoading />}><ProjectPageContent {...props} /></Suspense>;
}
