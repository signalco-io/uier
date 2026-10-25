import { useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import type { CommentItem } from './@types/Comments';

/** Shared by the pinned thread and inbox. Options are refreshed each time it opens. */
export function CommentAssignment({ comment }: { comment: CommentItem }) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const participants = useParticipants(comment.id, open);
    const { assign } = useComments();
    return <div className="px-4 py-1 text-xs text-muted-foreground">
        <span>Assigned to {comment.assignee?.isMe ? 'you' : comment.assignee?.name ?? 'nobody'}{comment.assignee?.unavailable ? ' (no access)' : ''}</span>
        {comment.permissions?.assign && <Button ref={triggerRef} size="xs" variant="plain" className="ml-1 pointer-coarse:h-11" aria-expanded={open} onClick={() => setOpen(!open)}>Change assignee</Button>}
        {open && comment.permissions?.assign && <div className="flex flex-col gap-1 rounded-xl border p-2" role="group" aria-label="Assign thread">
            {participants.isPending && <span role="status">Loading people...</span>}
            <CommentsErrorMessage error={participants.error ?? assign.error} />
            {[{ id: '', name: 'Unassign' }, ...(participants.data ?? [])].map(person => <Button key={person.id} variant="plain" size="sm" className="min-h-11 justify-start" disabled={assign.isPending}
                onClick={async () => {
                    try { await assign.mutateAsync({ commentId: comment.id, assigneeId: person.id || null }); setOpen(false); triggerRef.current?.focus(); }
                    catch { /* Keep the options and show the server error. */ }
                }}>{person.name}</Button>)}
        </div>}
    </div>;
}
