
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import { ProjectInstallGuide } from '@/src/components/app/projects/ProjectInstallGuide';
import { projectSettingsContext } from '../settingsContext';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Installation · Project settings") };
}

/** The install guide of the project, for everyone who can see it: the script, steps for common platforms and the installation check */
export default async function ProjectInstallationSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/installation'>) {
    const { projectId } = await params;
    const { context, project } = await projectSettingsContext(projectId);
    return <ProjectInstallGuide context={context} project={project} />;
}
