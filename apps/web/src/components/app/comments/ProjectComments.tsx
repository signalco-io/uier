'use client';

import { useEffect, useOptimistic, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { CommentList } from './CommentList';
import type { AuthorFilter, StatusFilter } from './commentLabels';
import { parseCommentsQuery, type CommentsQuery } from './commentsQuery';
import { CommentUpdatesProvider, type CommentUpdate } from './CommentUpdates';
import { TriageSelection } from './TriageSelection';
import { matchesFeedbackSearch } from '@uier/toolbar/triage';
import { CommentsSearchNavigationProvider } from './CommentsSearchNavigation';
import { MarkAllRead } from './MarkAllRead';


function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string) {
    return comments.filter(comment => {
        if (query.priority && comment.priority !== query.priority) return false;
        if (!matchesFeedbackSearch({ path: comment.path, number: comment.number, messages: [{ text: comment.text, quotedText: comment.quotedText, deleted: comment.deleted }, ...comment.replies] }, query.q ?? '')) return false;
        if (query.unread && !comment.activity?.unread) return false;
        if (query.page && !pageMatches(query.page, comment.path))
            return false;
        if (query.people === 'assigned')
            return comment.assignee?.id === userId;
        if (query.people === 'mine')
            return comment.author.isMe;
        return true;
    });
}

/** The project's comments in a list (Open, Done or All) or on a board (Open / Done), filtered by people and page */
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
    const searchParams = useSearchParams();
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
        const timer = window.setTimeout(() => {
            const url = new URL(window.location.href);
            if (search) url.searchParams.set('q', search); else url.searchParams.delete('q');
            window.history.replaceState(null, '', url);
        }, 250);
        return () => window.clearTimeout(timer);
    }, [search, urlQuery.q, urlKey, searchNeedsNormalization]);
    const commitSearch = () => {
        const url = new URL(window.location.href);
        if (search) url.searchParams.set('q', search); else url.searchParams.delete('q');
        window.history.replaceState(null, '', url);
    };
    const clearFilters = () => {
        const url = new URL(window.location.href);
        for (const name of ['q', 'priority', 'status', 'people', 'page', 'unread']) url.searchParams.delete(name);
        setSearchDraft({ url: urlKey, value: '' });
        window.history.pushState(null, '', url);
        document.getElementById('feedback-search')?.focus();
    };
    const [comments, updateComment] = useOptimistic(savedComments, (current, update: CommentUpdate) => current.map(comment => {
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
    const installText = query.environment === 'all'
        ? 'Install the script and open a review link to leave the first comment.'
        : 'This environment has no feedback. Choose another environment, or install the script and open a review link to leave the first comment.';
    const installButton = (className?: string) => (
        <Link href={installHref} className={cn(buttonVariants({ variant: 'outline' }), className)}>Install the script</Link>
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
    const filtered = applyFilters(comments, query, userId);
    const statusCounts: Record<StatusFilter, number> = {
        open: filtered.filter(comment => !comment.resolved).length,
        done: filtered.filter(comment => comment.resolved).length,
        all: filtered.length
    };
    const board = query.view === 'board';
    const shown = board || query.status === 'all'
        ? filtered
        : filtered.filter(comment => comment.resolved === (query.status === 'done'));
    const open = shown.filter(comment => !comment.resolved);
    const done = shown.filter(comment => comment.resolved);
    // Keep matching cards mounted, including their independent reply drafts. Selection resets per scope.
    const selectionScope = JSON.stringify([projectId, query.environment, query.author, query.unread, query.people, query.page, query.status, query.q, query.priority, query.view]);
    return (
        <CommentUpdatesProvider value={updateComment}>
        <CommentsSearchNavigationProvider value={commitSearch}>
        <div className="flex flex-col gap-4">
            <CommentFilters search={search} onSearch={value => setSearchDraft({ url: urlKey, value })} priority={query.priority} author={authorFilter} environment={query.environment} environments={environments} unread={Boolean(query.unread)} unreadCount={comments.filter(comment => comment.activity?.unread).length} view={query.view} status={query.status} statusCounts={statusCounts} people={query.people} page={query.page} pages={pages}
                readAction={<MarkAllRead projectId={projectId} threads={shown.flatMap(comment => comment.activity?.unread ? [{ id: comment.id, sequence: comment.activity.sequence }] : [])} />}
                summary={(
                    <p role="status" className="m-0 text-sm text-muted-foreground tabular-nums">
                        {shown.length === comments.length
                            ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`
                            : `${shown.length} of ${comments.length} comments`}
                    </p>
                )} />
            {searchWindowCapped && <p className="m-0 text-sm text-muted-foreground">Search covers up to 1,000 recent threads in this environment and author scope. Narrow the environment or author to find older feedback.</p>}
            <TriageSelection projectId={projectId} scope={selectionScope} shown={board ? [...open, ...done] : shown} assignees={assignees}>
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
                            {query.status === 'open' ? <CircleCheckIcon /> : <CircleDashedIcon />}
                        </EmptyMedia>
                        <EmptyTitle>{query.status === 'open' ? 'Nothing open' : 'Nothing done yet'}</EmptyTitle>
                        <EmptyDescription>
                            {query.status === 'open'
                                ? 'Every comment here is done. Choose Done or All to see them.'
                                : 'Comments marked as done show here.'}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : board ? (
                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                    {[{ title: 'Open', items: open }, { title: 'Done', items: done }].map(column => (
                        <section key={column.title} aria-label={`${column.title} comments`} className="flex flex-col gap-3 rounded-2xl border bg-muted/50 p-3">
                            <h3 className="m-0 flex items-center gap-2 px-1 text-sm font-medium">
                                <span aria-hidden="true" className={column.title === 'Done' ? 'size-1.5 rounded-full bg-[hsl(var(--brand-success))]' : 'size-1.5 rounded-full bg-foreground'} />
                                {column.title}
                                <span className="font-normal tabular-nums text-muted-foreground">{column.items.length}</span>
                            </h3>
                            {column.items.length
                                ? <CommentList projectId={projectId} comments={column.items} assignees={assignees} userId={userId} label={`${column.title} comments list`} />
                                : <p className="m-0 px-1 pb-1 text-sm text-muted-foreground">{column.title === 'Open' ? 'Nothing open.' : 'Nothing done yet.'}</p>}
                        </section>
                    ))}
                </div>
            ) : (
                <CommentList projectId={projectId} comments={shown} assignees={assignees} userId={userId} label="Comments"
                    keepsResolved={query.status === 'all'} />
            )}
            </TriageSelection>
        </div>
        </CommentsSearchNavigationProvider>
        </CommentUpdatesProvider>
    );
}
