import { useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import type { CommentItem } from './@types/Comments';
import { commentPriority, priorities, priorityLabels } from '../triage';
import { newLocalId, useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';

/** Shared by an opened thread and the inbox. Guests read the label; authorized members can change it. */
export function CommentPriority({ comment }: { comment: CommentItem }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const { prioritize } = useComments();
    const announce = useAnnounce();
    // A failed request keeps its identity until the intended value changes.
    const attempt = useRef<{ priority: string; key: string } | null>(null);
    const priority = commentPriority(comment.priority);
    if (!comment.permissions?.priority) return <span className="text-xs text-muted-foreground">Priority: {priorityLabels[priority]}</span>;
    return <div className="flex flex-col gap-1">
        <Button ref={trigger} size="xs" variant="plain" aria-expanded={open} aria-label={`Priority: ${priorityLabels[priority]}. Change priority`}
            className="self-start" onClick={() => setOpen(!open)}>Priority: {priorityLabels[priority]}</Button>
        {open && <div role="group" aria-label="Set priority" className="flex flex-wrap gap-1">
            {priorities.map(value => <Button key={value} size="xs" variant="outlined" disabled={prioritize.isPending}
                onClick={async () => {
                    if (attempt.current?.priority !== value) attempt.current = { priority: value, key: newLocalId() };
                    try {
                        await prioritize.mutateAsync({ commentId: comment.id, priority: value, idempotencyKey: attempt.current.key });
                        attempt.current = null; setOpen(false); trigger.current?.focus(); announce(`Priority set to ${priorityLabels[value]}`);
                    } catch { /* Keep the intended value and key for retry. */ }
                }}>{priorityLabels[value]}</Button>)}
            <CommentsErrorMessage error={prioritize.error} />
        </div>}
    </div>;
}
