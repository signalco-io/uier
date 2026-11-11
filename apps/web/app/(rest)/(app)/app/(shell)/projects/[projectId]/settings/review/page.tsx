
import { getAppI18n } from '@/src/lib/i18n/server';
import { workspaceFeedbackTypes } from '@/src/lib/app/feedbackTypes';
import type { Metadata } from 'next';
import { loadQueryFieldSuggestions } from '@/src/lib/app/pageStateSuggestions';
import { ProjectReviewForm } from '@/src/components/app/projects/ProjectReviewForm';
import { GuestReviewLinks } from '@/src/components/app/projects/GuestReviewLinks';
import { configurableProject } from '../settingsContext';
import { projectToolbarLanguageMode, workspaceToolbarLanguage } from '@/src/lib/app/toolbarLanguage';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Review · Project settings") };
}

/** Who can comment (with the guest links while anyone with the link can), the toolbar's language, what reviewers are asked to review and, under Advanced, which page state their comments keep */
export default async function ProjectReviewSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/review'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    const querySuggestions = await loadQueryFieldSuggestions(project);

    return (
        <ProjectReviewForm toolbarFeatures={project.toolbarFeatures} workspaceTypes={workspaceFeedbackTypes(context.workspace)}
            toolbarLanguage={projectToolbarLanguageMode(project)} workspaceToolbarLanguage={workspaceToolbarLanguage(context.workspace)} feedbackTypes={project.feedbackTypes} projectId={project.id} access={project.access} brief={project.brief} policy={project.pageState} suggestions={querySuggestions}
            // The header's access label leads here, so the guest links from its popover are here too
            guestLinks={project.access === 'guests' && project.urls[0] ? <GuestReviewLinks publicId={project.publicId} urls={project.urls} /> : undefined} />
    );
}
