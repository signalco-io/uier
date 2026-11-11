import type { Metadata } from 'next';
import { ProjectSitesForm } from '@/src/components/app/projects/ProjectSitesForm';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Environments · Project settings'
};

/** The site's addresses, each with its label and the addresses it shares feedback with */
export default async function ProjectEnvironmentsSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/environments'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);

    return (
        <ProjectSitesForm projectId={project.id} urls={project.urls} environments={project.environments ?? []} />
    );
}
