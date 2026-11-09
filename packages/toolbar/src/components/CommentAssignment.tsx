import { Button } from '@signalco/ui-primitives/Button';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { cx } from '@signalco/ui-primitives/cx';
import { User } from '@signalco/ui-icons';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { avatarText } from './CommentThreadItem';
import type { CommentItem } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import { agentText, type AgentKind } from '../agents';
import { AgentMark } from './AgentMark';

/** "Unassigned" or "Assigned to Ana": the assignee's tooltip and name, the same words as the app's comment card */
export function assignedText(comment: CommentItem) {
    if (!comment.assignee) return 'Unassigned';
    return `Assigned to ${comment.assignee.isMe ? 'you' : comment.assignee.name}${comment.assignee.unavailable ? ' (no access)' : ''}`;
}

/** "Assigned to Ana, with Claude": the header avatar's tooltip, with the AI agent working under the assignee */
export function workingText(comment: CommentItem) {
    const agent = comment.assignee?.agent;
    return agent ? `${assignedText(comment)}, with ${agentText(agent)}` : assignedText(comment);
}

/** The agent's one-colour mark on a bordered circle, as in the app (`@uier/toolbar/agents`) */
function AgentAvatar({ kind }: { kind: AgentKind }) {
    return <span aria-hidden="true" data-agent={kind} className="-ml-2 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-foreground ring-2 ring-background">
        <AgentMark kind={kind} />
    </span>;
}

/** The assignee's avatar, as in the messages, with the agent's stacked on it, or the user icon while unassigned */
function AssigneeAvatar({ comment }: { comment: CommentItem }) {
    if (!comment.assignee) return <User size={16} aria-hidden="true" />;
    return <span className="flex items-center">
        <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(comment.assignee.name)}</Avatar>
        {comment.assignee.agent && <AgentAvatar kind={comment.assignee.agent.kind} />}
    </span>;
}

/**
 * Who the thread is assigned to, in its header after the status (the app's comment card): the
 * assignee's avatar, named by its tooltip. Assigning is in Thread options, which opens
 * `CommentAssigneeOptions` under the header.
 */
export function CommentAssignee({ comment, className }: { comment: CommentItem; className?: string }) {
    const assigned = workingText(comment);
    const { triggerProps, tooltip } = useIconTooltip(assigned);
    if (!comment.assignee) return null;
    return <>
        <span role="img" tabIndex={-1} aria-label={assigned} className={cx('inline-flex shrink-0 items-center justify-center', className)} {...triggerProps}>
            <AssigneeAvatar comment={comment} />
        </span>
        {tooltip}
    </>;
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
