'use client';
import { CommentGrouping } from './CommentGrouping';
import { selectedGroupLabels } from '../../../lib/app/projectCommentPaging';
import { labelLaneKey, labelLaneMatches } from '../../../lib/app/projectCommentPaging';
import { setBoardGroupingAction } from './actions';
import { LabelBoards } from './LabelBoards';

import { useAppI18n } from '@/src/lib/i18n/client';

import type { ThreadLabel } from '../../../lib/app/threadLabel';
import { defaultStatusWorkflow, statusForComment, orderedStatuses, type StatusWorkflow } from '../../../lib/app/statusWorkflow';
import { commentAssignees } from '@uier/toolbar/agents';
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition, type RefObject } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { CircleCheckIcon, CircleDashedIcon, MessageSquareDashedIcon, SearchXIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Toggle } from '@/src/components/ui/toggle';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { ProjectAccess } from '../../../lib/app/model';
import { projectAccessLabels } from '../projects/projectLabels';
import { KnownPageLinks } from '../../../knownPages';
import { InviteButton } from '../users/InviteDialog';
import type { AssigneeOption } from './CommentCard';
import { CommentFilters, countLineInHeader } from './CommentFilters';
import { pageMatches } from './pageFilter';
import { CommentInbox, useOpenComment } from './CommentInbox';
import { CommentBoard } from './CommentBoard';
import { boardStatusFilter, statusFilterLabels, statusMatches, type AuthorFilter, type StatusFilter } from './commentLabels';
import { commentStatus, commentStatuses, type CommentStatus } from './CommentStatus';
import { parseCommentsQuery, type CommentsQuery } from './commentsQuery';
import { rememberCommentsView, storedCommentsView } from './commentsView';
import { parseCommentsView } from '@/src/lib/app/commentsViewPreference';
import type { CommentsView } from './commentLabels';
import { orderComments, sortBoardColumn } from './commentOrder';
import type { BoardColumn, BoardSort } from '../../../lib/app/boardSort';
import { setBoardArchiveAction, setBoardSortAction } from './actions';
import { applyCommentUpdate, CommentUpdatesProvider, type CommentUpdate } from './CommentUpdates';
import { TriageSelection } from './TriageSelection';
import { matchesFeedbackSearch } from '@uier/toolbar/triage';
import { CommentsSearchNavigationProvider } from './CommentsSearchNavigation';
import { MarkAllRead } from './MarkAllRead';
import { RealtimeComments } from './RealtimeComments';
import { useProjectCommentPages } from './useProjectCommentPages';
import type { ProjectCommentPaging, CommentLane } from '@/src/lib/app/projectCommentPaging';


/** A status tab with nothing in it (All always has something once the other filters match) */
const emptyStatus: Record<StatusFilter, { title: string; description: string }> = {
    active: { title: 'Nothing active', description: 'Every comment here is done. Choose Done or All to see them.' },
    open: { title: 'Nothing open', description: 'Comments no one has started show here.' },
    'in-progress': { title: 'Nothing in progress', description: 'Comments someone is working on show here.' },
    ready: { title: 'No checks requested', description: 'Requested fix checks show here.' },
    done: { title: 'Nothing done yet', description: 'Comments marked as done show here.' },
    archived: { title: 'Nothing archived', description: 'Archived comments stay here until you restore them.' },
    all: { title: 'Nothing here', description: 'No comments match these filters.' }
};

/** `openId`: Only unread keeps the open thread while it is read (opening it reads it), until another is opened. My work filters with it too */
export function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string, openId?: string) {
    return comments.filter(comment => {
        if (query.label && !comment.labels?.some(label => label.id === query.label)) return false;
        if (query.priority && comment.priority !== query.priority) return false;
        if (!matchesFeedbackSearch({ path: comment.path, number: comment.number, context: comment.title ? [comment.title] : undefined, messages: [{ text: comment.text, quotedText: comment.quotedText, deleted: comment.deleted }, ...comment.replies] }, query.q ?? '')) return false;
        if (query.unread && !comment.activity?.unread && comment.id !== openId) return false;
        if (query.page && !pageMatches(query.page, comment.path))
            return false;
        if (query.people === 'assigned')
            return commentAssignees(comment).some(person => person.id === userId);
        if (query.people === 'unassigned')
            return !commentAssignees(comment).length;
        if (query.people === 'mine')
            return comment.author.isMe;
        return true;
    });
}

type ProjectCommentsProps = {
    labels?: ThreadLabel[];
    workflow?: StatusWorkflow;
    initialView?: CommentsView;
    revision: string;
    paging: ProjectCommentPaging;
    openedComment?: ProjectCommentView;
    /** Each board column's sort, saved on the project for everyone (`lib/app/boardSort.ts`) */
    boardSorts: Record<BoardColumn, BoardSort>;
    /** Whether the board's Archive column is expanded, saved on the project for everyone like the sorts */
    boardArchiveExpanded?: boolean;
    boardGroupByLabel?: boolean;
    boardGroupLabelIds?: string[];
    /** Whether this person may change them, the sorts and Archive (`canSortProjectBoard`) */
    canSortBoard: boolean;
    authorFilter?: AuthorFilter;
    environments: import('../../../lib/app/environments').EnvironmentOption[];
    projectId: string;
    access: ProjectAccess;
    isAdmin: boolean;
    comments: ProjectCommentView[];
    query: CommentsQuery;
    userId: string;
    assignees: AssigneeOption[];
    /** The install guide, offered while there are no comments */
    installHref: string;
};

/** The project's comments in a list (a status tab) or on a board (a column per status), filtered by people and page. */
export function ProjectComments({ labels = [], workflow = defaultStatusWorkflow, projectId, revision, access, isAdmin, comments: savedComments, query: serverQuery, userId, assignees, installHref, environments, authorFilter, boardSorts: savedSorts, boardArchiveExpanded: savedArchiveExpanded = false, boardGroupByLabel = false, boardGroupLabelIds, canSortBoard, initialView, paging: savedPaging, openedComment: savedOpenedComment }: ProjectCommentsProps) {
    const { t } = useAppI18n();
    // The presentation filters and the open thread change with the address at once, even while a
    // change waits for the server (`useUrlSearchParams`)
    const searchParams = useUrlSearchParams();
    const explicit = parseCommentsView(searchParams.get('view'));
    const [remembered, setRemembered] = useState(initialView);
    // With no cookie the server paints the list (never a loading state). An older localStorage-only choice then
    // switches once here and moves into the cookie. Keep the inbox's own state mounted through URL changes,
    // including optimistic writes that are still pending.
    useLayoutEffect(() => {
        if (explicit) return;
        const saved = storedCommentsView() ?? initialView;
        setRemembered(saved ?? 'list');
        if (saved) {
            rememberCommentsView(saved);
            setUrlSearchParams({ view: saved });
        }
    }, [explicit, initialView]);
    const containerRef = useRef<HTMLDivElement>(null);
    const openComment = useOpenComment(containerRef);
    useFirstColumnWidth(containerRef);
    // Environment and author navigate through authorization; presentation filters fetch fresh
    // summary pages while their URL controls update immediately.
    const urlKey = searchParams.toString();
    const urlQuery = parseCommentsQuery(Object.fromEntries(searchParams));
    const [searchDraft, setSearchDraft] = useState({ url: urlKey, value: urlQuery.q ?? '' });
    const search = searchDraft.url === urlKey ? searchDraft.value : urlQuery.q ?? '';
    const searchNeedsNormalization = searchParams.getAll('q').length > 1 || (searchParams.get('q') ?? '') !== (urlQuery.q ?? '');
    const query = { ...urlQuery, ...(workflow.verificationEnabled !== true && urlQuery.status === 'ready' ? { status: 'active' as const } : {}), view: explicit ?? remembered ?? 'list', q: search, environment: serverQuery.environment, author: serverQuery.author };
    useEffect(() => {
        if (search === (urlQuery.q ?? '') && !searchNeedsNormalization) return;
        const timer = window.setTimeout(() => setUrlSearchParams({ q: search || undefined }), 250);
        return () => window.clearTimeout(timer);
    }, [search, urlQuery.q, urlKey, searchNeedsNormalization]);
    const commitSearch = () => { setUrlSearchParams({ q: search || undefined }); };
    const clearFilters = () => {
        setSearchDraft({ url: urlKey, value: '' });
        setUrlSearchParams({ q: undefined, label: undefined, priority: undefined, status: undefined, people: undefined, page: undefined, unread: undefined }, { history: 'push' });
        document.getElementById('feedback-search')?.focus();
    };
    // A column's new sort shows at once, and goes back with an error if saving it fails
    const [boardSorts, showSort] = useOptimistic(savedSorts, (current, change: { status: BoardColumn; sort: BoardSort }) => ({ ...current, [change.status]: change.sort }));
    const [sorting, startSorting] = useTransition();
    const changeSort = (status: BoardColumn, sort: BoardSort) => startSorting(async () => {
        showSort({ status, sort });
        const result = await setBoardSortAction(projectId, status, sort)
            .catch(() => ({ ok: false as const, error: t("Could not save the sort. Try again.") }));
        if (result && !result.ok) toast.error(result.error);
    });
    // Archive expands and collapses at once. For the people who may sort the board it is saved on the project (and goes
    // back with an error if that fails); for everyone else it lasts until the page is opened again.
    const [savedArchive, showArchive] = useOptimistic(savedArchiveExpanded, (_current, expanded: boolean) => expanded);
    const [ownArchive, setOwnArchive] = useState<boolean>();
    const archiveExpanded = canSortBoard ? savedArchive : ownArchive ?? savedArchiveExpanded;
    const changeArchive = (expanded: boolean) => {
        if (!canSortBoard) return setOwnArchive(expanded);
        startSorting(async () => {
            showArchive(expanded);
            const result = await setBoardArchiveAction(projectId, expanded)
                .catch(() => ({ ok: false as const, error: t("Could not save the board. Try again.") }));
            if (result && !result.ok) toast.error(result.error);
        });
    };
    const groupIds = selectedGroupLabels({ boardGroupByLabel, boardGroupLabelIds }, labels);
    const groupedLabels = labels.filter(label => groupIds && groupIds.includes(label.id));
    const pager = useProjectCommentPages({ projectId, userId, comments: savedComments, revision, paging: savedPaging, openedComment: savedOpenedComment },
        { ...query, q: urlQuery.q }, boardSorts, archiveExpanded, workflow, openComment.openId, groupIds);
    const [optimisticComments, updateComment] = useOptimistic(pager.data.comments, (current, update: CommentUpdate) => current.map(comment => applyCommentUpdate(comment, update)));
    // Priority first (Urgent to Low), then number, highest first: the list, selection and keyboard follow this
    // order. The board's columns each follow the project's sort for them, by default this one in active columns
    // and the completion history in Done.
    const comments = orderComments(optimisticComments.map(comment => ({ ...comment, workflow })));
    const board = query.view === 'board' && query.status !== 'archived';
    // An open thread that is not loaded (deleted, or outside a new author or environment scope) is
    // closed, so it cannot reopen later when the scope changes back. The board has Archive as its last column.
    const openId = openComment.openId;
    const openScope = JSON.stringify([projectId, userId, query.environment, query.author, board, query.status === 'archived']);
    const listedScope = board ? comments : comments.filter(comment => Boolean(comment.archivedAt) === (query.status === 'archived'));
    const freshOpen = listedScope.find(comment => comment.id === openId) ?? (pager.data.openedComment?.id === openId ? pager.data.openedComment : undefined)
        ?? (savedOpenedComment?.id === openId ? savedOpenedComment : undefined);
    const [heldOpen, setHeldOpen] = useState<{ scope: string; key: string; comment: ProjectCommentView }>();
    const freshKey = freshOpen ? JSON.stringify(freshOpen) : undefined;
    if (freshOpen && (heldOpen?.scope !== openScope || heldOpen.key !== freshKey)) setHeldOpen({ scope: openScope, key: freshKey!, comment: freshOpen });
    const retained = freshOpen ?? (heldOpen?.scope === openScope && heldOpen.comment.id === openId ? { ...heldOpen.comment, summary: true } : undefined);
    const keepsOpen = retained && (board || Boolean(retained.archivedAt) === (query.status === 'archived'));
    const scopeComments = keepsOpen && !listedScope.some(comment => comment.id === retained.id) ? [...listedScope, retained] : listedScope;
    useEffect(() => {
        if (!openId || pager.loading || scopeComments.some(comment => comment.id === openId)) return;
        setUrlSearchParams({ comment: undefined });
    }, [openId, scopeComments, pager.loading]);
    const installText = query.environment === 'all'
        ? t("Set up reviews and open a review link to leave the first comment.")
        : t("This environment has no feedback. Choose another environment, or set up reviews and open a review link to leave the first comment.");
    const installButton = (className?: string) => (
        <Link href={installHref} className={cn(buttonVariants({ variant: 'outline' }), className)}>{t("Set up reviews")}</Link>
    );
    // Invited projects take two steps, each with its button: the script, then the people
    const steps = access === 'invited' && isAdmin;
    const emptyState = (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <MessageSquareDashedIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No comments yet")}</EmptyTitle>
                {!steps && (
                    <EmptyDescription>
                        {access === 'disabled' ? t("Comments are off. {value0}", { value0: t(projectAccessLabels.disabled.description) }) : installText}
                    </EmptyDescription>
                )}
            </EmptyHeader>
            {steps ? (
                <EmptyContent className="max-w-2xl">
                    <ol className="m-0 grid w-full list-none gap-3 p-0 sm:grid-cols-2">
                        {[
                            { text: installText, action: installButton('w-full') },
                            { text: t(projectAccessLabels.invited.description), action: <InviteButton projectId={projectId} className="w-full" /> }
                        ].map((step, index) => (
                            <li key={index} className="flex flex-col items-center gap-3 px-2">
                                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium tabular-nums">{index + 1}</span>
                                <p className="m-0 text-muted-foreground">{step.text}</p>
                                <div className="mt-auto w-full">{step.action}</div>
                            </li>
                        ))}
                    </ol>
                </EmptyContent>
            ) : (
                <EmptyContent>
                    {/* One column: the buttons take the width of the widest */}
                    <div className="grid gap-2">
                        {access === 'disabled' && isAdmin && (
                            <Link href={KnownPageLinks.projectSettings(projectId, 'review')} className={buttonVariants({ variant: 'outline' })}>{t("Settings")}</Link>
                        )}
                        {installButton()}
                    </div>
                </EmptyContent>
            )}
        </Empty>
    );

    const pages = pager.data.paging.pages;
    const historySources = query.environment === 'all' ? pager.data.paging.historySources : undefined;
    // Search is evaluated on the complete thread on the server; summaries omit replies.
    const filtered = applyFilters(comments, { ...query, q: undefined }, userId, openId);
    const delta = (matches: (comment: ProjectCommentView) => boolean) => filtered.filter(matches).length - pager.data.comments.filter(matches).length;
    const statusCounts = Object.fromEntries((Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => [filter,
        Math.max(0, pager.data.paging.statusCounts[filter] + delta(comment => statusMatches(filter, commentStatus(comment), comment.archivedAt)))])) as Record<StatusFilter, number>;
    const statusUnread = Object.fromEntries((Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => [filter,
        pager.data.paging.statusUnread[filter] + delta(comment => Boolean(comment.activity?.unread) && statusMatches(filter, commentStatus(comment), comment.archivedAt)) > 0]));
    const totalFor = (lane: CommentLane) => lane === 'list' && !board ? statusCounts[query.status]
        : Math.max(0, (pager.data.paging.lanes[lane]?.total ?? 0) + delta(comment => { const [status, label] = lane.split('~'); return statusForComment(workflow, comment).id === status && (!label || labelLaneMatches(comment.labels, label, groupIds || undefined)); }));
    const inLabelWindow = (comment: ProjectCommentView, group?: string) => {
        if (!group) return true;
        if (!labelLaneMatches(comment.labels, group, groupIds || undefined)) return false;
        const status = statusForComment(workflow, comment).id;
        const original = pager.data.comments.find(row => row.id === comment.id);
        return Boolean(pager.data.paging.lanes[labelLaneKey(status, group)]?.ids.includes(comment.id))
            || Boolean(original && statusForComment(workflow, original).id !== status);
    };
    const pageControl = (lane: CommentLane) => ({ total: totalFor(lane), hasMore: Boolean(pager.data.paging.lanes[lane]?.nextCursor),
        loading: pager.loading || pager.loadingLanes.has(lane), error: Boolean(pager.error) || pager.failedLanes.has(lane), loadMore: () => { if (pager.error) pager.retry(); else void pager.loadMore(lane); } });
    const budgetExceeded = pager.error === 'budget' || pager.data.paging.queryTooExpensive;
    const populated = pager.data.paging.scopeTotal > 0 || Boolean(budgetExceeded);
    // Where the open thread takes the whole width, it takes the filters' place too
    const threadOnly = Boolean(openComment.openId) && !board && scopeComments.some(comment => comment.id === openComment.openId);
    // The board's status filter (uier #335) narrows its columns to one; the others stay, empty, as drop targets
    const boardStatus = board ? boardStatusFilter(query.status) : undefined;
    const shown = board ? filtered.filter(comment => !comment.archivedAt && (!boardStatus || commentStatus(comment) === boardStatus)) : filtered.filter(comment => statusMatches(query.status, commentStatus(comment), comment.archivedAt));
    // The board's columns, one per status in order (each thread in exactly one), each in the project's sort for it
    const columns = Object.fromEntries(commentStatuses.map(status => [status,
        sortBoardColumn(shown.filter(comment => commentStatus(comment) === status), boardSorts[status])])) as Record<CommentStatus, ProjectCommentView[]>;
    // The board's last column, in the project's sort for it: by default like Done but by when each was archived
    // (`compareArchivedOrder`), ties in the list's order
    const archived = board && !boardStatus ? sortBoardColumn(filtered.filter(comment => comment.archivedAt), boardSorts.archive) : [];
    // What the board shows: its columns, and Archive's cards while it is expanded
    const boardShown = [...commentStatuses.flatMap(status => columns[status]), ...(archiveExpanded ? archived : [])];
    // Nothing to show: the board still shows its columns while only Archive has threads
    const nothingShown = board ? !shown.length && !statusCounts.archived : !shown.length;
    // What the header takes the width of: the list with its thread beside it, or the board (see below)
    // Search and live updates must not recenter the controls when their result becomes empty.
    const headerWide = !populated ? undefined : board ? 'board' : 'list';
    // The header's width, which the count line under it takes too (uier #187): the panel's width less the gutters, list
    // and board alike, with no cap or centring (uier #363)
    const wideClassName = headerWide && 'page-wide';
    // The search is as wide as the first column under it, the list beside its thread or the board's first column, so
    // The empty states take it too, their own `w-full` set aside: it comes after `page-wide` in the CSS and would keep
    // them the column's width, shifted left (uier #383)
    const emptyWideClassName = headerWide && 'w-(--page-wide) page-wide';
    // their edges line up (uier #355; `--first-column`, measured by `useFirstColumnWidth`). Narrower, where the list
    // takes the whole width, it keeps its own width
    const searchClassName = cn(headerWide === 'list' && '@3xl/comments:[--search-width:var(--first-column,20rem)]',
        headerWide === 'board' && 'md:[--search-width:var(--first-column,20rem)]');
    const unreadShown = Math.max(0, pager.data.paging.unreadCount + delta(comment => Boolean(comment.activity?.unread)
        && (board ? comment.archivedAt ? archiveExpanded && !boardStatus : !boardStatus || commentStatus(comment) === boardStatus
            : statusMatches(query.status, commentStatus(comment), comment.archivedAt))));
    // Keep the open composer mounted while page windows revalidate. Selection resets per scope.
    // Only the unread count: the list's status tabs and the board's columns already count what is shown
    // The count toggles Only unread (uier #193), like the toolbar's Unread toggle; while the filter is on it stays,
    // at 0 too, so it can be turned off where it was turned on
    const unreadSummary = (unreadShown > 0 || query.unread) && (
        <Toggle size="sm" pressed={Boolean(query.unread)} aria-label={t("{value0} unread, show only unread", { value0: unreadShown })}
            onPressedChange={pressed => setUrlSearchParams({ q: search || undefined, unread: pressed ? 'true' : undefined }, { history: 'push' })}
            className={cn('-mx-1.5 px-1.5 font-normal tabular-nums pointer-coarse:min-h-11', unreadShown > 0 ? 'text-[hsl(var(--brand-accent-text))] hover:text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>
            {t("{count} unread", { count: unreadShown })}
        </Toggle>
    );
    const unreadActions = unreadShown > 0 && <MarkAllRead projectId={projectId} shownOnly={unreadShown > (board ? boardShown : shown).filter(comment => comment.activity?.unread).length} threads={(board ? boardShown : shown).flatMap(comment => comment.activity?.unread ? [{ id: comment.id, sequence: comment.activity.sequence }] : [])} />;
    const selectionScope = JSON.stringify([projectId, userId, query.environment, query.author, query.unread, query.people, query.page, query.status, query.q, query.priority, query.label, query.view]);
    return (
        <CommentUpdatesProvider value={updateComment}>
        <RealtimeComments projectId={projectId} revision={revision} environment={serverQuery.environment} author={serverQuery.author} />
        <CommentsSearchNavigationProvider value={commitSearch}>
        {/* The filter rows, the count line and the comments share one spacing: the gap between search and the status tabs.
            The header (search, Filter, the view toggle, the status tabs) is as wide as what is under it, the panel's width
            less the gutters (`page-wide`): the list with its thread beside it (CommentInbox), or the board, whose columns
            start at its left edge (uier #363). It never scrolls with the board. The project header above takes the same
            width from `data-header-wide` (the project layout), and so does the count line under it. */}
        <div ref={containerRef} data-page-width={populated ? 'wide' : undefined} aria-busy={pager.loading || undefined}
            // The board's columns start at the left, under the search (uier #363); My work's board keeps its own
            className="@container/comments flex flex-col gap-2 [&_[data-board-scroll]]:justify-start">
            <div data-header-wide={headerWide} className={cn('flex min-w-0 flex-col gap-2', threadOnly && '@max-3xl/comments:hidden', wideClassName, searchClassName)}>
            <CommentFilters grouping={<CommentGrouping labels={labels} selected={groupIds || []} disabled={!canSortBoard || sorting} onChange={ids => startSorting(async () => {
                    const result = await setBoardGroupingAction(projectId, ids.length > 0, ids).catch(() => ({ ok: false as const, error: t("Could not save the board. Try again.") }));
                    if (result && !result.ok) toast.error(result.error);
                })} />} verificationEnabled={workflow.verificationEnabled === true} labels={labels} label={query.label} search={search} onSearch={value => setSearchDraft({ url: urlKey, value })} priority={query.priority} author={authorFilter} environment={query.environment} environments={environments} historySources={historySources} unread={Boolean(query.unread)} unreadCount={pager.data.paging.unreadCount} view={board ? 'board' : 'list'} status={query.status} statusCounts={pager.data.paging.queryTooExpensive ? undefined : statusCounts} statusUnread={statusUnread} people={query.people} page={query.page} pages={pages}
                countLine={populated ? { summary: unreadSummary, actions: unreadActions } : undefined} />
            {(pager.error || budgetExceeded) && <p role="status" className="m-0 text-sm text-muted-foreground">
                {budgetExceeded ? t('This search is too large. Narrow the environment or author and try again.') : t('Comments could not be refreshed. Your loaded comments are still shown.')}
                <Button variant="ghost" onClick={pager.retry}>{t('Try again')}</Button>
            </p>}
            </div>
            <TriageSelection projectId={projectId} scope={selectionScope} shown={board ? boardShown : shown} assignees={assignees}
                barClassName={cn(threadOnly && '@max-3xl/comments:hidden', !populated && 'hidden')}
                // With room (uier #300) the count line is in the search row, left of Filter (`CommentFilters`): this row
                // only shows, keeping its height through read/unread changes, where the header is narrower than that
                lineClassName={cn(wideClassName, populated && countLineInHeader)}
                reserveLine={populated}
                summary={unreadSummary}
                actions={unreadActions}>
            {pager.data.paging.queryTooExpensive ? null : !populated ? emptyState : pager.data.paging.matchedTotal + delta(() => true) === 0 ? (
                <Empty className={cn('border', emptyWideClassName)}>
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <SearchXIcon />
                        </EmptyMedia>
                        <EmptyTitle>{t("Nothing here")}</EmptyTitle>
                        <EmptyDescription>{t("No comments match these filters.")}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent><Button variant="outline" className="pointer-coarse:min-h-11" onClick={clearFilters}>{t("Clear filters")}</Button></EmptyContent>
                </Empty>
            ) : nothingShown ? (
                <Empty className={cn('border', emptyWideClassName)}>
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            {query.status === 'active' ? <CircleCheckIcon /> : <CircleDashedIcon />}
                        </EmptyMedia>
                        <EmptyTitle>{t(emptyStatus[query.status].title)}</EmptyTitle>
                        <EmptyDescription>{t(emptyStatus[query.status].description)}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : board ? (
                <LabelBoards grouped={boardGroupByLabel} labels={groupedLabels} renderBoard={group => <CommentBoard workflow={workflow} projectOf={() => ({ id: projectId, assignees })} columns={Object.fromEntries(Object.entries(columns).map(([status, cards]) => [status, cards.filter(comment => inLabelWindow(comment, group))])) as typeof columns} sorts={boardSorts} onSort={canSortBoard ? changeSort : undefined}
                    archiveAll={canSortBoard ? { projectId, group, params: Object.fromEntries(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])) } : undefined}
                    archive={{ comments: archived.filter(comment => inLabelWindow(comment, group)), expanded: archiveExpanded, onExpandedChange: changeArchive }}
                    allComments={scopeComments} userId={userId} openComment={openComment}
                    detailRevision={pager.data.revision} paging={Object.fromEntries(orderedStatuses(workflow).map(status => [status.id, pageControl(group ? labelLaneKey(status.id, group) : status.id)]))} />} />
            ) : (
                <CommentInbox groupLabels={boardGroupByLabel ? groupedLabels : undefined} projectId={projectId} comments={shown} allComments={scopeComments} assignees={assignees} userId={userId} label={t("Comments")}
                    keeps={status => statusMatches(query.status, status, query.status === 'archived' ? 'archived' : undefined)} readLeaves={Boolean(query.unread)} openComment={openComment} detailRevision={pager.data.revision} paging={pageControl('list')} />
            )}
            </TriageSelection>
        </div>
        </CommentsSearchNavigationProvider>
        </CommentUpdatesProvider>
    );
}

/**
 * Keeps `--first-column` on the comments' container at the width of the first column under the filters: the board's
 * first column, or the list's (beside its thread). The search takes it (uier #355). Columns mount and unmount with
 * the view and the filters, so the container's own resizes and changes below it look for the column again.
 */
function useFirstColumnWidth(containerRef: RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let column: Element | null = null;
        const measure = () => {
            const width = column?.getBoundingClientRect().width;
            if (width) container.style.setProperty('--first-column', `${Math.round(width)}px`);
            else container.style.removeProperty('--first-column');
        };
        const columns = new ResizeObserver(measure);
        const find = () => {
            const next = container.querySelector('[data-board-scroll] > section') ?? container.querySelector('[data-comment-id]')?.closest('ul') ?? null;
            if (next !== column) {
                if (column) columns.unobserve(column);
                column = next;
                if (column) columns.observe(column);
            }
            measure();
        };
        // Once a frame at most: rows mount and unmount as the lists scroll
        let frame = 0;
        const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; find(); }); };
        const resizes = new ResizeObserver(schedule);
        resizes.observe(container);
        const changes = new MutationObserver(schedule);
        changes.observe(container, { childList: true, subtree: true });
        find();
        return () => { cancelAnimationFrame(frame); resizes.disconnect(); columns.disconnect(); changes.disconnect(); };
    }, [containerRef]);
}
