'use client';

import { agentIsWorking, agentLabels, agentMarks, agentText, type AgentKind, type AssigneeAgentView } from '@uier/toolbar/agents';
import { useAgentWorking } from '@uier/toolbar/agent-working';
import { Spinner } from '@/src/components/ui/spinner';
import { cn } from '@/src/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { initials } from '../initials';

/**
 * An AI agent's product logo on its own (Claude, Codex, ChatGPT, Cursor, or a generic bot for any other),
 * one colour in the text colour (BRAND.md), 16px like a button's icon (`size-*` on `className` scales it).
 * Decorative: the agent's name is always written beside it or in the surrounding label.
 */
export function AgentMark({ kind, className }: { kind: AgentKind; className?: string }) {
    const mark = agentMarks[kind];
    return (
        <svg aria-hidden="true" data-agent-mark={kind} viewBox="0 0 24 24" focusable="false" className={cn('size-4 shrink-0', className)}
            fill={mark.stroke ? 'none' : 'currentColor'}
            {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
            {mark.paths.map(d => <path key={d} d={d} {...(mark.evenOdd ? { fillRule: 'evenodd' as const, clipRule: 'evenodd' as const } : {})} />)}
        </svg>
    );
}

/**
 * An AI agent's mark on a bordered circle, the size of the 20px avatars it sits with (`size-*` on
 * `className` scales it). Every mark is one colour, ink on light and paper on dark (BRAND.md).
 */
export function AgentAvatar({ kind, workingUntil, className }: { kind: AgentKind; workingUntil?: string; className?: string }) {
    const working = useAgentWorking(workingUntil);
    return (
        <span {...working ? { role: 'img', 'aria-label': `${agentLabels[kind]} is working now` } : { 'aria-hidden': true }} data-agent={kind}
            className={cn('relative flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-foreground', className)}>
            <AgentMark kind={kind} className="size-3/5" />
            {working && <span data-agent-working="" className="absolute -right-1 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-background">
                <Spinner className="size-2.5 motion-reduce:animate-none" />
            </span>}
        </span>
    );
}

export type Assignee = { id: string; name: string; avatarUrl?: string; agent?: AssigneeAgentView };

/** "Assigned to Ana" or "Assigned to you, with Claude Opus 5.5 (high reasoning)": the words of the avatars below */
export function assignedLabel(assignee: Assignee | undefined, userId?: string, working = agentIsWorking(assignee?.agent?.workingUntil)) {
    if (!assignee) return 'Unassigned';
    return `Assigned to ${assignee.id === userId ? 'you' : assignee.name}${assignee.agent ? `, with ${agentText(assignee.agent)}${working ? ', working now' : ''}` : ''}`;
}

/**
 * Who works on a thread: the assignee's 20px avatar, with the AI agent working under them stacked on its
 * right edge. One image named by `assignedLabel` (`decorative` inside a control that carries the name), for rows
 * and board cards.
 */
export function AssigneeAvatars({ assignee, userId, decorative, className }: { assignee: Assignee; userId?: string; decorative?: boolean; className?: string }) {
    const working = useAgentWorking(assignee.agent?.workingUntil);
    return (
        <span {...decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': assignedLabel(assignee, userId, working) }} className={cn('flex shrink-0 items-center', className)}>
            <PersonAvatar assignee={assignee} />
            {assignee.agent && <AgentAvatar kind={assignee.agent.kind} workingUntil={assignee.agent.workingUntil} className="-ml-1.5 ring-2 ring-background" />}
        </span>
    );
}

/** The assignee's 20px avatar (`size-*` on `className` scales it). Not `size="sm"`: its `data-[size=sm]:size-6` would win over `size-5` */
export function PersonAvatar({ assignee, className, initialsClassName }: { assignee: Pick<Assignee, 'name' | 'avatarUrl'>; className?: string; initialsClassName?: string }) {
    return (
        <Avatar aria-hidden="true" className={cn('size-5', className)}>
            {assignee.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt="" />}
            <AvatarFallback className={cn('text-[10px] font-semibold text-foreground', initialsClassName)}>{initials(assignee.name)}</AvatarFallback>
        </Avatar>
    );
}
