import { agentMarks, agentText, type AgentKind, type AssigneeAgentView } from '@uier/toolbar/agents';
import { cn } from '@/src/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { initials } from '../initials';

/**
 * An AI agent's mark on a bordered circle, the size of the 20px avatars it sits with (`size-*` on
 * `className` scales it). Every mark is one colour, ink on light and paper on dark (BRAND.md).
 */
export function AgentAvatar({ kind, className }: { kind: AgentKind; className?: string }) {
    const mark = agentMarks[kind];
    return (
        <span aria-hidden="true" data-agent={kind}
            className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-foreground', className)}>
            <svg viewBox="0 0 24 24" focusable="false" className="size-3/5" fill={mark.stroke ? 'none' : 'currentColor'}
                {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
                {mark.paths.map(d => <path key={d} d={d} {...(mark.evenOdd ? { fillRule: 'evenodd' as const, clipRule: 'evenodd' as const } : {})} />)}
            </svg>
        </span>
    );
}

type Assignee = { id: string; name: string; avatarUrl?: string; agent?: AssigneeAgentView };

/** "Assigned to Ana" or "Assigned to you, with Claude (claude-opus-5-5)": the words of the avatars below */
export function assignedLabel(assignee: Assignee | undefined, userId?: string) {
    if (!assignee) return 'Unassigned';
    return `Assigned to ${assignee.id === userId ? 'you' : assignee.name}${assignee.agent ? `, with ${agentText(assignee.agent)}` : ''}`;
}

/**
 * Who works on a thread: the assignee's 20px avatar, with the AI agent working under them stacked on its
 * right edge. One image named by `assignedLabel`, for rows and board cards.
 */
export function AssigneeAvatars({ assignee, userId, className }: { assignee: Assignee; userId?: string; className?: string }) {
    return (
        <span role="img" aria-label={assignedLabel(assignee, userId)} className={cn('flex shrink-0 items-center', className)}>
            <PersonAvatar assignee={assignee} />
            {assignee.agent && <AgentAvatar kind={assignee.agent.kind} className="-ml-1.5 ring-2 ring-background" />}
        </span>
    );
}

/** Not `size="sm"`: its `data-[size=sm]:size-6` would win over `size-5` */
function PersonAvatar({ assignee }: { assignee: Assignee }) {
    return (
        <Avatar aria-hidden="true" className="size-5">
            {assignee.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt="" />}
            <AvatarFallback className="text-[10px] font-semibold text-foreground">{initials(assignee.name)}</AvatarFallback>
        </Avatar>
    );
}
