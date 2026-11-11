import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProjectInstallGuide } from '@/src/components/app/projects/ProjectInstallGuide';
import { projectSettingsContext } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Installation · Project settings'
};

/** The install guide of the project, for everyone who can see it: the script, steps for common platforms and the installation check */
async function ProjectInstallationSettingsPageContent({ params }: PageProps<'/app/projects/[projectId]/settings/installation'>) {
    const { projectId } = await params;
    const { context, project } = await projectSettingsContext(projectId);
    return <ProjectInstallGuide context={context} project={project} />;
}

export default function ProjectInstallationSettingsPage(props: Parameters<typeof ProjectInstallationSettingsPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading installation" />}><ProjectInstallationSettingsPageContent {...props} /></Suspense>;
}
