'use client';

import { assigneeAgents, agentIsWorking, agentLabels, agentMarks, agentText, type AgentKind, type AssigneeAgentView } from '@uier/toolbar/agents';
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
            {mark.paths.map(d => <path key={d} d={d} />)}
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

export type Assignee = { id: string; name: string; avatarUrl?: string; agent?: AssigneeAgentView; agents?: AssigneeAgentView[] };

/** "Assigned to Ana" or "Assigned to you, with Claude Opus 5.5 (high reasoning)": the words of the avatars below */
export function assignedLabel(assignee: Assignee | Assignee[] | undefined, userId?: string) {
    const people = Array.isArray(assignee) ? assignee : assignee ? [assignee] : [];
    if (!people.length) return 'Unassigned';
    return `Assigned to ${people.map(person => `${person.id === userId ? 'you' : person.name}${assigneeAgents(person).map(agent => `, with ${agentText(agent)}${agentIsWorking(agent.workingUntil) ? ', working now' : ''}`).join('')}`).join('; ')}`;
}

/** People are grouped separately; every agent belongs to one person's avatar. */
export function AssigneeAvatars({ assignee, assignees, userId, decorative, className }: { assignee?: Assignee; assignees?: Assignee[]; userId?: string; decorative?: boolean; className?: string }) {
    const people = assignees ?? (assignee ? [assignee] : []);
    useAgentWorking(people.flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil)));
    return (
        <span role="img" {...decorative ? { 'aria-hidden': true } : { 'aria-label': assignedLabel(people, userId) }} className={cn('flex shrink-0 items-center gap-2', className)}>
            {people.map(person => <span key={person.id} data-assignee-avatar={person.id} className="flex shrink-0 items-center">
                <PersonAvatar assignee={person} />
                {assigneeAgents(person).map((agent, index) => <AgentAvatar key={agent.id ?? index} kind={agent.kind} workingUntil={agent.workingUntil} className="-ml-1.5 ring-2 ring-background" />)}
            </span>)}
        </span>
    );
}

/** The assignee's 20px avatar (`size-*` on `className` scales it). Not `size="sm"`: its `data-[size=sm]:size-6` would win over `size-5` */
export function PersonAvatar({ assignee, className, initialsClassName }: { assignee: Pick<Assignee, 'name' | 'avatarUrl'>; className?: string; initialsClassName?: string }) {
    return (
        <Avatar role="img" aria-hidden="true" className={cn('size-5', className)}>
            {assignee.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt="" />}
            {/* Initials are a decorative glyph; the enclosing control names the person. */}
            <AvatarFallback data-initials={initials(assignee.name)} className={cn('text-[10px] font-semibold text-foreground after:content-[attr(data-initials)]', initialsClassName)} />
        </Avatar>
    );
}
