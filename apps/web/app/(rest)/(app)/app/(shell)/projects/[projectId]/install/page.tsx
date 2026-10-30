import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { appBaseUrl } from '@/src/lib/app/request';
import { InstallGuide } from '@/src/components/app/projects/InstallGuide';
import { OnboardingSteps } from '@/src/components/app/projects/OnboardingSteps';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { InviteReviewerStep } from '@/src/components/app/projects/InviteReviewerStep';
import { InstallationStatus } from '@/src/components/app/projects/InstallationStatus';

export const metadata: Metadata = {
    title: 'Install'
};

/** Onboarding, step 2 (`?onboarding=1`, right after creating the project), and the install guide of any project */
export default async function InstallProjectPage({ params, searchParams }: PageProps<'/app/projects/[projectId]/install'>) {
    const { projectId } = await params;
    const { onboarding } = await searchParams;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    // Comments from one of the project's addresses show the script works: the guide moves behind a button
    const lastCommentAt = onboarding === '1' ? undefined : (await loadProjectComments(context, project))
        .filter(comment => comment.source.available)
        .map(comment => comment.createdAt).filter(Boolean).sort().at(-1);

    const guide = (
        <InstallGuide
            baseUrl={await appBaseUrl()}
            projectId={project.id}
            publicId={project.publicId}
            urls={project.urls}
            reviewStep={(
                <div className="flex flex-wrap gap-2">
                    <ReviewLinksMenu projectId={project.id} urls={project.urls} />
                    <Button variant="ghost" asChild>
                        <Link href={KnownPageLinks.project(project.id)}>Go to the comments</Link>
                    </Button>
                </div>
            )} />
    );

    return (
        <div className="flex max-w-3xl flex-col gap-8">
            {onboarding === '1' && <OnboardingSteps current={2} />}
            {lastCommentAt ? <InstallationStatus lastCommentAt={lastCommentAt}>{guide}</InstallationStatus> : guide}
            {onboarding === '1' && (
                <InviteReviewerStep projectId={project.id} publicId={project.publicId} access={project.access} urls={project.urls} isAdmin={context.isAdmin} />
            )}
        </div>
    );
}
