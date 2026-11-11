
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProjectSitesForm } from '@/src/components/app/projects/ProjectSitesForm';
import { configurableProject } from '../settingsContext';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Environments · Project settings") };
}

/** The site's addresses, each with its label and the addresses it shares feedback with */
async function ProjectEnvironmentsSettingsPageContent({ params }: PageProps<'/app/projects/[projectId]/settings/environments'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);

    return (
        <ProjectSitesForm projectId={project.id} urls={project.urls} environments={project.environments ?? []} />
    );
}

export default function ProjectEnvironmentsSettingsPage(props: Parameters<typeof ProjectEnvironmentsSettingsPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading environments" />}><ProjectEnvironmentsSettingsPageContent {...props} /></Suspense>;
}
