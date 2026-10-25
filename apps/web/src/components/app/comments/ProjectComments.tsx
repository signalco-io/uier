import Link from 'next/link';
import { MessageSquareDashedIcon, SearchXIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { CommentCard, type AssigneeOption } from './CommentCard';
import { CommentFilters } from './CommentFilters';
import type { CommentsView, PeopleFilter } from './commentLabels';

export type CommentsQuery = {
    view: CommentsView;
    people: PeopleFilter;
    /** A page (relative URL) or every page */
    page?: string;
};

/** The comments query from the page's search params (unknown values fall back to the defaults) */
export function parseCommentsQuery(params: Record<string, string | string[] | undefined>): CommentsQuery {
    const value = (name: string) => {
        const raw = params[name];
        return typeof raw === 'string' ? raw : undefined;
    };
    const people = value('people');
    const page = value('page');
    return {
        view: value('view') === 'board' ? 'board' : 'list',
        people: people === 'assigned' || people === 'mine' ? people : 'all',
        page: page?.startsWith('/') ? page : undefined
    };
}

function applyFilters(comments: ProjectCommentView[], query: CommentsQuery, userId: string) {
    return comments.filter(comment => {
        if (query.page && comment.path !== query.page)
            return false;
        if (query.people === 'assigned')
            return comment.assignee?.id === userId;
        if (query.people === 'mine')
            return comment.author.isMe;
        return true;
    });
}

function CommentList({ projectId, comments, assignees, label }: {
    projectId: string;
    comments: ProjectCommentView[];
    assignees: AssigneeOption[];
    label: string;
}) {
    return (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-3 p-0">
            {comments.map(comment => (
                <li key={comment.id}>
                    <CommentCard
                        projectId={projectId}
                        comment={comment}
                        reviewLink={KnownPageLinks.projectReview(projectId, comment.url, comment.id)}
                        assignees={assignees} />
                </li>
            ))}
        </ul>
    );
}

/** The project's comments in a list or on a board (Open / Done), filtered by people and page */
export function ProjectComments({ projectId, comments, query, userId, assignees, installHref }: {
    projectId: string;
    comments: ProjectCommentView[];
    query: CommentsQuery;
    userId: string;
    assignees: AssigneeOption[];
    /** The install guide, offered while there are no comments */
    installHref: string;
}) {
    if (!comments.length) {
        return (
            <Empty className="border">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <MessageSquareDashedIcon />
                    </EmptyMedia>
                    <EmptyTitle>No comments yet</EmptyTitle>
                    <EmptyDescription>
                        Add the script to your site, open a review link and pin the first comment. It shows up here.
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    <Button variant="outline" asChild>
                        <Link href={installHref}>Install the script</Link>
                    </Button>
                </EmptyContent>
            </Empty>
        );
    }

    const pages = [...new Set(comments.map(comment => comment.path))].sort();
    const shown = applyFilters(comments, query, userId);
    const open = shown.filter(comment => !comment.resolved);
    const done = shown.filter(comment => comment.resolved);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <CommentFilters view={query.view} people={query.people} page={query.page} pages={pages} />
                <p role="status" className="m-0 text-sm text-muted-foreground tabular-nums">
                    {shown.length === comments.length
                        ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`
                        : `${shown.length} of ${comments.length} comments`}
                </p>
            </div>
            {!shown.length ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <SearchXIcon />
                        </EmptyMedia>
                        <EmptyTitle>Nothing here</EmptyTitle>
                        <EmptyDescription>No comments match these filters.</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : query.view === 'board' ? (
                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                    {[{ title: 'Open', items: open }, { title: 'Done', items: done }].map(column => (
                        <section key={column.title} aria-label={`${column.title} comments`} className="flex flex-col gap-3 rounded-2xl border bg-muted/50 p-3">
                            <h3 className="m-0 flex items-center gap-2 px-1 text-sm font-medium">
                                <span aria-hidden="true" className={column.title === 'Done' ? 'size-1.5 rounded-full bg-[hsl(var(--brand-success))]' : 'size-1.5 rounded-full bg-foreground'} />
                                {column.title}
                                <span className="font-normal tabular-nums text-muted-foreground">{column.items.length}</span>
                            </h3>
                            {column.items.length
                                ? <CommentList projectId={projectId} comments={column.items} assignees={assignees} label={`${column.title} comments list`} />
                                : <p className="m-0 px-1 pb-1 text-sm text-muted-foreground">{column.title === 'Open' ? 'Nothing open.' : 'Nothing done yet.'}</p>}
                        </section>
                    ))}
                </div>
            ) : (
                <CommentList projectId={projectId} comments={shown} assignees={assignees} label="Comments" />
            )}
        </div>
    );
}
