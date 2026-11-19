import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { KnownPageLinks } from '@/src/knownPages';
import { FileLibrary } from '@/src/components/app/proofs/FileLibrary';
import { Bar, Loading } from '@/src/components/app/loading/outlines';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProjectForPage } from '@/src/lib/app/projectLinkPage';
import { getAppI18n } from '@/src/lib/i18n/server';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';

export async function generateMetadata(): Promise<Metadata> {
    return { title: (await getAppI18n()).t('Files') };
}

async function ProjectFiles({ params }: PageProps<'/app/projects/[projectId]/files'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProjectForPage(context, projectId);
    if (!project || context.workspace.id === PUBLIC_WORKSPACE_ID) notFound();
    if (project.publicId !== projectId) redirect(KnownPageLinks.projectFiles(project.publicId));
    return <FileLibrary key={project.publicId} projectId={project.publicId} guestSharing={project.access === 'guests'}
        reviewSettingsHref={context.isAdmin ? KnownPageLinks.projectAccessSettings(project.id) : undefined}
        siteSettingsHref={context.isAdmin && !project.urls.length ? KnownPageLinks.projectSettings(project.id, 'environments') : undefined} />;
}

export default function ProjectFilesPage(props: PageProps<'/app/projects/[projectId]/files'>) {
    return <Suspense fallback={<Loading label="Loading files"><Bar className="h-40 rounded-xl" /></Loading>}><ProjectFiles {...props} /></Suspense>;
}
