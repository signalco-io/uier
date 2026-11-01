import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { OnboardingSteps } from '@/src/components/app/projects/OnboardingSteps';
import { InviteReviewerStep } from '@/src/components/app/projects/InviteReviewerStep';
import { ProjectInstallGuide } from '@/src/components/app/projects/ProjectInstallGuide';

export const metadata: Metadata = {
    title: 'Install'
};

/**
 * Onboarding, step 2 (`?onboarding=1`, right after creating the project). Without it, this is the old
 * address of the install guide (the toolbar still links here): it moved to Settings → Installation.
 */
export default async function InstallProjectPage({ params, searchParams }: PageProps<'/app/projects/[projectId]/install'>) {
    const { projectId } = await params;
    const { onboarding } = await searchParams;
    if (onboarding !== '1')
        redirect(KnownPageLinks.projectInstall(projectId));
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    return (
        <div className="flex max-w-3xl flex-col gap-8">
            <OnboardingSteps current={2} />
            <ProjectInstallGuide context={context} project={project} onboarding />
            <InviteReviewerStep projectId={project.id} publicId={project.publicId} access={project.access} urls={project.urls} isAdmin={context.isAdmin} />
        </div>
    );
}
