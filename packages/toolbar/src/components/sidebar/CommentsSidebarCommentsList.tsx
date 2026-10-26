import { ReactNode, useContext, useDeferredValue, useEffect, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { ArrowUpRight, File, MapPin } from '@signalco/ui-icons';
import { CommentThread } from '../CommentThread';
import { CommentErrorBoundary } from '../CommentErrorBoundary';
import { CommentsErrorMessage } from '../CommentsErrorMessage';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { commentKey } from '../../hooks/useComments';
import { useCommentPlacement } from '../../hooks/useCommentItemRects';
import { commentLink } from '../../review';
import { CommentItem } from '../@types/Comments';
import { CommentsFilter } from './CommentsFilter';
import { pageLabel } from './PagePicker';
import type { useInboxComments } from './useInboxComments';

/** How long the search waits after the last keystroke before it announces the count */
const countAnnouncementDelayMs = 500;

/**
 * Threads the list renders with the inbox; the rest follow in a background render React splits into
 * short slices, so a long inbox opens without one long task (e2e/launch-performance.spec.ts)
 */
const firstThreads = 20;

function emptyText(filter: CommentsFilter) {
    const where = (filter.page ?? 'current') === 'current' ? ' on this page' : '';
    if (filter.keywords?.trim()) {
        return `No matches${where}`;
    }
    if (filter.unread) return `No unread comments${where}`;
    switch (filter.status) {
        case 'resolved': return `No done comments${where}`;
        case 'all': return `No comments${where}`;
        default: return `No open comments${where}`;
    }
}

function countText(count: number) {
    return `${count} ${count === 1 ? 'comment' : 'comments'}`;
}

/**
 * "Show on page" for an open comment of this page, only while its pin can be placed (the same
 * placement as the pin: nothing for an element that is gone or hidden on this device)
 */
function ShowOnPage({ comment, onShowOnPage }: { comment: CommentItem; onShowOnPage: (commentId: string) => void }) {
    const { rects } = useCommentPlacement(comment.position);
    if (!rects.length) {
        return null;
    }

    return (
        <CardFooter>
            <Button
                size="xs"
                variant="plain"
                className="text-muted-foreground hover:text-foreground"
                startDecorator={<MapPin size={14} aria-hidden="true" />}
                onClick={() => onShowOnPage(comment.id)}>
                Show on page
            </Button>
        </CardFooter>
    );
}

function CardFooter({ children }: { children: ReactNode }) {
    return <div className="flex min-w-0 items-center border-t px-2 py-1">{children}</div>;
}

/** Where another page's comment is: a link that opens its thread there, in the review */
function OtherPage({ comment }: { comment: CommentItem }) {
    const { review } = useContext(CommentsBootstrapperContext);
    if (comment.source?.available === false) {
        return <CardFooter><p className="m-0 truncate px-2 font-mono text-xs text-muted-foreground">{comment.path} · Original source unavailable</p></CardFooter>;
    }

    return (
        <CardFooter>
            {/* Opens the thread on its original permitted origin, including grouped aliases */}
            <a
                href={commentLink(comment, review)}
                className="flex min-w-0 items-center gap-1.5 rounded-md p-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                <span className="sr-only">Open on </span>
                <File size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate font-mono">{comment.path}</span>
                <ArrowUpRight size={14} aria-hidden="true" className="shrink-0" />
            </a>
        </CardFooter>
    );
}

type CommentsSidebarCommentsListProps = {
    inbox: ReturnType<typeof useInboxComments>;
    filter: CommentsFilter;
    onShowOnPage: (commentId: string) => void;
    /** Lists every page (from "this page" with nothing to show) */
    onShowAllPages: () => void;
};

/**
 * The inbox's comments for the chosen pages, newest first. A comment of this page can be shown
 * on its pin; another page's links to its thread there. With nothing on this page, it offers the
 * other pages' matching comments.
 */
export function CommentsSidebarCommentsList({ inbox, filter, onShowOnPage, onShowAllPages }: CommentsSidebarCommentsListProps) {
    const { comments, state, scope, otherCount, siteCapped, isCurrentPage, loading } = inbox;
    const shownCount = useDeferredValue(comments?.length ?? 0, Math.min(comments?.length ?? 0, firstThreads));
    const searching = Boolean(filter.keywords?.trim());

    // The count is announced once the typing stopped and the lists have loaded, so screen readers
    // don't hear a count for every keystroke
    const countMessage = searching ? `${countText(comments?.length ?? 0)} found` : '';
    const [announcedCount, setAnnouncedCount] = useState('');
    useEffect(() => {
        if (loading) {
            return;
        }
        const timeout = window.setTimeout(() => setAnnouncedCount(countMessage), countAnnouncementDelayMs);
        return () => window.clearTimeout(timeout);
    }, [countMessage, filter.keywords, loading]);

    let content: ReactNode;
    if (state.isPending) {
        content = <div className="p-1 text-sm text-muted-foreground">Loading comments...</div>;
    } else if (state.error && !comments) {
        content = (
            <Stack spacing={1} alignItems="start" className="p-1 text-sm">
                <CommentsErrorMessage error={state.error} />
                <Button variant="outlined" size="sm" onClick={() => state.refetch()}>Try again</Button>
            </Stack>
        );
    } else if (!comments?.length) {
        content = (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                <p className="m-0">{emptyText(filter)}</p>
                {scope === 'current' && otherCount > 0 && (
                    <Button size="sm" variant="outlined" onClick={onShowAllPages}>
                        Show {otherCount} on other pages
                    </Button>
                )}
            </div>
        );
    } else {
        content = (
            <Stack spacing={2}>
                {comments.slice(0, shownCount).map((comment) => (
                    <CommentErrorBoundary key={commentKey(comment)} commentId={comment.id}>
                        <article aria-label={comment.number !== undefined ? `Comment #${comment.number}` : 'Comment'} className="overflow-hidden rounded-xl border bg-card">
                            <CommentThread commentItem={comment} />
                            {isCurrentPage(comment)
                                ? !comment.resolved && comment.position.type !== 'page' && <ShowOnPage comment={comment} onShowOnPage={onShowOnPage} />
                                : <OtherPage comment={comment} />}
                        </article>
                    </CommentErrorBoundary>
                ))}
            </Stack>
        );
    }

    return (
        <section aria-label={pageLabel(scope)}>
            <Stack spacing={2}>
                {content}
                {siteCapped && <div className="px-1 text-xs text-muted-foreground">Older comments are not listed.</div>}
            </Stack>
            {/* Always there, so screen readers announce the count when a search changes it */}
            <div role="status" className="sr-only">
                {announcedCount}
            </div>
        </section>
    );
}
