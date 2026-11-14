import { Skeleton } from '@/src/components/ui/skeleton';
import { ProjectCommentsLoading } from '../comments/ProjectCommentsLoading';

/**
 * A project while its layout loads (uier #344): its header (favicon, name, who can comment; Open review is in the shell's top bar) and tabs over
 * its comments' skeleton (`ProjectCommentsLoading`, the first tab's), as wide as the loaded page. On the comments the
 * header is the panel's width less the gutters (`page-wide`, uier #363), like the project layout's.
 */
export function ProjectLoading() {
    return (
        <div className="group/project flex flex-col">
            <div aria-hidden="true" className="flex min-w-0 flex-col gap-4 pb-6 group-has-[[data-header-wide]]/project:page-wide">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="size-14 shrink-0 animate-none rounded-xl" />
                    <div className="flex min-w-0 flex-col gap-1">
                        <Skeleton className="my-1 h-[26px] w-56 max-w-full animate-none" />
                        <Skeleton className="h-4 w-36 animate-none" />
                    </div>
                </div>
                {/* The tabs, over the line that runs to the inset panel's edges (`ProjectTabs`) */}
                <div className="relative flex h-9 items-center gap-6 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border before:shadow-[0_0_0_100vmax_hsl(var(--border))] before:[clip-path:inset(0_-100vmax)]">
                    <Skeleton className="h-4 w-20 animate-none" />
                    <Skeleton className="h-4 w-24 animate-none" />
                    <Skeleton className="ml-auto size-4 animate-none" />
                </div>
            </div>
            <div className="flex flex-col gap-6">
                <ProjectCommentsLoading />
            </div>
        </div>
    );
}
