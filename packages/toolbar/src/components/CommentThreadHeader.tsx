'use client';

import { useContext, useState } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { Stack } from '@signalco/ui-primitives/Stack';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Link, Undo } from '@signalco/ui-icons';
import { useComments, useReadComment, useUnreadComment } from '../hooks/useComments';
import { commentLink } from '../review';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentItem, destructiveTextClassName } from './@types/Comments';
import { CopyIssueButton, CopyIssueResult, useCopyIssue } from './CopyIssue';
import { CommentThreadMenu } from './CommentThreadMenu';

/** "Open" or "Done", with the status dot (BRAND.md, "Components": ink = open, green = resolved) */
export function CommentStatusBadge({ done }: { done: boolean }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
            <span
                aria-hidden="true"
                className={cx('size-1.5 rounded-full', done ? 'bg-[hsl(var(--brand-success))]' : 'bg-foreground')} />
            <span className="sr-only">Status: </span>
            {done ? 'Done' : 'Open'}
        </span>
    );
}

/**
 * The blue dot of a thread with activity the reviewer has not read (blue: the unread count's colour).
 * It is the Mark as read button; Mark as unread is in the thread's options.
 */
export function UnreadDot({ className, disabled, onRead }: { className?: string; disabled?: boolean; onRead: () => void }) {
    return (
        <IconButton
            size="xs"
            variant="plain"
            className={cx('-mx-1.5 size-6 shrink-0', className)}
            title="Mark as read"
            aria-label="Unread. Mark as read"
            disabled={disabled}
            onClick={onRead}>
            <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
        </IconButton>
    );
}

/** Where the thread came from: "Production · https://example.com", as in the app's comment card */
export function sourceText(source: NonNullable<CommentItem['source']>) {
    return `${source.label}${source.origin && source.origin !== source.label ? ` · ${source.origin}` : ''}${!source.available ? ' · Original source unavailable' : ''}`;
}

/** The thread's quiet icon actions; the tooltip names them, so does the label for assistive technologies */
export const threadActionClassName = 'size-7 text-muted-foreground hover:text-foreground';

/**
 * The top of a thread (popover and inbox), in one row: its status, public id (`#12`) and unread
 * dot (it marks the thread read), then icon actions: "Mark as done" / "Reopen" for the author,
 * "Copy issue" and "Copy link" for everyone, and Thread options with "Mark as unread" once read.
 * `onMarkedUnread`: the reviewer asked for the thread to stay unread (no automatic read while open).
 */
export function CommentThreadHeader({ comment, onMarkedUnread }: { comment: CommentItem; onMarkedUnread?: () => void }) {
    const { review } = useContext(CommentsBootstrapperContext);
    const { resolve } = useComments();
    const read = useReadComment();
    const unreadMutation = useUnreadComment();
    const announce = useAnnounce();
    const [uncopiedLink, setUncopiedLink] = useState<string>();
    const done = comment.resolved;
    const unread = Boolean(comment.activity?.unread);
    // Only someone else's activity can be unread
    const canMarkUnread = !unread && !comment.pending && Boolean(comment.activity?.lastOtherSequence);
    const issue = useCopyIssue(comment.id);

    const handleStatus = async () => {
        try {
            await resolve.mutateAsync({ commentId: comment.id, resolved: !done });
            announce(done ? 'Reopened' : 'Marked as done');
        } catch {
            // Shown below
        }
    };

    const handleMarkUnread = async () => {
        onMarkedUnread?.();
        try {
            await unreadMutation.mutateAsync(comment);
            announce('Marked as unread');
        } catch {
            // Shown below
        }
    };

    const handleCopyLink = async () => {
        const link = commentLink(comment, review);
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setUncopiedLink(undefined);
            announce('Link copied');
        } catch {
            // No clipboard access (e.g. not a secure context): show the link to copy by hand
            setUncopiedLink(link);
        }
    };

    return (
        <Stack spacing={1}>
            <Row spacing={1} justifyContent="space-between">
                <Row spacing={1} className="min-w-0">
                    <CommentStatusBadge done={done} />
                    {/* The public id, numbered per site */}
                    {comment.number !== undefined && (
                        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="sr-only">Comment </span>#{comment.number}
                        </span>
                    )}
                    {unread && <UnreadDot disabled={read.isPending} onRead={() => read.mutate(comment)} />}
                </Row>
                <Row className="-mr-1.5 shrink-0">
                    {/* Only the author changes the status (the API enforces it too); in a project,
                        every member can (the API's `permissions`) */}
                    {(comment.permissions?.resolve ?? comment.isMine) && (
                        <IconButton
                            size="xs"
                            variant="plain"
                            className={threadActionClassName}
                            title={done ? 'Reopen' : 'Mark as done'}
                            aria-label={done ? 'Reopen' : 'Mark as done'}
                            disabled={resolve.isPending}
                            onClick={handleStatus}>
                            {done ? <Undo size={16} /> : <Check size={16} />}
                        </IconButton>
                    )}
                    {/* A comment on its way has no link or issue yet */}
                    {!comment.pending && <>
                        <CopyIssueButton state={issue} className={threadActionClassName} />
                        <IconButton
                            size="xs"
                            variant="plain"
                            className={threadActionClassName}
                            disabled={comment.source?.available === false}
                            title={comment.source?.available === false ? 'Original source unavailable' : 'Copy link'}
                            aria-label="Copy link"
                            onClick={handleCopyLink}>
                            <Link size={16} />
                        </IconButton>
                    </>}
                    {canMarkUnread && <CommentThreadMenu className={threadActionClassName} disabled={unreadMutation.isPending} onMarkUnread={handleMarkUnread} />}
                </Row>
            </Row>
            <CopyIssueResult state={issue} />
            <CommentsErrorMessage error={resolve.error ?? read.error ?? unreadMutation.error} />
            {uncopiedLink && (
                <label className="flex flex-col gap-1 text-sm">
                    <span className={destructiveTextClassName}>The link could not be copied. Copy it from here:</span>
                    <input
                        readOnly
                        value={uncopiedLink}
                        onFocus={(event) => event.currentTarget.select()}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
            )}
        </Stack>
    );
}
