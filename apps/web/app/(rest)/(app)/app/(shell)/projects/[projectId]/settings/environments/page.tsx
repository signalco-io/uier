import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProjectSitesForm } from '@/src/components/app/projects/ProjectSettingsForms';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Environments · Project settings'
};

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
