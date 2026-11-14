'use client';

import { useLayoutEffect, useReducer, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDownIcon, KanbanIcon, ListFilterIcon, ListIcon, SearchIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import { Skeleton } from '@/src/components/ui/skeleton';
import { parseCommentsView } from '@/src/lib/app/commentsViewPreference';
import { isActiveStatusFilter, isDoneStatusFilter, statusFilterLabels, type CommentsView, type StatusFilter } from './commentLabels';
import { storedCommentsView } from './commentsView';
import { searchBesideList, segmentedGroup, segmentedItem } from './CommentsViewToggle';

const subscribeNothing = () => () => {};

/** The address's status filter, as `parseCommentsQuery` reads it: Active without one */
function addressStatus(params: URLSearchParams): StatusFilter {
    const status = params.get('status');
    return status && Object.hasOwn(statusFilterLabels, status) ? status as StatusFilter : 'active';
}

/**
 * The view a project's comments will open in: the address's, else the remembered one, else the list. Archive is
 * always a list (`ProjectComments`' rule: the board has Archive as its last column instead), Board chosen or not.
 */
function openingView(params: URLSearchParams, remembered: CommentsView | undefined): CommentsView {
    if (params.get('status') === 'archived') return 'list';
    return parseCommentsView(params.get('view')) ?? remembered ?? 'list';
}

/** This browser's guess before the request answers (`ProjectCommentsLoading`): its address and remembered view */
const guessedView = () => openingView(new URLSearchParams(window.location.search), storedCommentsView());
const guessedStatus = () => addressStatus(new URLSearchParams(window.location.search));

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
 * The search row as `CommentFilters` draws it, drawn for real but inert (uier #362): nothing in it needs the comments.
 * Search and Filter (uier #393); in the list the status tabs (Active, Done, All, the address's pressed, their counts
 * still loading); List/Board with the opening view pressed.
 */
function FiltersPlaceholder({ view, status }: { view: CommentsView; status: StatusFilter }) {
    const { t } = useAppI18n();
    const activeShown = isActiveStatusFilter(status), doneShown = isDoneStatusFilter(status);
    const tabs = [
        { value: 'active', label: activeShown && status !== 'active' ? `${t(statusFilterLabels.active)}: ${t(statusFilterLabels[status])}` : t(statusFilterLabels.active), pressed: activeShown, menu: true },
        { value: 'done', label: t(statusFilterLabels[doneShown ? status : 'done']), pressed: doneShown, menu: true },
        { value: 'all', label: t(statusFilterLabels.all), pressed: status === 'all', menu: false }
    ];
    return (
        <div inert aria-hidden="true" className="flex min-w-0 flex-wrap items-center gap-2">
            <div data-search-field="" className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-[var(--search-width,26rem)] sm:min-w-64">
                <InputGroup className="min-w-0 flex-1 pointer-coarse:min-h-11">
                    <InputGroupAddon><SearchIcon /></InputGroupAddon>
                    <InputGroupInput type="search" tabIndex={-1} readOnly placeholder={t("Search feedback")} className="pointer-coarse:min-h-11" />
                </InputGroup>
                <Button variant="outline" tabIndex={-1} className="shrink-0 pointer-coarse:min-h-11">
                    <ListFilterIcon data-icon="inline-start" />
                    {t("Filter")}
                </Button>
            </div>
            {view === 'list' && (
                <div className="order-last -mx-1 -my-0.5 max-w-[calc(100%+0.5rem)] basis-[calc(100%+0.5rem)] overflow-x-hidden px-1 py-0.5 sm:order-none sm:shrink-0 sm:basis-auto">
                    <div className={cn('flex w-max min-w-full items-center sm:min-w-0', segmentedGroup)}>
                        {tabs.map(tab => (
                            <span key={tab.value} className="contents">
                                <span data-pressed={tab.pressed ? '' : undefined} className={cn('inline-flex items-center justify-center gap-1 text-sm font-medium whitespace-nowrap grow sm:grow-0', segmentedItem)}>
                                    {tab.label} <Skeleton className="h-3 w-4 animate-none" />
                                </span>
                                {tab.menu && <Button variant="ghost" size="icon-xs" tabIndex={-1} className={cn(segmentedItem, '-ml-0.5 w-6 min-w-6 px-0 pointer-coarse:min-w-8')}><ChevronDownIcon /></Button>}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            <div className={cn('ml-auto flex shrink-0 items-center', segmentedGroup)}>
                {([['list', ListIcon], ['board', KanbanIcon]] as const).map(([value, Icon]) => (
                    <span key={value} data-pressed={view === value ? '' : undefined}
                        className={cn('inline-flex items-center justify-center px-0 pointer-coarse:min-h-[38px] pointer-coarse:min-w-11', segmentedItem)}>
                        <Icon className="size-4" />
                    </span>
                ))}
            </div>
        </div>
    );
}

/**
 * A project's comments while they load (uier #344): shaped and as wide as the loaded page (the panel's width less the
 * gutters, `page-wide`, uier #363), in the view it will open in. The search row is drawn for real, inert
 * (`FiltersPlaceholder`, uier #362); then the count line's room where it has its own row, then the list with the thread
 * beside it on wide screens, or the board's columns with Archive's strip, from the left. Its `data-header-wide` gives
 * the project header above the same width, as the loaded comments do.
 */
function CommentsSkeleton({ title, view, status }: { title: string; view: CommentsView; status: StatusFilter }) {
    const { t } = useAppI18n();
    const board = view === 'board';
    return (
        <div role="status" aria-label={t(title)} data-page-width="wide" data-comments-loading={view} className="@container/comments flex flex-col gap-2">
            <span className="sr-only">{t(title)}…</span>
            {/* The search as wide as the first column under it, as `ProjectComments` measures it (uier #355): the list's
                track beside its thread, or a board column */}
            <div data-header-wide={view} className={cn('flex min-w-0 flex-col gap-2 page-wide', board ? 'md:[--search-width:20rem]'
                : cn('@3xl/comments:[--search-width:18rem] @4xl/comments:[--search-width:max(17rem,clamp(22rem,30%,28rem))]', searchBesideList))}>
                <FiltersPlaceholder view={view} status={status} />
            </div>
            {/* The count line's own row, where it is not in the search row (`countLineInHeader`) */}
            <div aria-hidden="true" className="min-h-8 pointer-coarse:min-h-11 @4xl/comments:hidden" />
            {board ? (
                // The default workflow's columns as `CommentBoard` lays them out, then Archive's collapsed strip
                <div style={{ gridTemplateColumns: 'repeat(4, minmax(min(18rem, var(--page-wide) - 3rem), 20rem)) 3rem' }}
                    className="grid items-start justify-start gap-4 overflow-hidden py-1 page-bleed">
                    {[3, 2, 1, 4].map((cards, column) => (
                        <div key={column} className="flex flex-col gap-2 rounded-2xl border bg-muted/50 p-2">
                            <span className="flex items-center gap-2 px-2 pt-1 pb-0.5"><Skeleton className="h-4 w-24 animate-none" /><Skeleton className="ml-auto size-4 animate-none" /></span>
                            {Array.from({ length: cards }, (_, card) => <CardSkeleton key={card} title={rowTitles[(column + card) % rowTitles.length]!} />)}
                        </div>
                    ))}
                    <div className="h-28 rounded-2xl border bg-muted/50" />
                </div>
            ) : (
                <div className="grid grid-cols-1 items-start gap-4 page-wide @3xl/comments:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)] @4xl/comments:grid-cols-[minmax(17rem,clamp(22rem,30%,28rem))_minmax(0,1fr)]">
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

/**
 * The comments' skeleton before the request answers: in the prefetched shell and the first bytes of a full load. It
 * guesses the view from this browser's address and remembered view; the server, which cannot know, draws the list.
 * `ProjectCommentsLoading` replaces it with `AddressCommentsLoading` as soon as the request's cookie is read.
 */
export function CommentsLoading({ title = 'Loading project' }: { title?: string }) {
    const view = useSyncExternalStore(subscribeNothing, guessedView, () => 'list' as const);
    const status = useSyncExternalStore(subscribeNothing, guessedStatus, () => 'active' as const);
    // A navigation renders this before the router writes the new address, which it does as the skeleton commits:
    // read it again then, before the skeleton paints, so `?view=board` is not drawn as the page being left
    const [, recheck] = useReducer((count: number) => count + 1, 0);
    useLayoutEffect(() => {
        if (guessedView() !== view || guessedStatus() !== status) recheck();
        // Once, on mount: the address does not change under a mounted skeleton without a new render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <CommentsSkeleton title={title} view={view} status={status} />;
}

/**
 * The comments' skeleton in the view they will open in (uier #362): the address the router is going to (its `view`,
 * `?view=board` too, and its `status`), else the view remembered in the request's cookie, else the list. Only under a
 * request-scoped boundary (`ProjectCommentsLoading`), so it never enters the prefetched shell.
 */
export function AddressCommentsLoading({ title = 'Loading project', remembered }: { title?: string; remembered: CommentsView | undefined }) {
    const params = useSearchParams();
    const search = new URLSearchParams(params.toString());
    return <CommentsSkeleton title={title} view={openingView(search, remembered)} status={addressStatus(search)} />;
}
