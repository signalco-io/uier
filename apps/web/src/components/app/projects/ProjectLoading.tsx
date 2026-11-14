import { Skeleton } from '@/src/components/ui/skeleton';
import { PageLoading } from '../PageLoading';
import { CommentsSection } from '../comments/CommentsSection';
import { ProjectCommentsLoading } from '../comments/ProjectCommentsLoading';
import { PageChecksLoading } from '../pageChecks/PageChecksLoading';
import { ProjectLoadingPage, ProjectLoadingTabs } from './ProjectLoadingShell';

/**
 * A project while its layout loads (uier #344): the layout's own frame with the static shell drawn for real and
 * skeletons only where data goes (uier #439). The header is the project's (favicon, name, who can comment; Open review
 * is in the shell's top bar), so it is a skeleton of the loaded header's height. The tabs every project has are the
 * real tabs (`ProjectLoadingTabs`). Under them the loading state of the page being opened (`ProjectLoadingPage`): the
 * comments in their region, the page checks, or the other pages' own. As wide as the loaded page: on the comments and
 * the page checks the header is the panel's width less the gutters (`page-wide`, uier #363), like the project layout's.
 */
export function ProjectLoading() {
    return (
        <div className="group/project flex flex-col [--project-tabs:2.5rem]">
            {/* `PageHeader`'s geometry: the 56 px favicon beside the title's 34 px line and a one-line description */}
            <div aria-hidden="true" className="flex min-w-0 flex-col pb-4 group-has-[[data-header-wide]]/project:page-wide">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="size-14 shrink-0 animate-none rounded-xl" />
                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex h-[34px] items-center"><Skeleton className="h-[26px] w-56 max-w-full animate-none" /></span>
                        <span className="flex h-5 items-center"><Skeleton className="h-4 w-36 animate-none" /></span>
                    </div>
                </div>
            </div>
            <ProjectLoadingTabs />
            <div className="flex flex-col gap-6 pt-6">
                <ProjectLoadingPage
                    comments={<CommentsSection><ProjectCommentsLoading /></CommentsSection>}
                    pageChecks={<PageChecksLoading />}
                    other={<PageLoading />} />
            </div>
        </div>
    );
}
