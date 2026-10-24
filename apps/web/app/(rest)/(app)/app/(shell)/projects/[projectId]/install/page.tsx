import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
import { PageHeader } from '@/src/components/app/PageHeader';
import { InstallGuide } from '@/src/components/app/projects/InstallGuide';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';

export const metadata: Metadata = {
    title: 'Install'
};

/** Onboarding, step 2 (and the install guide of any project) */
export default async function InstallProjectPage({ params }: PageProps<'/app/projects/[projectId]/install'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    return (
        <div className="max-w-3xl">
            <PageHeader
                title={`Install uier on ${project.name}`}
                description="Step 2 of 2. Add one script tag to your site, then open a review link." />
            <div className="flex flex-col gap-8">
                <InstallGuide baseUrl={await appBaseUrl()} projectId={project.id} />
                <div className="flex flex-col gap-3">
                    <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">3. Open a review link</h2>
                    <p className="m-0 text-sm text-muted-foreground">
                        Once the script is live, a review link opens your site with the toolbar.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} />
                        <Button href={KnownPageLinks.project(project.id)} variant="plain">Go to the project</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
