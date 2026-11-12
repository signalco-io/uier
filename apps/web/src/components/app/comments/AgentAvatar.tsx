'use client';

import { createAppTranslator } from '@/src/lib/i18n/translate';
import { useAppI18n } from '@/src/lib/i18n/client';

import { assigneeAgents, agentIsWorking, agentLabels, agentMarks, agentModelText, type AgentKind, type AssigneeAgentView } from '@uier/toolbar/agents';
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
export function AgentAvatar({ kind, workingUntil, className, compact = false }: { kind: AgentKind; workingUntil?: string; className?: string; compact?: boolean }) {
    const { t } = useAppI18n();
    const working = useAgentWorking(workingUntil);
    return (
        <span {...working ? { role: 'img', 'aria-label': t("{value0} is working now", { value0: agentLabels[kind] }) } : { 'aria-hidden': true }} data-agent={kind}
            className={cn('relative flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-foreground', className)}>
            <AgentMark kind={kind} className="size-3/5" />
            {working && <span data-agent-working="" className={cn('absolute -right-1 -bottom-0.5 flex items-center justify-center rounded-full bg-foreground text-background', compact ? 'size-2' : 'size-3')}>
                <Spinner className={cn('motion-reduce:animate-none', compact ? 'size-1.5' : 'size-2.5')} />
            </span>}
        </span>
    );
}

export type Assignee = { id: string; name: string; avatarUrl?: string; agent?: AssigneeAgentView; agents?: AssigneeAgentView[] };

/** "Assigned to Ana" or "Assigned to you, with Claude Opus 5.5 (high reasoning)": the words of the avatars below */
export function assignedLabel(assignee: Assignee | Assignee[] | undefined, userId?: string, t: import('@/src/lib/i18n/types').AppTranslator = createAppTranslator({})) {
    const people = Array.isArray(assignee) ? assignee : assignee ? [assignee] : [];
    if (!people.length) return t("Unassigned");
    return t("Assigned to {people}", { people: people.map(person => {
        const name = person.id === userId ? t("you") : person.name;
        return assigneeAgents(person).reduce((label, agent) => t("{person}, with {agent}{working}", {
            person: label, agent: `${t(agent.label)}${agent.model ? ` ${agentModelText({ label: agent.label, model: agent.model })}` : ''}${agent.reasoning ? ` (${t("{level} reasoning", { level: agent.reasoning })})` : ''}`, working: agentIsWorking(agent.workingUntil) ? t(", working now") : ''
        }), name);
    }).join('; ') });
}

/**
 * Who works on a thread, for rows and board cards: each person's 20px avatar with their AI agents stacked beside it as
 * 16px avatars (two at most, else one and a count). Up to three people, then a count. One image named by
 * `assignedLabel` (`decorative` inside a control that carries the name).
 */
export function AssigneeAvatars({ assignee, assignees, userId, decorative, className }: { assignee?: Assignee; assignees?: Assignee[]; userId?: string; decorative?: boolean; className?: string }) {
    const { t } = useAppI18n();
    const people = assignees ?? (assignee ? [assignee] : []);
    useAgentWorking(people.flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil)));
    return (
        <span role="img" {...decorative ? { 'aria-hidden': true } : { 'aria-label': assignedLabel(people, userId, t) }} className={cn('flex shrink-0 items-center gap-2', className)}>
            {people.slice(0, 3).map(person => {
                const agents = assigneeAgents(person);
                return <span key={person.id} data-assignee-avatar={person.id} className="flex shrink-0 items-center">
                    <PersonAvatar assignee={person} />
                    {agents.length > 0 && <span data-assignee-agents="" className="flex items-center">
                        {agents.slice(0, agents.length > 2 ? 1 : 2).map((agent, index) => <AgentAvatar key={agent.id ?? index} kind={agent.kind} workingUntil={agent.workingUntil} compact
                            className="-ml-1 size-4 ring-2 ring-background" />)}
                        {agents.length > 2 && <OverflowCount count={agents.length - 1} workingUntil={agents.slice(1).map(agent => agent.workingUntil)} compact />}
                    </span>}
                </span>;
            })}
            {people.length > 3 && <OverflowCount count={people.length - 3} workingUntil={people.slice(3).flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil))} />}
        </span>
    );
}

/** A compact count still reports work on an attachment that is only shown in the full card. */
function OverflowCount({ count, workingUntil, compact = false }: { count: number; workingUntil: (string | undefined)[]; compact?: boolean }) {
    const working = useAgentWorking(workingUntil);
    return <span data-assignee-overflow="" data-count={`+${count}`} className={cn('relative flex items-center justify-center rounded-full border bg-background font-medium text-foreground after:content-[attr(data-count)]',
        compact ? '-ml-1 size-4 text-[9px] ring-2 ring-background' : 'size-5 text-[10px]')}>
        {working && <span data-agent-working="" className="absolute -right-1 -bottom-0.5 flex size-2 items-center justify-center rounded-full bg-foreground text-background"><Spinner className="size-1.5 motion-reduce:animate-none" /></span>}
    </span>;
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
