'use client';
import { CommentGrouping } from './CommentGrouping';
import { compareReviewGroups, selectedGroupLabels } from '../../../lib/app/projectCommentPaging';
import { labelLaneKey, labelLaneMatches } from '../../../lib/app/projectCommentPaging';
import { setBoardGroupingAction } from './actions';
import { LabelBoards } from './LabelBoards';

import { useAppI18n } from '@/src/lib/i18n/client';

import type { ThreadLabel } from '../../../lib/app/threadLabel';
import { defaultStatusWorkflow, statusForComment, orderedStatuses, type StatusWorkflow } from '../../../lib/app/statusWorkflow';
import { commentAssignees } from '@uier/toolbar/agents';
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from 'react';
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
import { usePublishSidebarCommentSummary } from '../shell/ShellInfo';
import type { SidebarCommentSummary } from '@/src/lib/app/sidebarProjects';
import type { AssigneeOption } from './CommentCard';
import { CommentFilters, countLineInHeader } from './CommentFilters';
import { filtersDivider } from './CommentsViewToggle';
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
import { setBoardSortAction } from './actions';
import { BoardSortMenu } from './BoardSortMenu';
import { CommentUpdatesProvider } from './CommentUpdates';
import { useConfirmedBoardSettings } from './useConfirmedBoardSettings';
import { useOptimisticCommentUpdates } from './useOptimisticCommentUpdates';
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
    all: { title: 'Nothing here', description: 'No comments match these filters.' }
};

/** `openId`: Only unread keeps the open thread while it is read (opening it reads it), until another is opened. My work filters with it too */
export function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string, openId?: string) {
    return comments.filter(comment => {
        if (query.label && !comment.labels?.some(label => label.id === query.label)) return false;
        if (query.reviewSessionId && comment.reviewSession?.id !== query.reviewSessionId) return false;
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
    collapsedColumns?: string[];
    revision: string;
    sidebarSummary?: SidebarCommentSummary;
    paging: ProjectCommentPaging;
    openedComment?: ProjectCommentView;
    /** Each board column's sort, saved on the project for everyone (`lib/app/boardSort.ts`) */
    boardSorts: Record<BoardColumn, BoardSort>;
    boardGroupByLabel?: boolean;
    boardGroupLabelIds?: string[];
    /** Whether this person may change them, the sorts and grouping (`canSortProjectBoard`) */
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
export function ProjectComments(props: ProjectCommentsProps) {
    const [fresh, setFresh] = useState<{ source: ProjectCommentsProps; snapshot: Partial<ProjectCommentsProps> }>();
    const current = fresh?.source === props ? { ...props, ...fresh.snapshot } : props;
    const { projectId, userId, sidebarSummary } = current;
    const publish = usePublishSidebarCommentSummary();
    useEffect(() => {
        if (sidebarSummary) publish?.(projectId, userId, sidebarSummary);
    }, [publish, projectId, userId, sidebarSummary]);
    return <ProjectCommentsView {...current}
        onSnapshot={snapshot => setFresh({ source: props, snapshot })} />;
}

function ProjectCommentsView({ labels = [], workflow = defaultStatusWorkflow, projectId, revision, access, isAdmin, comments: savedComments, query: serverQuery, userId, assignees, installHref, environments, authorFilter, boardSorts: savedSorts, boardGroupByLabel = false, boardGroupLabelIds, canSortBoard, initialView, collapsedColumns, paging: savedPaging, openedComment: savedOpenedComment, onSnapshot }: ProjectCommentsProps & { onSnapshot: (snapshot: Partial<ProjectCommentsProps>) => void }) {
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
    // Environment and author navigate through authorization; presentation filters fetch fresh
    // summary pages while their URL controls update immediately.
    const urlKey = searchParams.toString();
    const urlQuery = parseCommentsQuery(Object.fromEntries(searchParams));
    const [searchDraft, setSearchDraft] = useState({ url: urlKey, value: urlQuery.q ?? '' });
    const search = searchDraft.url === urlKey ? searchDraft.value : urlQuery.q ?? '';
    const searchNeedsNormalization = searchParams.getAll('q').length > 1 || (searchParams.get('q') ?? '') !== (urlQuery.q ?? '');
    const query = { ...urlQuery, ...(workflow.verificationEnabled !== true && urlQuery.status === 'ready' ? { status: urlQuery.archive ? 'all' as const : 'active' as const } : {}), view: explicit ?? remembered ?? 'list', q: search, environment: serverQuery.environment, author: serverQuery.author };
    useEffect(() => {
        if (search === (urlQuery.q ?? '') && !searchNeedsNormalization) return;
        const timer = window.setTimeout(() => setUrlSearchParams({ q: search || undefined }), 250);
        return () => window.clearTimeout(timer);
    }, [search, urlQuery.q, urlKey, searchNeedsNormalization]);
    const commitSearch = () => { setUrlSearchParams({ q: search || undefined }); };
    const clearFilters = () => {
        setSearchDraft({ url: urlKey, value: '' });
        setUrlSearchParams({ q: undefined, label: undefined, reviewSessionId: undefined, priority: undefined, status: undefined, archive: query.archive, people: undefined, page: undefined, unread: undefined }, { history: 'push' });
        document.getElementById('feedback-search')?.focus();
    };
    const [{ groupIds: confirmedGroups, ...confirmedSorts }, confirmBoardSettings] = useConfirmedBoardSettings(
        { ...savedSorts, groupIds: selectedGroupLabels({ boardGroupByLabel, boardGroupLabelIds }, labels) },
        `${projectId}:${userId}`);
    // A column's new sort shows at once, and goes back with an error if saving it fails
    const [boardSorts, showSort] = useOptimistic(confirmedSorts, (current, change: { status: BoardColumn; sort: BoardSort }) => ({ ...current, [change.status]: change.sort }));
    const [sorting, startSorting] = useTransition();
    const changeSort = (status: BoardColumn, sort: BoardSort) => startSorting(async () => {
        showSort({ status, sort });
        const result = await setBoardSortAction(projectId, status, sort)
            .catch(() => ({ ok: false as const, error: t("Could not save the sort. Try again.") }));
        if (result && !result.ok) toast.error(result.error);
        else if (result?.ok) confirmBoardSettings({ [status]: sort });
    });
    const [groupIds, showGrouping] = useOptimistic(confirmedGroups, (_current, ids: string[]): false | string[] =>
        ids.length ? labels.filter(label => ids.includes(label.id)).map(label => label.id) : false);
    const groupedLabels = labels.filter(label => groupIds && groupIds.includes(label.id));
    const pager = useProjectCommentPages({ projectId, userId, comments: savedComments, revision, paging: savedPaging, openedComment: savedOpenedComment },
        { ...query, q: urlQuery.q }, boardSorts, workflow, openComment.openId, groupIds, onSnapshot);
    const [optimisticComments, updateComment] = useOptimisticCommentUpdates(pager.data.comments,
        JSON.stringify([projectId, userId, query.environment, query.author]));
    // Priority first (Urgent to Low), then number, highest first: the list, selection and keyboard follow this
    // order. The board's columns each follow the project's sort for them, by default this one in active columns
    // and the completion history in Done.
    const archived = query.archive === 'only';
    const inArchive = (comment: ProjectCommentView) => Boolean(comment.archivedAt) === archived;
    const withWorkflow = optimisticComments.map(comment => ({ ...comment, workflow }));
    const comments = archived ? sortBoardColumn(withWorkflow, boardSorts.archive) : orderComments(withWorkflow);
    const board = query.view === 'board' && !archived;
    // An open thread that is not loaded (deleted, or outside a new author or environment scope) is
    // closed, so it cannot reopen later when the scope changes back. A board sheet stays open through archive or restore.
    const openId = openComment.openId;
    const openScope = JSON.stringify([projectId, userId, query.environment, query.author, board, archived]);
    const listedScope = board ? comments : comments.filter(inArchive);
    const freshOpen = listedScope.find(comment => comment.id === openId) ?? (pager.data.openedComment?.id === openId ? pager.data.openedComment : undefined)
        ?? (savedOpenedComment?.id === openId ? savedOpenedComment : undefined);
    const [heldOpen, setHeldOpen] = useState<{ scope: string; key: string; comment: ProjectCommentView }>();
    const freshKey = freshOpen ? JSON.stringify(freshOpen) : undefined;
    if (freshOpen && (heldOpen?.scope !== openScope || heldOpen.key !== freshKey)) setHeldOpen({ scope: openScope, key: freshKey!, comment: freshOpen });
    const retained = freshOpen ?? (heldOpen?.scope === openScope && heldOpen.comment.id === openId ? { ...heldOpen.comment, summary: true } : undefined);
    const keepsOpen = retained && (board || inArchive(retained));
    const scopeComments = keepsOpen && !listedScope.some(comment => comment.id === retained.id) ? [...listedScope, retained] : listedScope;
    useEffect(() => {
        if (!openId || pager.loading || scopeComments.some(comment => comment.id === openId
            && (board || statusMatches(query.status, commentStatus(comment))))) return;
        setUrlSearchParams({ comment: undefined });
    }, [openId, scopeComments, pager.loading, board, query.status]);
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
        Math.max(0, pager.data.paging.statusCounts[filter] + delta(comment => inArchive(comment) && statusMatches(filter, commentStatus(comment))))])) as Record<StatusFilter, number>;
    const statusUnread = Object.fromEntries((Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => [filter,
        pager.data.paging.statusUnread[filter] + delta(comment => Boolean(comment.activity?.unread) && inArchive(comment) && statusMatches(filter, commentStatus(comment))) > 0]));
    const archiveCount = Math.max(0, pager.data.paging.archiveCount + delta(comment => Boolean(comment.archivedAt)));
    const archiveUnread = pager.data.paging.archiveUnread + delta(comment => Boolean(comment.archivedAt && comment.activity?.unread)) > 0;
    const inLane = (lane: CommentLane, comment: ProjectCommentView) => { const [status, label] = lane.split('~'); return !comment.archivedAt && statusForComment(workflow, comment).id === status && (!label || labelLaneMatches(comment.labels, label, groupIds || undefined)); };
    const totalFor = (lane: CommentLane) => lane === 'list' && !board ? statusCounts[query.status]
        : Math.max(0, (pager.data.paging.lanes[lane]?.total ?? 0) + delta(comment => inLane(lane, comment)));
    // The threads with a local change the snapshot doesn't show yet, as saved and as shown: a background refresh
    // marks only the lanes they leave and enter (uier #442); the others keep their cards without progress
    const changed = optimisticComments.flatMap((shown, index) => shown === pager.data.comments[index] ? [] : [pager.data.comments[index]!, shown]);
    const laneLoading = (lane: CommentLane) => pager.loadingLanes.has(lane)
        || pager.loading && (!pager.quietRefresh || changed.some(comment => lane === 'list' || inLane(lane, comment)));
    const inLabelWindow = (comment: ProjectCommentView, group?: string) => {
        if (!group) return true;
        if (!labelLaneMatches(comment.labels, group, groupIds || undefined)) return false;
        const status = statusForComment(workflow, comment).id;
        const original = pager.data.comments.find(row => row.id === comment.id);
        return Boolean(pager.data.paging.lanes[labelLaneKey(status, group)]?.ids.includes(comment.id))
            || Boolean(original && statusForComment(workflow, original).id !== status);
    };
    const pageControl = (lane: CommentLane) => ({ total: totalFor(lane), hasMore: Boolean(pager.data.paging.lanes[lane]?.nextCursor),
        loading: laneLoading(lane), error: Boolean(pager.error) || pager.failedLanes.has(lane), loadMore: () => { if (pager.error) pager.retry(); else void pager.loadMore(lane); } });
    const budgetExceeded = pager.error === 'budget' || pager.data.paging.queryTooExpensive;
    const populated = pager.data.paging.scopeTotal > 0 || Boolean(budgetExceeded);
    // The board's status filter (uier #335) narrows its columns to one; the others stay, empty, as drop targets
    const boardStatus = board ? boardStatusFilter(query.status) : undefined;
    const shown = filtered.filter(comment => inArchive(comment) && (board ? !boardStatus || commentStatus(comment) === boardStatus : statusMatches(query.status, commentStatus(comment))));
    const groupedByReview = !board && query.groupBy === 'reviewSession';
    if (groupedByReview) shown.sort((a, b) => compareReviewGroups(a.reviewSession?.id, b.reviewSession?.id));
    const reviewGroups = pager.data.paging.reviewGroups ?? [];
    // Hide filters on narrow screens only while the opened thread is actually shown.
    // A status change can remove it from the current list while the scope still retains it.
    const threadOnly = !board && shown.some(comment => comment.id === openComment.openId);
    // The board's columns, one per status in order (each thread in exactly one), each in the project's sort for it
    const columns = Object.fromEntries(commentStatuses.map(status => [status,
        sortBoardColumn(shown.filter(comment => commentStatus(comment) === status), boardSorts[status])])) as Record<CommentStatus, ProjectCommentView[]>;
    // What the header takes the width of: the list with its thread beside it, or the board (see below)
    // Search and live updates must not recenter the controls when their result becomes empty.
    const headerWide = !populated ? undefined : board ? 'board' : 'list';
    // The header's width, which the count line under it takes too (uier #187): the panel's width less the gutters, list
    // and board alike, with no cap or centring (uier #363)
    const wideClassName = headerWide && 'page-wide';
    // The empty states take it too, their own `w-full` set aside: it comes after `page-wide` in the CSS and would keep
    // them the column's width, shifted left (uier #383)
    const emptyWideClassName = headerWide && 'w-(--page-wide) page-wide';
    const unreadShown = Math.max(0, pager.data.paging.unreadCount + delta(comment => Boolean(comment.activity?.unread)
        && inArchive(comment) && (board ? !boardStatus || commentStatus(comment) === boardStatus : statusMatches(query.status, commentStatus(comment)))));
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
    const inOrder = board ? commentStatuses.flatMap(status => columns[status]) : shown;
    const unreadActions = unreadShown > 0 && <MarkAllRead projectId={projectId} shownOnly={unreadShown > inOrder.filter(comment => comment.activity?.unread).length} threads={inOrder.flatMap(comment => comment.activity?.unread ? [{ id: comment.id, sequence: comment.activity.sequence }] : [])} />;
    const selectionScope = JSON.stringify([projectId, userId, query.environment, query.author, query.unread, query.people, query.page, query.status, query.archive, query.q, query.priority, query.label, query.view, query.reviewSessionId, query.groupBy]);
    const empty = archived && query.status === 'all'
        ? { title: 'Nothing archived', description: 'Archived comments stay here until you restore them.' }
        : archived ? emptyStatus.all : emptyStatus[query.status];
    return (
        <CommentUpdatesProvider value={updateComment}>
        <RealtimeComments projectId={projectId} revision={pager.data.revision} pending={pager.loading} onRefresh={pager.refresh} environment={serverQuery.environment} author={serverQuery.author} />
        <span role="status" aria-live="polite" className="sr-only">{pager.announcing ? t("Loading comments") : ''}</span>
        <CommentsSearchNavigationProvider value={commitSearch}>
        {/* The filter rows, the count line and the comments share one spacing: the gap between search and the status tabs.
            The header (search, Filter, the view toggle, the status tabs) is as wide as what is under it, the panel's width
            less the gutters (`page-wide`): the list with its thread beside it (CommentInbox), or the board, whose columns
            start at its left edge (uier #363). It never scrolls with the board. The project header above takes the same
            width from `data-header-wide` (the project layout), and so does the count line under it. */}
        <div ref={containerRef} data-project-comments="" data-page-width={populated ? 'wide' : undefined} aria-busy={pager.loading || undefined}
            // The board's columns start at the left, under the search (uier #363); My work's board keeps its own
            className="@container/comments flex flex-col gap-2 [&_[data-board-scroll]]:justify-start">
            <div data-header-wide={headerWide} className={cn('flex min-w-0 flex-col gap-2', threadOnly && '@max-3xl/comments:hidden', wideClassName)}>
            {/* Group by only shows once the project has labels to group on (uier #429); without them it leaves no gap */}
            <CommentFilters className={filtersDivider} archive={{ pressed: archived, count: budgetExceeded ? undefined : archiveCount, unread: archiveUnread,
                sort: archived && canSortBoard ? <BoardSortMenu label={t('Archive')} status="archive" sort={boardSorts.archive} onChange={sort => changeSort('archive', sort)} className="mx-0 after:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11" /> : undefined }}
                reviewGroups={reviewGroups} reviewSessionId={query.reviewSessionId}
                grouping={(labels.length > 0 || reviewGroups.length > 0 || groupedByReview) && <CommentGrouping
                    labels={labels} selected={groupedByReview ? [] : groupIds || []} disabled={!canSortBoard || sorting}
                    review={groupedByReview} onReviewChange={reviewGroups.length || groupedByReview ? enabled => setUrlSearchParams({
                        groupBy: enabled ? 'reviewSession' : undefined, ...(enabled ? { view: 'list' } : {})
                    }, { history: 'push' }) : undefined} onChange={ids => startSorting(async () => {
                    if (groupedByReview) setUrlSearchParams({ groupBy: undefined }, { history: 'push' });
                    showGrouping(ids);
                    const result = await setBoardGroupingAction(projectId, ids.length > 0, ids).catch(() => ({ ok: false as const, error: t("Could not save the board. Try again.") }));
                    if (result && !result.ok) toast.error(result.error);
                    else if (result?.ok) confirmBoardSettings({ groupIds: ids.length ? labels.filter(label => ids.includes(label.id)).map(label => label.id) : false });
                })} />} verificationEnabled={workflow.verificationEnabled === true} labels={labels} label={query.label} search={search} onSearch={value => setSearchDraft({ url: urlKey, value })} priority={query.priority} author={authorFilter} environment={query.environment} environments={environments} historySources={historySources} unread={Boolean(query.unread)} unreadCount={pager.data.paging.unreadCount} view={board ? 'board' : 'list'} status={query.status} statusCounts={pager.data.paging.queryTooExpensive ? undefined : statusCounts} statusUnread={statusUnread} people={query.people} page={query.page} pages={pages}
                countLine={populated ? { summary: unreadSummary, actions: unreadActions } : undefined} />
            {(pager.error || budgetExceeded) && <p role="status" className="m-0 text-sm text-muted-foreground">
                {budgetExceeded ? t('This search is too large. Narrow the environment or author and try again.') : t('Comments could not be refreshed. Your loaded comments are still shown.')}
                <Button variant="ghost" onClick={pager.retry}>{t('Try again')}</Button>
            </p>}
            </div>
            <TriageSelection projectId={projectId} scope={selectionScope} shown={inOrder} assignees={assignees}
                barClassName={cn(threadOnly && '@max-3xl/comments:hidden', !populated && 'hidden')}
                // With room (uier #300) the count line is in the search row, left of Filter (`CommentFilters`): this row
                // only shows, keeping its height through read/unread changes, where the header is narrower than that
                lineClassName={cn(wideClassName, populated && countLineInHeader)}
                reserveLine={populated}
                summary={unreadSummary}
                actions={unreadActions}>
            {pager.data.paging.queryTooExpensive ? null : !populated && !archived ? emptyState : populated && pager.data.paging.matchedTotal + delta(() => true) === 0 ? (
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
            ) : !board && !shown.length ? (
                <Empty className={cn('border', emptyWideClassName)}>
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            {query.status === 'active' ? <CircleCheckIcon /> : <CircleDashedIcon />}
                        </EmptyMedia>
                        <EmptyTitle>{t(empty.title)}</EmptyTitle>
                        <EmptyDescription>{t(empty.description)}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : board ? (
                <LabelBoards grouped={groupIds !== false} labels={groupedLabels} renderBoard={group => <CommentBoard workflow={workflow} projectOf={() => ({ id: projectId, assignees })} columns={Object.fromEntries(Object.entries(columns).map(([status, cards]) => [status, cards.filter(comment => inLabelWindow(comment, group))])) as typeof columns} sorts={boardSorts} onSort={canSortBoard ? changeSort : undefined}
                    archiveAll={canSortBoard ? { projectId, group, params: Object.fromEntries(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])) } : undefined}
                    collapseScope={projectId}
                    initialCollapsed={collapsedColumns}
                    allComments={scopeComments} userId={userId} openComment={openComment}
                    detailRevision={pager.data.revision} paging={Object.fromEntries(orderedStatuses(workflow).filter(status => status.category !== 'archive').map(status => [status.id, pageControl(group ? labelLaneKey(status.id, group) : status.id)]))} />} />
            ) : (
                <CommentInbox groupLabels={!groupedByReview && groupIds !== false ? groupedLabels : undefined}
                    reviewGroups={groupedByReview ? reviewGroups : undefined} projectId={projectId} comments={shown} allComments={scopeComments} assignees={assignees} userId={userId} label={t("Comments")}
                    keeps={status => statusMatches(query.status, status)} readLeaves={Boolean(query.unread)} openComment={openComment} detailRevision={pager.data.revision} paging={pageControl('list')} />
            )}
            </TriageSelection>
        </div>
        </CommentsSearchNavigationProvider>
        </CommentUpdatesProvider>
    );
}
