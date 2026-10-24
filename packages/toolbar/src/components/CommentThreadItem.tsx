'use client';

import { Typography } from '@signalco/ui-primitives/Typography';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { Check, Undo } from '@signalco/ui-icons';
import { Timeago } from '@signalco/ui/Timeago';
import { useComments } from '../hooks/useComments';
import { CommentThreadItemMenu } from './CommentThreadItemMenu';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { CommentItem, CommentItemThreadItem } from './@types/Comments';

function parseDate(value: string | undefined) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

function avatarText(name: string) {
    // `Guest 1A2B` -> `1A`, so different visitors are easier to tell apart
    const guestCode = /^Guest ([0-9A-F]{2})/i.exec(name)?.[1];
    return (guestCode ?? name[0] ?? '?').toUpperCase();
}

export function CommentThreadItem({ comment, threadItem, first }: { comment: CommentItem, threadItem: CommentItemThreadItem; first?: boolean; }) {
    const { resolve, delete: deleteComment, deleteReply } = useComments();
    const { text } = threadItem;
    const quote: string | undefined = threadItem.quotedText;
    const authorName = threadItem.author?.name || 'Guest';
    const isMe = Boolean(threadItem.author?.isMe);
    const createdAt = parseDate(threadItem.createdAt);

    // Only the author may resolve or delete a comment (deleting the first item deletes the
    // whole comment), and only the author of a reply may delete it
    const canResolve = Boolean(first && comment.isMine);
    const canDelete = first ? comment.isMine : isMe;
    const pending = resolve.isPending || deleteComment.isPending || deleteReply.isPending;
    const error = resolve.error ?? deleteComment.error ?? deleteReply.error;

    const handleResolve = () => {
        resolve.mutate({ commentId: comment.id, resolved: !comment.resolved });
    };

    const handleDelete = () => {
        if (first) {
            deleteComment.mutate(comment.id);
        } else {
            deleteReply.mutate({ commentId: comment.id, itemId: threadItem.id });
        }
    };

    return (
        <Stack spacing={1}>
            <Row spacing={1} justifyContent="space-between">
                <Row spacing={1} className="min-w-0">
                    <Avatar size="sm" aria-hidden="true" className="shrink-0 font-semibold">{avatarText(authorName)}</Avatar>
                    <Typography level="body2" semiBold noWrap className="text-foreground" title={authorName}>
                        {isMe ? 'You' : authorName}
                    </Typography>
                    {createdAt && (
                        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                            <Timeago date={createdAt} />
                        </span>
                    )}
                </Row>
                <Row className="shrink-0">
                    {canResolve && (
                        <IconButton
                            size="xs"
                            variant="plain"
                            title={comment.resolved ? 'Reopen' : 'Resolve'}
                            aria-label={comment.resolved ? 'Reopen' : 'Resolve'}
                            disabled={pending}
                            onClick={handleResolve}>
                            {comment.resolved ? <Undo /> : <Check />}
                        </IconButton>
                    )}
                    {canDelete && (
                        <CommentThreadItemMenu
                            disabled={pending}
                            onDelete={handleDelete} />
                    )}
                </Row>
            </Row>
            {Boolean(quote?.length) && (
                <blockquote className="m-0 line-clamp-4 border-l-2 border-muted-foreground bg-muted px-2 py-1 text-sm text-secondary-foreground">
                    {quote}
                </blockquote>
            )}
            <Typography level="body1" className="whitespace-pre-wrap break-words text-sm">{text}</Typography>
            <CommentsErrorMessage error={error} />
        </Stack>
    );
}
