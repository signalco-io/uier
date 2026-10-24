import { ReactNode, useContext, useId } from 'react';
import { UseQueryResult } from '@tanstack/react-query';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { ArrowUpRight, MapPin } from '@signalco/ui-icons';
import { CommentThread } from '../CommentThread';
import { CommentErrorBoundary } from '../CommentErrorBoundary';
import { CommentsErrorMessage } from '../CommentsErrorMessage';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { useComments, useSiteComments } from '../../hooks/useComments';
import { commentLink } from '../../review';
import { CommentItem, commentsListMaxLength } from '../@types/Comments';
import { CommentsFilter, matchesFilter } from './CommentsFilter';

function emptyText(filter: CommentsFilter) {
    if (filter.keywords?.trim()) {
        return 'No matches';
    }
    switch (filter.status) {
        case 'resolved': return 'No done comments';
        case 'all': return 'No comments';
        default: return 'No open comments';
    }
}

function countText(count: number) {
    return `${count} ${count === 1 ? 'comment' : 'comments'}`;
}

type CommentsGroupProps = {
    title: string;
    query: UseQueryResult<CommentItem[], Error>;
    /** The group's comments that match the filter */
    comments: CommentItem[] | undefined;
    filter: CommentsFilter;
    /** Where the comment is: on this page or on another one */
    renderPlace: (comment: CommentItem) => ReactNode;
    /** Under the list, e.g. that older comments are not listed */
    note?: string;
};

function CommentsGroup({ title, query, comments, filter, renderPlace, note }: CommentsGroupProps) {
    const headingId = useId();
    const { error, isPending, refetch } = query;

    let content: ReactNode;
    if (isPending) {
        content = <div className="p-1 text-sm text-muted-foreground">Loading comments...</div>;
    } else if (error && !comments) {
        content = (
            <Stack spacing={1} alignItems="start" className="p-1 text-sm">
                <CommentsErrorMessage error={error} />
                <Button variant="outlined" size="sm" onClick={() => refetch()}>Try again</Button>
            </Stack>
        );
    } else if (!comments?.length) {
        content = <div className="p-1 text-sm text-muted-foreground">{emptyText(filter)}</div>;
    } else {
        content = (
            <Stack spacing={1}>
                {comments.map((comment) => (
                    <CommentErrorBoundary key={comment.id} commentId={comment.id}>
                        <article aria-label={comment.number !== undefined ? `Comment #${comment.number}` : 'Comment'} className="rounded-xl border bg-card">
                            {renderPlace(comment)}
                            <CommentThread commentItem={comment} />
                        </article>
                    </CommentErrorBoundary>
                ))}
            </Stack>
        );
    }

    return (
        <section aria-labelledby={headingId}>
            <Stack spacing={1}>
                <Row spacing={1} className="px-1">
                    <Typography id={headingId} component="h3" level="body2" semiBold className="text-foreground">{title}</Typography>
                    {comments && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                            <span aria-hidden="true">{comments.length}</span>
                            <span className="sr-only">{countText(comments.length)}</span>
                        </span>
                    )}
                </Row>
                {content}
                {note && <div className="px-1 text-xs text-muted-foreground">{note}</div>}
            </Stack>
        </section>
    );
}

type CommentsSidebarCommentsListProps = {
    filter: CommentsFilter;
    onShowOnPage: (commentId: string) => void;
};

/**
 * The inbox's comments in two groups: this page (the page's own list, as its pins) and the site's
 * other pages (`GET /api/comments?scope=site`), newest first. The showcase is on the landing page
 * only, so it has no other pages.
 */
export function CommentsSidebarCommentsList({ filter, onShowOnPage }: CommentsSidebarCommentsListProps) {
    const { mode, review } = useContext(CommentsBootstrapperContext);
    const { path, query: pageQuery } = useComments();
    const withOtherPages = mode === 'review';
    const siteQuery = useSiteComments(withOtherPages);

    const pageComments = pageQuery.data?.filter(c => matchesFilter(c, filter));
    const otherComments = withOtherPages
        ? siteQuery.data?.filter(c => c.path !== path && matchesFilter(c, filter))
        : undefined;
    // The API lists the site's newest comments only
    const siteCapped = (siteQuery.data?.length ?? 0) >= commentsListMaxLength;
    const searching = Boolean(filter.keywords?.trim());

    return (
        <Stack spacing={3}>
            <CommentsGroup
                title="This page"
                query={pageQuery}
                comments={pageComments}
                filter={filter}
                renderPlace={(comment) => !comment.resolved && comment.position.type !== 'page' && (
                    <div className="px-2 pt-1">
                        <Button
                            size="xs"
                            variant="plain"
                            className="text-muted-foreground"
                            startDecorator={<MapPin size={14} aria-hidden="true" />}
                            onClick={() => onShowOnPage(comment.id)}>
                            Show on page
                        </Button>
                    </div>
                )} />
            {withOtherPages && (
                <CommentsGroup
                    title="Other pages"
                    query={siteQuery}
                    comments={otherComments}
                    filter={filter}
                    note={siteCapped ? 'Older comments are not listed.' : undefined}
                    renderPlace={(comment) => (
                        // Opens the thread on its page (`?uier-comment=`), in the review
                        <a
                            href={commentLink(comment, review)}
                            className="flex min-w-0 items-center gap-1 rounded-t-xl px-4 pt-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <span className="sr-only">Open on </span>
                            <span className="truncate font-mono">{comment.path}</span>
                            <ArrowUpRight size={14} aria-hidden="true" className="shrink-0" />
                        </a>
                    )} />
            )}
            {/* Always there, so screen readers announce the count when a search changes it */}
            <div role="status" className="sr-only">
                {searching && `${countText((pageComments?.length ?? 0) + (otherComments?.length ?? 0))} found`}
            </div>
        </Stack>
    );
}
