
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import { ProjectPeopleAndTeams } from '@/src/components/app/teams/ProjectAccess';
import { configurableProject } from '../settingsContext';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("People and teams · Project settings") };
}

/** The members and teams with access to the project (managed for the whole workspace on their own pages) */
export default async function ProjectPeopleSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/people'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    return <ProjectPeopleAndTeams context={context} project={project} />;
}
