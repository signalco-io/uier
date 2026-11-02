import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPageLinks } from '@/src/knownPages';
import type { AppContext } from '@/src/lib/app/context';
import type { PublicProject } from '@/src/lib/app/projectPublicIds';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { appBaseUrl } from '@/src/lib/app/request';
import { InstallGuide } from './InstallGuide';
import { InstallationStatus } from './InstallationStatus';
import { ReviewLinksMenu } from './ReviewLinksMenu';

/**
 * A project's install guide (Settings → Installation, and the onboarding's second step). Comments from one
 * of the project's addresses show recent activity, not installation proof. The guide folds outside onboarding.
 */
export async function ProjectInstallGuide({ context, project, onboarding = false }: { context: AppContext; project: PublicProject; onboarding?: boolean }) {
    const lastCommentAt = onboarding ? undefined : (await loadProjectComments(context, project))
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
                    <Link href={KnownPageLinks.project(project.id)} className={buttonVariants({ variant: 'ghost' })}>Go to the comments</Link>
                </div>
            )} />
    );

    return lastCommentAt ? <InstallationStatus lastCommentAt={lastCommentAt}>{guide}</InstallationStatus> : guide;
}
