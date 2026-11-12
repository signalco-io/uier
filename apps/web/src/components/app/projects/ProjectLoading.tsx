'use client';

import { cn } from '@/src/lib/utils';
import { Skeleton } from '@/src/components/ui/skeleton';
import { CommentsLoading } from '../comments/CommentsLoading';

/**
 * A project while its layout loads (uier #344): its header (favicon, name, who can comment, Open review) and tabs over
 * its comments' skeleton (`CommentsLoading`, the first tab's), as wide as the loaded page. The header takes the
 * comments' width from their `data-header-wide` like the project layout's, with the default workflow's board width
 * (four 20rem columns and Archive's 3rem strip) while the board's real columns are not known yet.
 */
export function ProjectLoading() {
    return (
        <div className="group/project @container/project flex flex-col [--board-width:calc(4*20rem+4rem+3rem)]">
            <div aria-hidden="true" className={cn('flex min-w-0 flex-col gap-4 pb-6',
                'group-has-[[data-header-wide=list]]/project:@3xl/project:w-[min(var(--page-wide),96rem)] group-has-[[data-header-wide=list]]/project:@3xl/project:mx-[calc((100%-min(var(--page-wide),96rem))/2)]',
                'group-has-[[data-header-wide=board]]/project:md:w-[min(var(--page-wide),max(100%,var(--board-width)))] group-has-[[data-header-wide=board]]/project:md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]')}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 basis-80 items-center gap-4">
                        <Skeleton className="size-14 shrink-0 animate-none rounded-xl" />
                        <div className="flex min-w-0 flex-col gap-1">
                            <Skeleton className="my-1 h-[26px] w-56 max-w-full animate-none" />
                            <Skeleton className="h-4 w-36 animate-none" />
                        </div>
                    </div>
                    <Skeleton className="h-8 w-32 animate-none rounded-lg" />
                </div>
                {/* The tabs, over the line that runs to the inset panel's edges (`ProjectTabs`) */}
                <div className="relative flex h-9 items-center gap-6 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border before:shadow-[0_0_0_100vmax_hsl(var(--border))] before:[clip-path:inset(0_-100vmax)]">
                    <Skeleton className="h-4 w-20 animate-none" />
                    <Skeleton className="h-4 w-24 animate-none" />
                    <Skeleton className="ml-auto size-4 animate-none" />
                </div>
            </div>
            <div className="flex flex-col gap-6">
                <CommentsLoading />
            </div>
        </div>
    );
}
