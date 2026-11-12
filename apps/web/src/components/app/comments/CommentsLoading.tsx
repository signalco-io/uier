'use client';

import { useSyncExternalStore } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Skeleton } from '@/src/components/ui/skeleton';
import { parseCommentsView } from '@/src/lib/app/commentsViewPreference';
import type { CommentsView } from './commentLabels';
import { storedCommentsView } from './commentsView';

const subscribeNothing = () => () => {};

/** The view a project's comments will open in: the address's, else the remembered one, else the list */
function loadingView(): CommentsView {
    return parseCommentsView(new URLSearchParams(window.location.search).get('view')) ?? storedCommentsView() ?? 'list';
}

/**
 * The list's and its header's width, as `ProjectComments` and `CommentInbox` set it once loaded: the panel's width less
 * the gutters, capped at 96rem, where the comments are at least 48rem wide
 */
const listWide = '@3xl/comments:w-[min(var(--page-wide),96rem)] @3xl/comments:mx-[calc((100%-min(var(--page-wide),96rem))/2)]';
/** The board's header width, as `ProjectComments` sets it: its columns' (`--board-width`, the project layout's) up to the panel's */
const boardWide = 'md:w-[min(var(--page-wide),max(100%,var(--board-width)))] md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]';

/** A row of the inbox list (`CommentRow`): the author's avatar, the title line and the meta line */
function RowSkeleton({ title }: { title: string }) {
    return (
        <div className="flex gap-2.5 px-3 py-2.5">
            <div className="grid flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
                <span className="flex h-5 items-center gap-2"><span className="w-2" /><Skeleton className="size-5 animate-none rounded-full" /></span>
                <span className="flex h-5 items-center gap-2"><Skeleton className={cn('h-3.5 animate-none', title)} /><Skeleton className="ml-auto h-3 w-12 animate-none" /></span>
                <span />
                <span className="flex h-5 items-center gap-2"><Skeleton className="h-3 w-40 max-w-[60%] animate-none" /><Skeleton className="ml-auto h-3 w-14 animate-none" /></span>
            </div>
        </div>
    );
}

/** A board card (`CommentRow` as a card): a two-line title and the meta line */
function CardSkeleton({ title }: { title: string }) {
    return (
        <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 dark:bg-background">
            <span className="flex items-center gap-2"><Skeleton className="size-5 animate-none rounded-full" /><Skeleton className={cn('h-3.5 animate-none', title)} /></span>
            <Skeleton className="ml-7 h-3.5 w-1/2 animate-none" />
            <Skeleton className="ml-7 h-3 w-2/3 animate-none" />
        </div>
    );
}

const rowTitles = ['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2', 'w-3/5', 'w-2/3'];

/**
 * A project's comments while they load (uier #344): shaped and as wide as the loaded page, in the view it will open in
 * (the address's, else the one remembered in this browser; the server, which cannot know, draws the list). The search
 * row (search, in the list the status tabs, Filter, List/Board), the count line's room where it has its own row, then
 * the list with the thread beside it on wide screens, or the board's columns with Archive's strip. Its
 * `data-header-wide` gives the project header above the same width, as the loaded comments do.
 */
export function CommentsLoading({ title = 'Loading project' }: { title?: string }) {
    const { t } = useAppI18n();
    const view = useSyncExternalStore(subscribeNothing, loadingView, () => 'list' as const);
    const board = view === 'board';
    return (
        <div role="status" aria-label={t(title)} data-page-width="wide" className="@container/comments flex flex-col gap-2">
            <span className="sr-only">{t(title)}…</span>
            <div data-header-wide={view} className={cn('flex min-w-0 flex-col gap-2', board ? boardWide : listWide)}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Skeleton className="h-8 min-w-0 flex-1 animate-none rounded-lg sm:max-w-80 sm:min-w-48 pointer-coarse:h-11" />
                    {!board && <Skeleton className="order-last h-8 basis-full animate-none rounded-lg sm:order-none sm:w-60 sm:basis-auto pointer-coarse:h-11" />}
                    <Skeleton className="ml-auto h-8 w-20 animate-none rounded-lg pointer-coarse:h-11" />
                    <Skeleton className="h-8 w-16 animate-none rounded-lg pointer-coarse:h-11" />
                </div>
            </div>
            {/* The count line's own row, where it is not in the search row (`countLineInHeader`) */}
            <div aria-hidden="true" className="min-h-8 pointer-coarse:min-h-11 @4xl/comments:hidden" />
            {board ? (
                // The default workflow's columns as `CommentBoard` lays them out, then Archive's collapsed strip
                <div style={{ gridTemplateColumns: 'repeat(4, minmax(min(18rem, var(--page-wide) - 3rem), 20rem)) 3rem' }}
                    className="grid items-start justify-center-safe gap-4 overflow-hidden py-1 page-bleed">
                    {[3, 2, 1, 4].map((cards, column) => (
                        <div key={column} className="flex flex-col gap-2 rounded-2xl border bg-muted/50 p-2">
                            <span className="flex items-center gap-2 px-2 pt-1 pb-0.5"><Skeleton className="h-4 w-24 animate-none" /><Skeleton className="ml-auto size-4 animate-none" /></span>
                            {Array.from({ length: cards }, (_, card) => <CardSkeleton key={card} title={rowTitles[(column + card) % rowTitles.length]!} />)}
                        </div>
                    ))}
                    <div className="h-28 rounded-2xl border bg-muted/50" />
                </div>
            ) : (
                <div className={cn('grid grid-cols-1 items-start gap-4 @3xl/comments:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)] @4xl/comments:grid-cols-[minmax(17rem,clamp(22rem,30%,28rem))_minmax(0,1fr)]', listWide)}>
                    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card p-1">
                        {rowTitles.map((width, row) => <RowSkeleton key={row} title={width} />)}
                    </div>
                    {/* The first thread, shown beside the list where there is room */}
                    <div className="hidden min-w-0 flex-col gap-4 rounded-xl border px-4 py-3 @3xl/comments:flex">
                        <span className="flex items-center gap-2"><Skeleton className="h-6 w-20 animate-none rounded-full" /><Skeleton className="h-4 w-10 animate-none" /><Skeleton className="ml-auto size-6 animate-none" /></span>
                        <Skeleton className="h-5 w-2/3 animate-none" />
                        <span className="flex items-center gap-2"><Skeleton className="size-6 animate-none rounded-full" /><Skeleton className="h-4 w-32 animate-none" /></span>
                        <Skeleton className="h-4 w-full animate-none" />
                        <Skeleton className="h-4 w-5/6 animate-none" />
                        <Skeleton className="h-24 w-full animate-none rounded-lg" />
                    </div>
                </div>
            )}
        </div>
    );
}
