import type { Metadata } from 'next';
import { loadQueryFieldSuggestions } from '@/src/lib/app/pageStateSuggestions';
import { ProjectReviewForm } from '@/src/components/app/projects/ProjectSettingsForms';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Review · Project settings'
};

/** Who can comment, what reviewers are asked to review and, under Advanced, which page state their comments keep */
export default async function ProjectReviewSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/review'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);
    const querySuggestions = await loadQueryFieldSuggestions(project);

    return (
        <ProjectReviewForm projectId={project.id} access={project.access} brief={project.brief} policy={project.pageState} suggestions={querySuggestions} />
    );
}
