import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { ExpandDown, User } from '@signalco/ui-icons';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import type { CommentItem } from './@types/Comments';

/** "Unassigned" or "Assigned to Ana": the same words as the app's comment card */
export function assignedText(comment: CommentItem) {
    if (!comment.assignee) return 'Unassigned';
    return `Assigned to ${comment.assignee.isMe ? 'you' : comment.assignee.name}${comment.assignee.unavailable ? ' (no access)' : ''}`;
}

/**
 * Who the thread is assigned to, at the start of the line under its header (the source follows,
 * `children`); for members who can assign, it is the button that lists the people. Shared by the
 * pinned thread and inbox, laid out like the app's comment card. Options are refreshed each time it opens.
 */
export function CommentAssignment({ comment, children }: { comment: CommentItem; children?: ReactNode }) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const participants = useParticipants(comment.id, open);
    const { assign } = useComments();
    const assigned = assignedText(comment);

    return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {comment.permissions?.assign ? (
            <Button ref={triggerRef} size="xs" variant="plain" aria-expanded={open}
                aria-label={`${assigned}. Change assignee`}
                className="-ml-2 font-normal text-muted-foreground hover:text-foreground"
                startDecorator={<User size={12} aria-hidden="true" />}
                endDecorator={<ExpandDown size={14} aria-hidden="true" />}
                onClick={() => setOpen(!open)}>
                {assigned}
            </Button>
        ) : (
            <span className="flex min-h-6 items-center gap-1"><User size={12} aria-hidden="true" className="shrink-0" />{assigned}</span>
        )}
        {children}
        {open && comment.permissions?.assign && <div className="flex basis-full flex-col rounded-lg border p-1" role="group" aria-label="Assign thread">
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
