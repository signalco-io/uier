import type { Metadata } from 'next';
import { loadQueryFieldSuggestions } from '@/src/lib/app/pageStateSuggestions';
import { ProjectAccessForm, ProjectBriefForm, ProjectPageStateForm } from '@/src/components/app/projects/ProjectSettingsForms';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Review · Project settings'
};

/** Who can comment, what reviewers are asked to review and which page state their comments keep */
export default async function ProjectReviewSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/review'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);
    const querySuggestions = await loadQueryFieldSuggestions(project);

    return (
        <>
            <ProjectAccessForm projectId={project.id} access={project.access} />
            <ProjectBriefForm projectId={project.id} brief={project.brief} access={project.access} />
            <ProjectPageStateForm projectId={project.id} policy={project.pageState} suggestions={querySuggestions} />
        </>
    );
}
