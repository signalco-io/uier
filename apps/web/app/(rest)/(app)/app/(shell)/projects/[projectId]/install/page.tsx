import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { appBaseUrl } from '@/src/lib/app/request';
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
        <div className="flex max-w-3xl flex-col gap-8">
            <InstallGuide
                baseUrl={await appBaseUrl()}
                projectId={project.id}
                urls={project.urls}
                reviewStep={(
                    <div className="flex flex-wrap gap-2">
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} />
                        <Button variant="ghost" asChild>
                            <Link href={KnownPageLinks.project(project.id)}>Go to the comments</Link>
                        </Button>
                    </div>
                )} />
        </div>
    );
}
