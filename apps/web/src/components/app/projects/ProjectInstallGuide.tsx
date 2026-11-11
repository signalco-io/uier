
import { getAppI18n } from '@/src/lib/i18n/server';
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
 * A project's install guide (Settings → Installation; onboarding shows its parts one step at a time).
 * Comments from one of the project's addresses show recent activity, not installation proof, and fold the guide.
 */
export async function ProjectInstallGuide({ context, project }: { context: AppContext; project: PublicProject }) {
    const { t } = await getAppI18n();
    const lastCommentAt = (await loadProjectComments(context, project))
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
                    <Link href={KnownPageLinks.project(project.id)} className={buttonVariants({ variant: 'ghost' })}>{t("Go to the comments")}</Link>
                </div>
            )} />
    );

    return lastCommentAt ? <InstallationStatus lastCommentAt={lastCommentAt}>{guide}</InstallationStatus> : guide;
}
