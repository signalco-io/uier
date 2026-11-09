'use client';

import { commentAssignees } from '@uier/toolbar/agents';
import { useEffect, useOptimistic, useRef, useState } from 'react';
import Link from 'next/link';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { CircleCheckIcon, CircleDashedIcon, MessageSquareDashedIcon, SearchXIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
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
import { compareDoneOrder, orderComments } from './commentOrder';
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
export function ProjectComments({ projectId, access, isAdmin, comments: savedComments, query: serverQuery, userId, assignees, installHref, environments, authorFilter, searchWindowCapped = false }: {
    searchWindowCapped?: boolean;
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
    // Priority first (Urgent to Low), then number, highest first: the list, active columns,
    // selection and keyboard follow this order. Done has its own completion history on the board.
    const comments = orderComments(optimisticComments);
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
    const filtered = applyFilters(comments, query, userId, openId);
    const statusCounts = Object.fromEntries((Object.keys(statusFilterLabels) as StatusFilter[])
        .map(filter => [filter, filtered.filter(comment => statusMatches(filter, commentStatus(comment))).length])) as Record<StatusFilter, number>;
    const board = query.view === 'board';
    // Where the open thread takes the whole width, it takes the filters' place too
    const threadOnly = Boolean(openComment.openId) && !board && comments.some(comment => comment.id === openComment.openId);
    const shown = board ? filtered : filtered.filter(comment => statusMatches(query.status, commentStatus(comment)));
    // The board's columns, one per status in order (each thread in exactly one)
    const columns = Object.fromEntries(commentStatuses.map(status => [status, shown.filter(comment => commentStatus(comment) === status)])) as Record<CommentStatus, ProjectCommentView[]>;
    columns.done.sort(compareDoneOrder);
    const unreadShown = shown.filter(comment => comment.activity?.unread).length;
    // Keep matching cards mounted, including their independent reply drafts. Selection resets per scope.
    const selectionScope = JSON.stringify([projectId, query.environment, query.author, query.unread, query.people, query.page, query.status, query.q, query.priority, query.view]);
    return (
        <CommentUpdatesProvider value={updateComment}>
        <RealtimeComments projectId={projectId} />
        <CommentsSearchNavigationProvider value={commitSearch}>
        {/* The filter rows, the count line and the comments share one spacing: the gap between search and the status tabs.
            They keep the page's reading width in both views; only the board itself is wider (CommentBoard). */}
        <div ref={containerRef} className="@container/comments flex flex-col gap-2">
            <div className={cn('contents', threadOnly && '@max-3xl/comments:hidden')}>
            <CommentFilters search={search} onSearch={value => setSearchDraft({ url: urlKey, value })} priority={query.priority} author={authorFilter} environment={query.environment} environments={environments} unread={Boolean(query.unread)} unreadCount={comments.filter(comment => comment.activity?.unread).length} view={query.view} status={query.status} statusCounts={statusCounts} people={query.people} page={query.page} pages={pages} />
            {searchWindowCapped && <p className="m-0 text-sm text-muted-foreground">Search covers up to 1,000 recent threads in this environment and author scope. Narrow the environment or author to find older feedback.</p>}
            </div>
            <TriageSelection projectId={projectId} scope={selectionScope} shown={board ? commentStatuses.flatMap(status => columns[status]) : shown} assignees={assignees}
                barClassName={cn(threadOnly && '@max-3xl/comments:hidden', !comments.length && 'hidden')}
                // Only the unread count: the list's status tabs and the board's columns already count what is shown
                summary={unreadShown > 0 && <span className="text-[hsl(var(--brand-accent-text))]">{`${unreadShown} unread`}</span>}
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
                <CommentBoard projectId={projectId} columns={columns} allComments={comments} assignees={assignees} userId={userId} openComment={openComment} />
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
