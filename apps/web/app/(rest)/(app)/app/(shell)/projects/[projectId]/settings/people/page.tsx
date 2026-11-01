import type { Metadata } from 'next';
import { ProjectPeopleAndTeams } from '@/src/components/app/teams/ProjectAccess';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'People and teams · Project settings'
};

/** The members and teams with access to the project (managed for the whole workspace on their own pages) */
export default async function ProjectPeopleSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/people'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    return <ProjectPeopleAndTeams context={context} project={project} />;
}
