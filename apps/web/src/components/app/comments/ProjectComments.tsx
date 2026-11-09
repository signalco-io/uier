'use client';

import { commentAssignees } from '@uier/toolbar/agents';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
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
import { CommentFilters } from './CommentFilters';
import { pageMatches } from './pageFilter';
import { CommentInbox, useOpenComment } from './CommentInbox';
import { CommentBoard } from './CommentBoard';
import { statusFilterLabels, statusMatches, type AuthorFilter, type StatusFilter } from './commentLabels';
import { commentStatus, commentStatuses, type CommentStatus } from './CommentStatus';
import { parseCommentsQuery, type CommentsQuery } from './commentsQuery';
import { orderComments, sortBoardColumn } from './commentOrder';
import type { BoardSort } from '../../../lib/app/boardSort';
import { setBoardSortAction } from './actions';
import { CommentUpdatesProvider, type CommentUpdate } from './CommentUpdates';
import { TriageSelection } from './TriageSelection';
import { matchesFeedbackSearch } from '@uier/toolbar/triage';
import { CommentsSearchNavigationProvider } from './CommentsSearchNavigation';
import { MarkAllRead } from './MarkAllRead';
import { RealtimeComments } from './RealtimeComments';


/** A status tab with nothing in it (All always has something once the other filters match) */
const emptyStatus: Record<StatusFilter, { title: string; description: string }> = {
    active: { title: 'Nothing active', description: 'Every comment here is done. Choose Done or All to see them.' },
    open: { title: 'Nothing open', description: 'Comments no one has started show here.' },
    'in-progress': { title: 'Nothing in progress', description: 'Comments someone is working on show here.' },
    ready: { title: 'No checks requested', description: 'Requested fix checks show here.' },
    done: { title: 'Nothing done yet', description: 'Comments marked as done show here.' },
    all: { title: 'Nothing here', description: 'No comments match these filters.' }
};

/** `openId`: Only unread keeps the open thread while it is read (opening it reads it), until another is opened */
function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string, openId?: string) {
    return comments.filter(comment => {
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

/** The project's comments in a list (a status tab) or on a board (a column per status), filtered by people and page */
export function ProjectComments({ projectId, revision, access, isAdmin, comments: savedComments, query: serverQuery, userId, assignees, installHref, environments, authorFilter, searchWindowCapped = false, boardSorts: savedSorts, canSortBoard }: {
    revision: string;
    searchWindowCapped?: boolean;
    /** Each board column's sort, saved on the project for everyone (`lib/app/boardSort.ts`) */
    boardSorts: Record<CommentStatus, BoardSort>;
    /** Whether this person may change them (`canSortProjectBoard`) */
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
}) {
    // The presentation filters and the open thread change with the address at once, even while a
    // change waits for the server (`useUrlSearchParams`)
    const searchParams = useUrlSearchParams();
    const containerRef = useRef<HTMLDivElement>(null);
    const openComment = useOpenComment(containerRef);
    // Environment and author are authorized server scopes. Presentation filters only use
    // the already authorized snapshot and never need another database round trip.
    const urlKey = searchParams.toString();
    const urlQuery = parseCommentsQuery(Object.fromEntries(searchParams));
    const [searchDraft, setSearchDraft] = useState({ url: urlKey, value: urlQuery.q ?? '' });
    const search = searchDraft.url === urlKey ? searchDraft.value : urlQuery.q ?? '';
    const searchNeedsNormalization = searchParams.getAll('q').length > 1 || (searchParams.get('q') ?? '') !== (urlQuery.q ?? '');
    const query = { ...urlQuery, q: search, environment: serverQuery.environment, author: serverQuery.author };
    useEffect(() => {
        if (search === (urlQuery.q ?? '') && !searchNeedsNormalization) return;
        const timer = window.setTimeout(() => setUrlSearchParams({ q: search || undefined }), 250);
        return () => window.clearTimeout(timer);
    }, [search, urlQuery.q, urlKey, searchNeedsNormalization]);
    const commitSearch = () => { setUrlSearchParams({ q: search || undefined }); };
    const clearFilters = () => {
        setSearchDraft({ url: urlKey, value: '' });
        setUrlSearchParams({ q: undefined, priority: undefined, status: undefined, people: undefined, page: undefined, unread: undefined }, { history: 'push' });
        document.getElementById('feedback-search')?.focus();
    };
    const [optimisticComments, updateComment] = useOptimistic(savedComments, (current, update: CommentUpdate) => current.map(comment => {
        if (comment.id !== update.id) return comment;
        if ('patch' in update) return { ...comment, ...update.patch };
        if ('reply' in update) {
            const saved = comment.replies.some(item => !update.previousReplyIds.includes(item.id) && item.author.isMe && item.text === update.reply.text);
            return saved ? comment : { ...comment, replies: [...comment.replies, update.reply] };
        }
        if (!comment.activity) return comment;
        const readSequence = Math.max(comment.activity.readSequence, update.readSequence);
        return { ...comment, activity: { ...comment.activity, readSequence, unread: comment.activity.lastOtherSequence > readSequence } };
    }));
    // Priority first (Urgent to Low), then number, highest first: the list, selection and keyboard follow this
    // order. The board's columns each follow the project's sort for them, by default this one in active columns
    // and the completion history in Done.
    const comments = orderComments(optimisticComments);
    // A column's new sort shows at once, and goes back with an error if saving it fails
    const [boardSorts, showSort] = useOptimistic(savedSorts, (current, change: { status: CommentStatus; sort: BoardSort }) => ({ ...current, [change.status]: change.sort }));
    const [, startSorting] = useTransition();
    const changeSort = (status: CommentStatus, sort: BoardSort) => startSorting(async () => {
        showSort({ status, sort });
        const result = await setBoardSortAction(projectId, status, sort)
            .catch(() => ({ ok: false as const, error: 'Could not save the sort. Try again.' }));
        if (result && !result.ok) toast.error(result.error);
    });
    // An open thread that is not loaded (deleted, or outside a new author or environment scope) is
    // closed, so it cannot reopen later when the scope changes back
    const openId = openComment.openId;
    useEffect(() => {
        if (!openId || comments.some(comment => comment.id === openId)) return;
        setUrlSearchParams({ comment: undefined });
    }, [openId, comments]);
    const installText = query.environment === 'all'
        ? 'Set up reviews and open a review link to leave the first comment.'
        : 'This environment has no feedback. Choose another environment, or set up reviews and open a review link to leave the first comment.';
    const installButton = (className?: string) => (
        <Link href={installHref} className={cn(buttonVariants({ variant: 'outline' }), className)}>Set up reviews</Link>
    );
    // Invited projects take two steps, each with its button: the script, then the people
    const steps = access === 'invited' && isAdmin;
    const emptyState = (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <MessageSquareDashedIcon />
                </EmptyMedia>
                <EmptyTitle>No comments yet</EmptyTitle>
                {!steps && (
                    <EmptyDescription>
                        {access === 'disabled' ? `Comments are off. ${projectAccessLabels.disabled.description}` : installText}
                    </EmptyDescription>
                )}
            </EmptyHeader>
            {steps ? (
                <EmptyContent className="max-w-2xl">
                    <ol className="m-0 grid w-full list-none gap-3 p-0 sm:grid-cols-2">
                        {[
                            { text: installText, action: installButton('w-full') },
                            { text: projectAccessLabels.invited.description, action: <InviteButton projectId={projectId} className="w-full" /> }
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
                            <Link href={KnownPageLinks.projectSettings(projectId, 'review')} className={buttonVariants({ variant: 'outline' })}>Settings</Link>
                        )}
                        {installButton()}
                    </div>
                </EmptyContent>
            )}
        </Empty>
    );

    // Each page with its number of comments, for the page search
    const pages = [...comments.reduce((counts, comment) => counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1), new Map<string, number>())]
        .map(([path, count]) => ({ path, count }));
    // "Removed addresses" and "Source not recorded" show only when they have comments; known only with every environment loaded
    const historySources = query.environment === 'all' && !searchWindowCapped
        ? [...new Set(comments.map(comment => comment.source.environment).filter(id => id === 'removed' || id === 'unknown'))]
        : undefined;
    const filtered = applyFilters(comments, query, userId, openId);
    const statusCounts = Object.fromEntries((Object.keys(statusFilterLabels) as StatusFilter[])
        .map(filter => [filter, filtered.filter(comment => statusMatches(filter, commentStatus(comment))).length])) as Record<StatusFilter, number>;
    const board = query.view === 'board';
    // Where the open thread takes the whole width, it takes the filters' place too
    const threadOnly = Boolean(openComment.openId) && !board && comments.some(comment => comment.id === openComment.openId);
    const shown = board ? filtered : filtered.filter(comment => statusMatches(query.status, commentStatus(comment)));
    // The board's columns, one per status in order (each thread in exactly one), each in the project's sort for it
    const columns = Object.fromEntries(commentStatuses.map(status => [status,
        sortBoardColumn(shown.filter(comment => commentStatus(comment) === status), boardSorts[status])])) as Record<CommentStatus, ProjectCommentView[]>;
    // What the header takes the width of: the list with its thread beside it, or the board (see below)
    const headerWide = !filtered.length || !shown.length ? undefined : board ? 'board' : 'list';
    // The header's width, which the count line under it takes too (uier #187)
    const wideClassName = cn(headerWide === 'list' && '@3xl/comments:w-[min(var(--page-wide),96rem)] @3xl/comments:mx-[calc((100%-min(var(--page-wide),96rem))/2)]',
        headerWide === 'board' && 'md:w-[min(var(--page-wide),max(100%,var(--board-width)))] md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]');
    const unreadShown = shown.filter(comment => comment.activity?.unread).length;
    // Keep matching cards mounted, including their independent reply drafts. Selection resets per scope.
    const selectionScope = JSON.stringify([projectId, query.environment, query.author, query.unread, query.people, query.page, query.status, query.q, query.priority, query.view]);
    return (
        <CommentUpdatesProvider value={updateComment}>
        <RealtimeComments projectId={projectId} revision={revision} environment={serverQuery.environment} author={serverQuery.author} />
        <CommentsSearchNavigationProvider value={commitSearch}>
        {/* The filter rows, the count line and the comments share one spacing: the gap between search and the status tabs.
            The header (search, Filter, the view toggle, the status tabs) is as wide as what is under it: the list with its
            thread beside it (CommentInbox) or the board's columns (CommentBoard). It never scrolls with the board: when
            the columns don't fit, it stays at the panel's width less the gutters (`page-wide`), the board's visible part.
            The project header above takes the same width from `data-header-wide` (the project layout, which sets `--board-width`),
            and so does the count line under it. */}
        <div ref={containerRef} className="@container/comments flex flex-col gap-2">
            <div data-header-wide={headerWide} className={cn('flex min-w-0 flex-col gap-2', threadOnly && '@max-3xl/comments:hidden', wideClassName)}>
            <CommentFilters search={search} onSearch={value => setSearchDraft({ url: urlKey, value })} priority={query.priority} author={authorFilter} environment={query.environment} environments={environments} historySources={historySources} unread={Boolean(query.unread)} unreadCount={comments.filter(comment => comment.activity?.unread).length} view={query.view} status={query.status} statusCounts={statusCounts} people={query.people} page={query.page} pages={pages} />
            {searchWindowCapped && <p className="m-0 text-sm text-muted-foreground">Search covers up to 1,000 recent threads in this environment and author scope. Narrow the environment or author to find older feedback.</p>}
            </div>
            <TriageSelection projectId={projectId} scope={selectionScope} shown={board ? commentStatuses.flatMap(status => columns[status]) : shown} assignees={assignees}
                barClassName={cn(threadOnly && '@max-3xl/comments:hidden', !comments.length && 'hidden')}
                lineClassName={wideClassName}
                // Only the unread count: the list's status tabs and the board's columns already count what is shown
                // The count toggles Only unread (uier #193), like the toolbar's Unread toggle; while the filter is on it stays,
                // at 0 too, so it can be turned off where it was turned on
                summary={(unreadShown > 0 || query.unread) && (
                    <Toggle size="sm" pressed={Boolean(query.unread)} aria-label={`${unreadShown} unread, show only unread`}
                        onPressedChange={pressed => setUrlSearchParams({ q: search || undefined, unread: pressed ? 'true' : undefined }, { history: 'push' })}
                        className={cn('-mx-1.5 px-1.5 font-normal tabular-nums pointer-coarse:min-h-11', unreadShown > 0 ? 'text-[hsl(var(--brand-accent-text))] hover:text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>
                        {`${unreadShown} unread`}
                    </Toggle>
                )}
                actions={unreadShown > 0 && <MarkAllRead projectId={projectId} threads={shown.flatMap(comment => comment.activity?.unread ? [{ id: comment.id, sequence: comment.activity.sequence }] : [])} />}>
            {!comments.length ? emptyState : !filtered.length ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <SearchXIcon />
                        </EmptyMedia>
                        <EmptyTitle>Nothing here</EmptyTitle>
                        <EmptyDescription>No comments match these filters.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent><Button variant="outline" className="pointer-coarse:min-h-11" onClick={clearFilters}>Clear filters</Button></EmptyContent>
                </Empty>
            ) : !shown.length ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            {query.status === 'active' ? <CircleCheckIcon /> : <CircleDashedIcon />}
                        </EmptyMedia>
                        <EmptyTitle>{emptyStatus[query.status].title}</EmptyTitle>
                        <EmptyDescription>{emptyStatus[query.status].description}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : board ? (
                <CommentBoard projectId={projectId} columns={columns} sorts={boardSorts} onSort={canSortBoard ? changeSort : undefined}
                    allComments={comments} assignees={assignees} userId={userId} openComment={openComment} />
            ) : (
                <CommentInbox projectId={projectId} comments={shown} allComments={comments} assignees={assignees} userId={userId} label="Comments"
                    keeps={status => statusMatches(query.status, status)} readLeaves={Boolean(query.unread)} openComment={openComment} />
            )}
            </TriageSelection>
        </div>
        </CommentsSearchNavigationProvider>
        </CommentUpdatesProvider>
    );
}
