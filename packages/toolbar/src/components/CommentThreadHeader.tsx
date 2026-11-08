'use client';

import { feedbackStage, feedbackStageLabels, readyForReview, type FeedbackStage } from '../verification';
import { useContext, useRef, useState, type RefObject } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { Stack } from '@signalco/ui-primitives/Stack';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Undo } from '@signalco/ui-icons';
import { newLocalId, useComments, useReadComment, useUnreadComment } from '../hooks/useComments';
import { commentPriority, priorityLabels, type CommentPriority as CommentPriorityValue } from '../triage';
import { commentLink } from '../review';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentItem, destructiveTextClassName } from './@types/Comments';
import { CopyIssueResult, CopyMenu, useCopyIssue } from './CopyIssue';
import { assignedText, CommentAssignee, CommentAssigneeOptions } from './CommentAssignment';
import { CommentThreadMenu } from './CommentThreadMenu';
import { IconTooltip, useIconTooltip } from './IconTooltip';
import { useThreadNotificationActions } from './ThreadNotifications';

/**
 * "Open", "In progress", "Ready to verify" or "Done", with the status dot (BRAND.md, "Components":
 * ink while not done, green = resolved). The app's `StateBadge`.
 */
export function CommentStatusBadge({ stage }: { stage: FeedbackStage }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
            <span
                aria-hidden="true"
                className={cx('size-1.5 rounded-full', stage === 'done' ? 'bg-[hsl(var(--brand-success))]' : 'bg-foreground')} />
            <span className="sr-only">Status: </span>
            {feedbackStageLabels[stage]}
        </span>
    );
}

/**
 * The blue dot of a thread with activity the reviewer has not read (blue: the unread count's colour).
 * It is the Mark as read button; Mark as unread is in the thread's options.
 */
export function UnreadDot({ className, disabled, onRead }: { className?: string; disabled?: boolean; onRead: () => void }) {
    return (
        <IconTooltip label="Mark as read">
            <IconButton
                size="xs"
                variant="plain"
                className={cx('-mx-1.5 size-6 shrink-0', className)}
                aria-label="Unread. Mark as read"
                disabled={disabled}
                onClick={onRead}>
                <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
            </IconButton>
        </IconTooltip>
    );
}

/** Where the thread came from: "Production · https://example.com", as in the app's comment card */
export function sourceText(source: NonNullable<CommentItem['source']>) {
    return `${source.label}${source.origin && source.origin !== source.label ? ` · ${source.origin}` : ''}${!source.available ? ' · Original source unavailable' : ''}`;
}

/** The thread's quiet icon actions; the tooltip names them, so does the label for assistive technologies */
export const threadActionClassName = 'size-7 text-muted-foreground hover:text-foreground';

/** A priority other than Normal, beside the status (Normal says nothing) */
function PriorityBadge({ comment }: { comment: CommentItem }) {
    const priority = commentPriority(comment.priority);
    if (priority === 'normal') return null;
    return (
        <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs text-foreground">
            <span className="sr-only">Priority: </span>{priorityLabels[priority]}
        </span>
    );
}

/**
 * The top of a thread (popover and inbox), on one line: its status, public id (`#12`), unread dot (it
 * marks the thread read), a priority other than Normal and the assignee's avatar, then the actions:
 * Mark as done / Reopen for those who can resolve, Copy (the issue or the link) and Thread options with
 * the triage and email controls each person may use (assign, priority, Mark as in progress or Mark as
 * open, Request verification, follow, mute, Mark as unread). The people to assign open under the line.
 * `onMarkedUnread`: the reviewer asked for the thread to stay unread (no automatic read while open).
 */
export function CommentThreadHeader({ comment, onMarkedUnread, onRequestVerification, optionsRef }: {
    comment: CommentItem;
    onMarkedUnread?: () => void;
    /** Thread options' Request verification: the form opens in the thread */
    onRequestVerification?: () => void;
    /** Thread options' button, where focus returns from the forms it opens */
    optionsRef?: RefObject<HTMLButtonElement | null>;
}) {
    const { review } = useContext(CommentsBootstrapperContext);
    const { resolve, progress, prioritize } = useComments();
    const read = useReadComment();
    const unreadMutation = useUnreadComment();
    const announce = useAnnounce();
    const [uncopiedLink, setUncopiedLink] = useState<string>();
    const done = comment.resolved;
    const stage = feedbackStage(comment);
    const canResolve = comment.permissions?.resolve ?? comment.isMine;
    const doneLabel = readyForReview(comment) ? 'Done without verification' : 'Mark as done';
    const unread = Boolean(comment.activity?.unread);
    // Only someone else's activity can be unread
    const canMarkUnread = !unread && !comment.pending && Boolean(comment.activity?.lastOtherSequence);
    const issue = useCopyIssue(comment.id);
    const [assigning, setAssigning] = useState(false);
    const notifications = useThreadNotificationActions(comment);
    const statusTooltip = useIconTooltip(done ? 'Reopen' : doneLabel);
    // A failed priority change keeps its identity until the intended value changes
    const priorityAttempt = useRef<{ priority: string; key: string } | null>(null);
    const verification = comment.verificationPermissions;

    const handleStatus = async () => {
        try {
            await resolve.mutateAsync({ commentId: comment.id, resolved: !done });
            announce(done ? 'Reopened' : 'Marked as done');
        } catch {
            // Shown below
        }
    };

    const handleProgress = async () => {
        const status = stage === 'in-progress' ? 'open' : 'in-progress';
        try {
            await progress.mutateAsync({ commentId: comment.id, status });
            announce(status === 'open' ? 'Marked as open' : 'Marked as in progress');
        } catch {
            // Shown below
        }
        optionsRef?.current?.focus();
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

    const handlePriority = async (value: CommentPriorityValue) => {
        if (priorityAttempt.current?.priority !== value) priorityAttempt.current = { priority: value, key: newLocalId() };
        try {
            await prioritize.mutateAsync({ commentId: comment.id, priority: value, idempotencyKey: priorityAttempt.current.key });
            priorityAttempt.current = null;
            announce(`Priority set to ${priorityLabels[value]}`);
        } catch { /* Keep the intended value and key for retry; shown below */ }
        optionsRef?.current?.focus();
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
            <Row spacing={1} justifyContent="space-between" className="flex-nowrap">
                <Row spacing={1} className="min-w-0 flex-wrap gap-y-1">
                    <CommentStatusBadge stage={stage} />
                    {/* The public id, numbered per site */}
                    {comment.number !== undefined && (
                        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="sr-only">Comment </span>#{comment.number}
                        </span>
                    )}
                    {unread && <UnreadDot disabled={read.isPending} onRead={() => read.mutate(comment)} />}
                    <PriorityBadge comment={comment} />
                    <CommentAssignee comment={comment} className={threadActionClassName} />
                </Row>
                <Row className="-mr-1.5 shrink-0">
                    {/* Only the author changes the status (the API enforces it too); in a project,
                        every member can (the API's `permissions`) */}
                    {canResolve && <>
                        <IconButton
                            size="xs"
                            variant="plain"
                            className={threadActionClassName}
                            aria-label={done ? 'Reopen' : doneLabel}
                            disabled={resolve.isPending}
                            onClick={handleStatus}
                            {...statusTooltip.triggerProps}>
                            {done ? <Undo size={16} /> : <Check size={16} />}
                        </IconButton>
                        {statusTooltip.tooltip}
                    </>}
                    {/* A comment on its way has no link, issue or options yet */}
                    {!comment.pending && <>
                        <CopyMenu state={issue} className={threadActionClassName} linkAvailable={comment.source?.available !== false} onCopyLink={handleCopyLink} />
                        <CommentThreadMenu className={threadActionClassName} triggerRef={optionsRef} actions={{
                            assign: comment.permissions?.assign ? { label: assignedText(comment), onAssign: () => setAssigning(true) } : undefined,
                            priority: comment.permissions?.priority ? { value: comment.priority, pending: prioritize.isPending, onChange: handlePriority } : undefined,
                            // Open and In progress, for those who mark it done; Ready to verify has its own controls
                            progress: canResolve && (stage === 'open' || stage === 'in-progress')
                                ? { label: stage === 'open' ? 'Mark as in progress' : 'Mark as open', pending: progress.isPending, onChange: handleProgress }
                                : undefined,
                            verify: verification?.request && onRequestVerification
                                ? { label: comment.verification?.outcome === 'pending' && !done ? 'Request a new check' : 'Request verification', onRequest: onRequestVerification }
                                : undefined,
                            follow: notifications.follow,
                            mute: notifications.mute,
                            markUnread: canMarkUnread ? { pending: unreadMutation.isPending, onMarkUnread: handleMarkUnread } : undefined
                        }} />
                    </>}
                </Row>
            </Row>
            {assigning && comment.permissions?.assign && (
                <CommentAssigneeOptions comment={comment} onAssigned={() => { setAssigning(false); optionsRef?.current?.focus(); }} />
            )}
            <CopyIssueResult state={issue} />
            <CommentsErrorMessage error={resolve.error ?? progress.error ?? read.error ?? unreadMutation.error ?? prioritize.error ?? notifications.error} />
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
