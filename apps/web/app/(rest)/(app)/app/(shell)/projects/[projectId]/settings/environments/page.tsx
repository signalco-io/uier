import type { Metadata } from 'next';
import { configuredEnvironments } from '@/src/lib/app/environments';
import { ProjectEnvironmentsForm, ProjectUrlsForm } from '@/src/components/app/projects/ProjectSettingsForms';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Environments · Project settings'
};

/** The site's addresses and the environment each origin belongs to */
export default async function ProjectEnvironmentsSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/environments'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);

    return (
        <>
            <ProjectUrlsForm projectId={project.id} urls={project.urls} />
            <ProjectEnvironmentsForm key={project.urls.join(' ')} projectId={project.id} environments={configuredEnvironments(project)} />
        </>
    );
}
