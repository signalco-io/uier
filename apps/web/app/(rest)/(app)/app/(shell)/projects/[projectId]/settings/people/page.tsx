import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProjectPeopleAndTeams } from '@/src/components/app/teams/ProjectAccess';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'People and teams · Project settings'
};

/** The members and teams with access to the project (managed for the whole workspace on their own pages) */
async function ProjectPeopleSettingsPageContent({ params }: PageProps<'/app/projects/[projectId]/settings/people'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    return <ProjectPeopleAndTeams context={context} project={project} />;
}

export default function ProjectPeopleSettingsPage(props: Parameters<typeof ProjectPeopleSettingsPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading people" />}><ProjectPeopleSettingsPageContent {...props} /></Suspense>;
}
