import { ReactNode, useContext, useDeferredValue, useEffect, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { ArrowUpRight, File, MapPin } from '@signalco/ui-icons';
import { CommentThread } from '../CommentThread';
import { CommentErrorBoundary } from '../CommentErrorBoundary';
import { CommentsErrorMessage } from '../CommentsErrorMessage';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { commentKey, useComments } from '../../hooks/useComments';
import { CommentComposer } from '../CommentComposer';
import { useAnnounce } from '../Announcer';
import { useCommentPlacement } from '../../hooks/useCommentItemRects';
import { commentLink } from '../../review';
import { CommentItem } from '../@types/Comments';
import { CommentsFilter } from './CommentsFilter';
import { pageLabel } from './LocationPicker';
import { useMessages, type Messages } from '../../i18n';
import type { useInboxComments } from './useInboxComments';

/** How long the search waits after the last keystroke before it announces the count */
const countAnnouncementDelayMs = 500;

/**
 * Threads the list renders with the inbox; the rest follow in a background render React splits into
 * short slices, so a long inbox opens without one long task (e2e/launch-performance.spec.ts)
 */
const firstThreads = 20;

function emptyText(filter: CommentsFilter, t: Messages) {
    const where = (filter.page ?? 'current') === 'current' ? t.inbox.onThisPage : '';
    if (filter.keywords?.trim()) {
        return t.inbox.noMatches(where);
    }
    if (filter.unread) return t.inbox.noUnread(where);
    switch (filter.status) {
        case 'open': return t.inbox.noOpen(where);
        case 'in-progress': return t.inbox.noInProgress(where);
        case 'ready': return t.inbox.noReady(where);
        case 'resolved': return t.inbox.noDone(where);
        case 'all': return t.inbox.noComments(where);
        case 'archived': return t.inbox.noArchived(where);
        default: return t.inbox.noActive(where);
    }
}

/**
 * "Show on page" for an open comment of this page, only while its pin can be placed (the same
 * placement as the pin: nothing for an element that is gone or hidden on this device)
 */
function ShowOnPage({ comment, onShowOnPage }: { comment: CommentItem; onShowOnPage: (commentId: string) => void }) {
    const { rects } = useCommentPlacement(comment.position);
    const t = useMessages();
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
                {t.inbox.showOnPage}
            </Button>
        </CardFooter>
    );
}

function CardFooter({ children }: { children: ReactNode }) {
    return <div className="flex min-w-0 items-center border-t px-2 py-1">{children}</div>;
}

/** Share the target page's draft and send lock with its pin, even from another page. */
function InboxReply({ comment, onClose }: { comment: CommentItem; onClose: () => void }) {
    const { reply } = useComments();
    const announce = useAnnounce();
    const t = useMessages();
    if (comment.pending) return null;
    return <div className="border-t">
        <CommentComposer commentId={comment.id} label={t.inbox.reply} placeholder={t.thread.replyPlaceholder} submitLabel={t.thread.postReply} draftKey={comment.id}
            autoFocus error={reply.error} onSubmit={async (text, mentions) => {
                await reply.mutateAsync({ commentId: comment.id, text, mentions });
                announce(t.thread.replyPosted);
            }} />
        <Button variant="plain" size="xs" className="mb-2 ml-3" onClick={onClose}>{t.inbox.closeReply}</Button>
    </div>;
}

function InboxThread({ comment }: { comment: CommentItem }) {
    // Mount the mutation/query hooks only after Reply is opened, keeping long lists light.
    const [replying, setReplying] = useState(false);
    const t = useMessages();
    return <CommentThread commentItem={comment}>
        {replying ? <InboxReply comment={comment} onClose={() => setReplying(false)} /> : <div className="px-3 pb-2">
            <Button variant="plain" size="sm" disabled={comment.pending} onClick={() => setReplying(true)}
                {...{ 'data-uier-reply': '' }}>{t.inbox.reply}</Button>
        </div>}
    </CommentThread>;
}

/** Where another page's comment is: a link that opens its thread there, in the review */
function OtherPage({ comment }: { comment: CommentItem }) {
    const { review } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    if (comment.source?.available === false) {
        return <CardFooter><p className="m-0 truncate px-2 font-mono text-xs text-muted-foreground">{comment.path} · {t.thread.sourceUnavailable}</p></CardFooter>;
    }

    return (
        <CardFooter>
            {/* Opens the thread on its original permitted origin, including grouped aliases */}
            <a
                href={commentLink(comment, review)}
                className="flex min-w-0 items-center gap-1.5 rounded-md p-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                <span className="sr-only">{t.inbox.openOn}</span>
                <File size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate font-mono">{comment.sourcePath ?? comment.path}</span>
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
    const t = useMessages();
    const shownCount = useDeferredValue(comments?.length ?? 0, Math.min(comments?.length ?? 0, firstThreads));
    const searching = Boolean(filter.keywords?.trim());

    // The count is announced once the typing stopped and the lists have loaded, so screen readers
    // don't hear a count for every keystroke
    const countMessage = searching ? t.inbox.found(comments?.length ?? 0) : '';
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
        content = <div className="p-1 text-sm text-muted-foreground">{t.inbox.loading}</div>;
    } else if (state.error && !comments) {
        content = (
            <Stack spacing={1} alignItems="start" className="p-1 text-sm">
                <CommentsErrorMessage error={state.error} />
                <Button variant="outlined" size="sm" onClick={() => state.refetch()}>{t.common.retry}</Button>
            </Stack>
        );
    } else if (!comments?.length) {
        content = (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                <p className="m-0">{emptyText(filter, t)}</p>
                {scope === 'current' && otherCount > 0 && (
                    <Button size="sm" variant="outlined" onClick={onShowAllPages}>
                        {t.inbox.showOnOtherPages(otherCount)}
                    </Button>
                )}
            </div>
        );
    } else {
        content = (
            <Stack spacing={2}>
                {comments.slice(0, shownCount).map((comment) => (
                    <CommentErrorBoundary key={commentKey(comment)} commentId={comment.id}>
                        {/* J and K move between the cards (focusable for that), R, S and A act on the one with the focus */}
                        <article aria-label={comment.number !== undefined ? t.inbox.commentNumber(comment.number) : t.inbox.comment} tabIndex={-1} data-uier-thread-scope=""
                            className="scroll-my-3 overflow-hidden rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <InboxThread comment={comment} />
                            {isCurrentPage(comment)
                                ? !comment.archivedAt && !comment.resolved && comment.position.type !== 'page' && <ShowOnPage comment={comment} onShowOnPage={onShowOnPage} />
                                : <OtherPage comment={comment} />}
                        </article>
                    </CommentErrorBoundary>
                ))}
            </Stack>
        );
    }

    return (
        <section aria-label={pageLabel(scope, t)}>
            <Stack spacing={2}>
                {content}
                {siteCapped && <div className="px-1 text-xs text-muted-foreground">{t.inbox.olderNotListed}</div>}
            </Stack>
            {/* Always there, so screen readers announce the count when a search changes it */}
            <div role="status" className="sr-only">
                {announcedCount}
            </div>
        </section>
    );
}
