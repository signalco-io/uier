import Link from 'next/link';
import { CircleCheckIcon, CircleDashedIcon, MessageSquareDashedIcon, SearchXIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
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
import type { AuthorFilter, CommentsView, PeopleFilter, StatusFilter } from './commentLabels';
import { MarkAllRead } from './MarkAllRead';

export type CommentsQuery = {
    environment?: string;
    author?: string;
    unread?: boolean;
    view: CommentsView;
    /** Open, Done or All in the list (the board shows Open and Done side by side) */
    status: StatusFilter;
    people: PeopleFilter;
    /** A page (relative URL), a section (`/blog/*`) or every page */
    page?: string;
};

/** The comments query from the page's search params (unknown values fall back to the defaults) */
export function parseCommentsQuery(params: Record<string, string | string[] | undefined>): CommentsQuery {
    const value = (name: string) => {
        const raw = params[name];
        return typeof raw === 'string' ? raw : undefined;
    };
    const people = value('people');
    const status = value('status');
    const page = value('page');
    return {
        environment: value('environment'),
        author: value('author'),
        unread: value('unread') === 'true',
        view: value('view') === 'board' ? 'board' : 'list',
        status: status === 'done' || status === 'all' ? status : 'open',
        people: people === 'assigned' || people === 'mine' ? people : 'all',
        page: page?.startsWith('/') ? page : undefined
    };
}

function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string) {
    return comments.filter(comment => {
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
export function ProjectComments({ projectId, access, isAdmin, comments, query, userId, assignees, installHref, environments, authorFilter }: {
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
    const installText = query.environment === 'all'
        ? 'Install the script and open a review link to leave the first comment.'
        : 'This environment has no feedback. Choose another environment, or install the script and open a review link to leave the first comment.';
    const installButton = (className?: string) => (
        <Button variant="outline" asChild className={className}>
            <Link href={installHref}>Install the script</Link>
        </Button>
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
                            <Button variant="outline" asChild>
                                <Link href={KnownPageLinks.projectSettings(projectId)}>Settings</Link>
                            </Button>
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
    // A new filter renders a new list, so only cards moved in later animate
    const listKey = [query.environment, query.author, query.unread, query.people, query.page, query.status].join('|');

    return (
        <div className="flex flex-col gap-4">
            <CommentFilters author={authorFilter} environment={query.environment} environments={environments} unread={Boolean(query.unread)} unreadCount={comments.filter(comment => comment.activity?.unread).length} view={query.view} status={query.status} statusCounts={statusCounts} people={query.people} page={query.page} pages={pages}
                readAction={<MarkAllRead projectId={projectId} threads={shown.flatMap(comment => comment.activity?.unread ? [{ id: comment.id, sequence: comment.activity.sequence }] : [])} />}
                summary={(
                    <p role="status" className="m-0 text-sm text-muted-foreground tabular-nums">
                        {shown.length === comments.length
                            ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`
                            : `${shown.length} of ${comments.length} comments`}
                    </p>
                )} />
            {!comments.length ? emptyState : !filtered.length ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <SearchXIcon />
                        </EmptyMedia>
                        <EmptyTitle>Nothing here</EmptyTitle>
                        <EmptyDescription>No comments match these filters.</EmptyDescription>
                    </EmptyHeader>
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
                                ? <CommentList key={listKey} projectId={projectId} comments={column.items} assignees={assignees} userId={userId} label={`${column.title} comments list`} />
                                : <p className="m-0 px-1 pb-1 text-sm text-muted-foreground">{column.title === 'Open' ? 'Nothing open.' : 'Nothing done yet.'}</p>}
                        </section>
                    ))}
                </div>
            ) : (
                <CommentList key={listKey} projectId={projectId} comments={shown} assignees={assignees} userId={userId} label="Comments"
                    keepsResolved={query.status === 'all'} />
            )}
        </div>
    );
}
