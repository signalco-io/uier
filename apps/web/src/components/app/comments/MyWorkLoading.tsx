'use client';

import { useLayoutEffect, useReducer, useSyncExternalStore } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { parseCommentsView } from '@/src/lib/app/commentsViewPreference';
import { Bar, Loading } from '../loading/outlines';
import { PageHeader } from '../PageHeader';
import type { CommentsView } from './commentLabels';
import { CardSkeleton, RowSkeleton } from './CommentsLoading';
import { commentStatuses, StateDot } from './CommentStatus';
import { storedCommentsView } from './commentsView';

/**
 * My work's title, in the page's shell: it needs only the app's language, so it is there before the threads and stays
 * mounted when they arrive. On the board it is as wide as the columns, up to the panel's width less the gutters, as on
 * a project's board (the board, and its loading state, mark themselves with `data-header-wide`; the page sets
 * `--board-width`).
 */
export function MyWorkHeader() {
    const { t } = useAppI18n();
    return (
        <PageHeader title={t("My work")}
            className={cn('min-w-0',
                'group-has-[[data-header-wide=board]]/my-work:md:w-[min(var(--page-wide),max(100%,var(--board-width)))] group-has-[[data-header-wide=board]]/my-work:md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]')} />
    );
}

const subscribeNothing = () => () => {};
/** The view My work opens in (`MyWorkViews`): the address's, else the one last chosen for My work, else its lists */
const openingView = (): CommentsView => parseCommentsView(new URLSearchParams(window.location.search).get('view')) ?? storedCommentsView('my-work') ?? 'list';

const rowTitles = ['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2', 'w-3/5', 'w-2/3'];
/** The columns every board has: Ready to verify only where a project turns verification on */
const boardColumns = commentStatuses.filter(status => status !== 'ready');
const boardCards = [3, 2, 2];

/**
 * My work under its title while the threads load (docs/design/loading-states #5), in the view it will open in. Search,
 * Filter and List/Board are there only when something needs the person, so they are not drawn: their row is kept
 * free, and what comes under it stays where it is when they arrive. Then one list as the loaded lists are (its heading's
 * line, rows like the comments list's), or the board's columns every workflow has, as wide as the loaded board so the
 * title above is already where the board puts it. Nothing needing the person replaces all of it with the empty state.
 */
export function MyWorkLoading() {
    const view = useSyncExternalStore(subscribeNothing, openingView, () => 'list' as const);
    // A navigation renders this before the router writes the new address, which it does as this commits: read it
    // again then, before anything paints, so the page being left does not decide the view
    const [, recheck] = useReducer((count: number) => count + 1, 0);
    useLayoutEffect(() => {
        if (openingView() !== view) recheck();
        // Once, on mount: the address does not change under a mounted loading state without a new render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <Loading label="Loading my work" data-my-work-loading={view} data-header-wide={view === 'board' ? 'board' : undefined} className="flex flex-col gap-4">
            {/* The filters' row: as tall as its search, 44 px on a touch screen */}
            <div className="h-9 pointer-coarse:h-11" />
            {view === 'board' ? (
                // `CommentBoard`'s row of columns: 18rem to 20rem each, centred, to the panel's edges
                <div data-page-width="wide" style={{ gridTemplateColumns: `repeat(${boardColumns.length}, minmax(min(18rem, var(--page-wide) - 3rem), 20rem))` }}
                    className="grid items-start justify-center-safe gap-4 overflow-hidden py-1 page-bleed">
                    {boardColumns.map((status, column) => (
                        <div key={status} className="flex min-h-24 flex-col gap-2 rounded-2xl border bg-muted/50 p-2">
                            <span className="flex items-center px-2 pt-1"><span className="flex h-5 items-center gap-2"><StateDot status={status} /><Bar className="h-3.5 w-24" /></span></span>
                            {Array.from({ length: boardCards[column]! }, (_, card) => <CardSkeleton key={card} title={rowTitles[(column + card) % rowTitles.length]!} />)}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {/* A list's heading: its icon, its name and its count */}
                    <div className="flex h-6 items-center gap-2 px-1"><Bar className="size-4" /><Bar className="h-4 w-32" /></div>
                    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card p-1">
                        {rowTitles.map((width, row) => <RowSkeleton key={row} title={width} />)}
                    </div>
                </div>
            )}
        </Loading>
    );
}
