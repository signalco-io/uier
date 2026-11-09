import { useContext } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName } from './@types/Comments';
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
import { assigneeAgents, commentAssignees, agentSessionLink, agentIsWorking, agentText, type AgentKind } from '../agents';
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
    return <span aria-hidden="true" data-agent={kind} className="relative -ml-0.5 flex size-3 shrink-0 items-center justify-center rounded-full border bg-background text-foreground ring-1 ring-background first:ml-0">
        <AgentMark kind={kind} size={8} />
        {working && <span data-agent-working="" className="absolute -right-1 -bottom-0.5 flex size-2 items-center justify-center rounded-full bg-background">
            <LoaderSpinner size={6} className="motion-safe:animate-spin" />
        </span>}
    </span>;
}

/** The assignee's avatar, as in the messages, with the agent's stacked on it, or the user icon while unassigned */
function AssigneeAvatar({ person }: { person: Assignee }) {
    const agents = assigneeAgents(person);
    return <span data-assignee-avatar={person.id ?? person.name} className="relative inline-flex shrink-0">
        <Avatar size="sm" aria-hidden="true" className="border bg-accent text-[11px] font-semibold text-foreground">{avatarText(person.name)}</Avatar>
        {agents.length > 0 && <span data-assignee-agents="" className="absolute -right-1 -bottom-1 flex items-center">
            {agents.slice(0, agents.length > 2 ? 1 : 2).map((agent, index) => <AgentAvatar key={agent.id ?? index} kind={agent.kind} workingUntil={agent.workingUntil} />)}
            {agents.length > 2 && <OverflowCount count={agents.length - 1} workingUntil={agents.slice(1).map(agent => agent.workingUntil)} compact />}
        </span>}
    </span>;
}

function OverflowCount({ count, workingUntil, compact = false }: { count: number; workingUntil: (string | undefined)[]; compact?: boolean }) {
    const working = useAgentWorking(workingUntil);
    return <span aria-hidden="true" data-count={`+${count}`} className={cx('relative flex items-center justify-center rounded-full border bg-background text-foreground after:content-[attr(data-count)]', compact ? '-ml-0.5 size-3 text-[8px]' : 'size-6 text-[10px]')}>
        {working && <span data-agent-working="" className="absolute -right-1 -bottom-0.5 flex size-2 items-center justify-center rounded-full bg-background"><LoaderSpinner size={6} className="motion-safe:animate-spin" /></span>}
    </span>;
}

/**
 * Who the thread is assigned to, in its header after the status (the app's comment card): the
 * assignee's avatar, named by its tooltip. Assigning is in Thread options, which opens
 * `CommentAssigneeOptions` under the header.
 */
export function CommentAssignee({ comment, className }: { comment: CommentItem; className?: string }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const people = commentAssignees(comment);
    useAgentWorking(people.flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil)));
    const assigned = workingText(comment);
    const { triggerProps, tooltip } = useIconTooltip(assigned);
    if (!people.length) return null;
    const avatars = <>
        <span role="img" tabIndex={-1} aria-label={assigned} className={cx('inline-flex shrink-0 items-center justify-center gap-3', className)} {...triggerProps}>
            {people.slice(0, 3).map((person, index) => <AssigneeAvatar key={person.id ?? index} person={person} />)}
            {people.length > 3 && <OverflowCount count={people.length - 3} workingUntil={people.slice(3).flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil))} />}
        </span>
        {tooltip}
    </>;
    // Agents are projected only for members. Older attachments without a link keep their tooltip.
    if (!people.some(person => assigneeAgents(person).some(agent => agentSessionLink(agent.sessionUrl)))) return avatars;
    return <Popper container={rootElement} side="bottom" sideOffset={8} aria-label="Assignee details"
        className={cx('max-h-[min(32rem,80dvh)] w-64 overflow-y-auto rounded-xl p-3 text-xs', floatingShadowClassName)}
        trigger={<Button variant="plain" size="sm" aria-label="Assignee details" className="rounded-full p-0">{avatars}</Button>}>
        <div className="flex flex-col gap-3">
            {people.map((person, index) => <div key={person.id ?? index} className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">{person.isMe ? 'You' : person.name}</span>
                {assigneeAgents(person).map((agent, index) => {
                    const link = agentSessionLink(agent.sessionUrl);
                    return <div key={agent.id ?? index} className="ml-2 flex min-w-0 flex-col gap-1 border-l pl-2">
                        <span className="break-words">{agentText(agent)}</span>
                        {link && <a href={link.url} className="inline-flex min-h-8 items-center self-start rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11">Open in {link.app}</a>}
                    </div>;
                })}
            </div>)}
        </div>
    </Popper>;
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
