import { useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { ExpandDown } from '@signalco/ui-icons';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import type { CommentItem } from './@types/Comments';

/**
 * Who the thread is assigned to, one line under its header; for members who can assign, the line
 * is the button that lists the people. Shared by the pinned thread and inbox. Options are
 * refreshed each time it opens.
 */
export function CommentAssignment({ comment }: { comment: CommentItem }) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const participants = useParticipants(comment.id, open);
    const { assign } = useComments();
    const assigned = `Assigned to ${comment.assignee?.isMe ? 'you' : comment.assignee?.name ?? 'nobody'}${comment.assignee?.unavailable ? ' (no access)' : ''}`;

    return <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {comment.permissions?.assign ? (
            <Button ref={triggerRef} size="xs" variant="plain" aria-expanded={open}
                aria-label={`${assigned}. Change assignee`}
                className="-ml-2 self-start font-normal text-muted-foreground hover:text-foreground"
                endDecorator={<ExpandDown size={14} aria-hidden="true" />}
                onClick={() => setOpen(!open)}>
                {assigned}
            </Button>
        ) : (
            <span className="flex min-h-6 items-center">{assigned}</span>
        )}
        {open && comment.permissions?.assign && <div className="flex flex-col rounded-lg border p-1" role="group" aria-label="Assign thread">
            {participants.isPending && <span role="status" className="px-2 py-1.5">Loading people...</span>}
            <CommentsErrorMessage error={participants.error ?? assign.error} />
            {[{ id: '', name: 'Unassign' }, ...(participants.data ?? [])].map(person => <Button key={person.id} variant="plain" size="sm" className="justify-start" disabled={assign.isPending}
                onClick={async () => {
                    try { await assign.mutateAsync({ commentId: comment.id, assigneeId: person.id || null }); setOpen(false); triggerRef.current?.focus(); }
                    catch { /* Keep the options and show the server error. */ }
                }}>{person.name}</Button>)}
        </div>}
    </div>;
}
