import type { RefObject } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { cx } from '@signalco/ui-primitives/cx';
import { User } from '@signalco/ui-icons';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { avatarText } from './CommentThreadItem';
import type { CommentItem } from './@types/Comments';

/** "Unassigned" or "Assigned to Ana": the assignee's tooltip and name, the same words as the app's comment card */
export function assignedText(comment: CommentItem) {
    if (!comment.assignee) return 'Unassigned';
    return `Assigned to ${comment.assignee.isMe ? 'you' : comment.assignee.name}${comment.assignee.unavailable ? ' (no access)' : ''}`;
}

/** The assignee's avatar, as in the messages, or the user icon while unassigned */
function AssigneeAvatar({ comment }: { comment: CommentItem }) {
    if (!comment.assignee) return <User size={16} aria-hidden="true" />;
    return <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(comment.assignee.name)}</Avatar>;
}

/**
 * Who the thread is assigned to, in its header after the status (the app's comment card): the
 * assignee's avatar or the user icon, named by its tooltip. For members who can assign it is the
 * button that opens `CommentAssigneeOptions`; others only see an assignee that is set.
 */
export function CommentAssignee({ comment, open, onToggle, triggerRef, className }: {
    comment: CommentItem;
    open: boolean;
    onToggle: () => void;
    triggerRef: RefObject<HTMLButtonElement | null>;
    className?: string;
}) {
    const assigned = assignedText(comment);
    if (comment.permissions?.assign) {
        return (
            <IconButton ref={triggerRef} size="xs" variant="plain" aria-expanded={open}
                className={cx(className, 'shrink-0 p-0')}
                title={assigned}
                aria-label={`${assigned}. Change assignee`}
                onClick={onToggle}>
                <AssigneeAvatar comment={comment} />
            </IconButton>
        );
    }
    if (!comment.assignee) return null;
    return (
        <span role="img" title={assigned} aria-label={assigned} className={cx('inline-flex shrink-0 items-center justify-center', className)}>
            <AssigneeAvatar comment={comment} />
        </span>
    );
}

/** The people to assign the thread to, under its header while `CommentAssignee` is open; refreshed each time it opens */
export function CommentAssigneeOptions({ comment, onAssigned }: { comment: CommentItem; onAssigned: () => void }) {
    const participants = useParticipants(comment.id);
    const { assign } = useComments();

    return <div className="flex flex-col rounded-lg border p-1 text-xs text-muted-foreground" role="group" aria-label="Assign thread">
        {participants.isPending && <span role="status" className="px-2 py-1.5">Loading people...</span>}
        <CommentsErrorMessage error={participants.error ?? assign.error} />
        {[{ id: '', name: 'Unassign' }, ...(participants.data ?? [])].map(person => <Button key={person.id} variant="plain" size="sm" className="justify-start" disabled={assign.isPending}
            onClick={async () => {
                try { await assign.mutateAsync({ commentId: comment.id, assigneeId: person.id || null }); onAssigned(); }
                catch { /* Keep the options and show the server error. */ }
            }}>{person.name}</Button>)}
    </div>;
}
