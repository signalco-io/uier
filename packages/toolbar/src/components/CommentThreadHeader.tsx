'use client';

import { useContext, useState } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Copy, Link, Undo } from '@signalco/ui-icons';
import { useComments } from '../hooks/useComments';
import { commentLink } from '../review';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentItem, destructiveTextClassName } from './@types/Comments';
import { CopyIssueResult, useCopyIssue } from './CopyIssue';

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
 * The top of a thread (popover and inbox): its status and public id (`#12`), "Mark as done" /
 * "Reopen" for the author and "Copy link" for everyone.
 */
export function CommentThreadHeader({ comment }: { comment: CommentItem }) {
    const { review } = useContext(CommentsBootstrapperContext);
    const { resolve } = useComments();
    const announce = useAnnounce();
    const [uncopiedLink, setUncopiedLink] = useState<string>();
    const done = comment.resolved;
    const issue = useCopyIssue(comment.id);

    const handleStatus = async () => {
        try {
            await resolve.mutateAsync({ commentId: comment.id, resolved: !done });
            announce(done ? 'Reopened' : 'Marked as done');
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
            <Row spacing={1} justifyContent="space-between" className="flex-wrap gap-y-1">
                <Row spacing={1} className="min-w-0 shrink-0">
                    <CommentStatusBadge done={done} />
                    {/* The public id, numbered per site */}
                    {comment.number !== undefined && (
                        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="sr-only">Comment </span>#{comment.number}
                        </span>
                    )}
                </Row>
                <Row spacing={0.5} className="shrink-0">
                    {/* Only the author changes the status (the API enforces it too); in a project,
                        every member can (the API's `permissions`) */}
                    {(comment.permissions?.resolve ?? comment.isMine) && (
                        <Button
                            size="xs"
                            variant="plain"
                            startDecorator={done ? <Undo size={14} /> : <Check size={14} />}
                            disabled={resolve.isPending}
                            onClick={handleStatus}>
                            {done ? 'Reopen' : 'Mark as done'}
                        </Button>
                    )}
                    <IconButton
                        size="xs"
                        variant="plain"
                        title="Copy issue"
                        aria-label="Copy issue"
                        aria-busy={issue.pending}
                        disabled={issue.pending}
                        onClick={issue.copy}>
                        <Copy size={16} />
                    </IconButton>
                    <IconButton
                        size="xs"
                        variant="plain"
                        disabled={comment.source?.available === false}
                        title={comment.source?.available === false ? 'Original source unavailable' : 'Copy link'}
                        aria-label="Copy link"
                        onClick={handleCopyLink}>
                        <Link size={16} />
                    </IconButton>
                </Row>
            </Row>
            <CopyIssueResult state={issue} />
            {comment.source && <p className="m-0 break-words text-xs text-muted-foreground">{comment.source.label}{comment.source.origin && comment.source.origin !== comment.source.label ? ` · ${comment.source.origin}` : ''}{!comment.source.available ? ' · Original source unavailable' : ''}</p>}
            <CommentsErrorMessage error={resolve.error} />
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
