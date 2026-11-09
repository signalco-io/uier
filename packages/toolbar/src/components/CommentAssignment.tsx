import { Button } from '@signalco/ui-primitives/Button';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, LoaderSpinner, User } from '@signalco/ui-icons';
import { useParticipants } from '../hooks/useParticipants';
import { useComments } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { avatarText } from './CommentThreadItem';
import type { CommentAssignee as Assignee, CommentItem } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import { assigneeAgents, commentAssignees, agentIsWorking, agentText, type AgentKind } from '../agents';
import { useAgentWorking } from '../useAgentWorking';
import { AgentMark } from './AgentMark';
import { moveFocusInMenu } from '../focusKeys';

/** "Unassigned" or "Assigned to Ana": the assignee's tooltip and name, the same words as the app's comment card */
export function assignedText(comment: CommentItem) {
    const people = commentAssignees(comment);
    if (!people.length) return 'Unassigned';
    return `Assigned to ${people.map(person => `${person.isMe ? 'you' : person.name}${person.unavailable ? ' (no access)' : ''}`).join(', ')}`;
}

/** "Assigned to Ana, with Claude": the header avatar's tooltip, with the AI agent working under the assignee */
export function workingText(comment: CommentItem) {
    const people = commentAssignees(comment);
    if (!people.length) return 'Unassigned';
    return `Assigned to ${people.map(person => `${person.isMe ? 'you' : person.name}${assigneeAgents(person).map(agent => `, with ${agentText(agent)}${agentIsWorking(agent.workingUntil) ? ', working now' : ''}`).join('')}`).join('; ')}`;
}

/** The agent's one-colour mark on a bordered circle, as in the app (`@uier/toolbar/agents`) */
function AgentAvatar({ kind, workingUntil }: { kind: AgentKind; workingUntil?: string }) {
    const working = useAgentWorking(workingUntil);
    return <span aria-hidden="true" data-agent={kind} className="relative -ml-2 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-foreground ring-2 ring-background">
        <AgentMark kind={kind} />
        {working && <span data-agent-working="" className="absolute -right-1 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-background">
            <LoaderSpinner size={10} className="motion-safe:animate-spin" />
        </span>}
    </span>;
}

/** The assignee's avatar, as in the messages, with the agent's stacked on it, or the user icon while unassigned */
function AssigneeAvatar({ person }: { person: Assignee }) {
    return <span data-assignee-avatar={person.id ?? person.name} className="flex items-center">
        <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(person.name)}</Avatar>
        {assigneeAgents(person).map((agent, index) => <AgentAvatar key={agent.id ?? index} kind={agent.kind} workingUntil={agent.workingUntil} />)}
    </span>;
}

/**
 * Who the thread is assigned to, in its header after the status (the app's comment card): the
 * assignee's avatar, named by its tooltip. Assigning is in Thread options, which opens
 * `CommentAssigneeOptions` under the header.
 */
export function CommentAssignee({ comment, className }: { comment: CommentItem; className?: string }) {
    const people = commentAssignees(comment);
    useAgentWorking(people.flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil)));
    const assigned = workingText(comment);
    const { triggerProps, tooltip } = useIconTooltip(assigned);
    if (!people.length) return null;
    return <>
        <span role="img" tabIndex={-1} aria-label={assigned} className={cx('inline-flex shrink-0 items-center justify-center gap-2', className)} {...triggerProps}>
            {people.map((person, index) => <AssigneeAvatar key={person.id ?? index} person={person} />)}
        </span>
        {tooltip}
    </>;
}

/** The people to assign the thread to, under its header while `CommentAssignee` is open; refreshed each time it opens */
export function CommentAssigneeOptions({ comment, autoFocus = false, onAssigned }: { comment: CommentItem; autoFocus?: boolean; onAssigned: () => void }) {
    const participants = useParticipants(comment.id);
    const { assign } = useComments();

    // Like a menu: ↑ and ↓ move between the people; opened with A, the first has the focus
    return <div className="flex flex-col rounded-lg border p-1 text-xs text-muted-foreground" role="group" aria-label="Assign thread" onKeyDown={moveFocusInMenu}>
        {participants.isPending && <span role="status" className="px-2 py-1.5">Loading people...</span>}
        <CommentsErrorMessage error={participants.error ?? assign.error} />
        <Button variant="plain" size="sm" className="justify-start" disabled={assign.isPending} autoFocus={autoFocus}
            onClick={async () => {
                try { await assign.mutateAsync({ commentId: comment.id, assigneeId: null }); onAssigned(); }
                catch { /* Keep the error available. */ }
            }}>Unassign</Button>
        {(participants.data ?? []).map(person => {
            const checked = commentAssignees(comment).some(assignee => assignee.id === person.id);
            return <Button key={person.id} variant="plain" size="sm" className="justify-start gap-2" aria-pressed={checked} disabled={assign.isPending}
                onClick={async () => {
                    try { await assign.mutateAsync({ commentId: comment.id, assigneeIds: [person.id], mode: checked ? 'remove' : 'add' }); }
                    catch { /* Keep the options and show the server error. */ }
                }}>
                {checked && <Check size={16} aria-hidden="true" />}{person.name}
            </Button>;
        })}
        <Button variant="plain" size="sm" className="justify-start" onClick={onAssigned}>Done</Button>
    </div>;
}
