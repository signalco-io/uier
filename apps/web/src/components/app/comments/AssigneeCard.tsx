'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { assigneeAgents, agentModelText, modelName, reasoningText, type AssigneeAgentView } from '@uier/toolbar/agents';
import { useAgentWorking } from '@uier/toolbar/agent-working';
import { cn } from '@/src/lib/utils';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { hoverPopoverTrigger } from '../hoverPopover';
import { AgentAvatar, AssigneeAvatars, assignedLabel, PersonAvatar, type Assignee } from './AgentAvatar';
import { RelativeTime } from './DateTime';
import { AgentSessionLink } from './AgentSessionLink';

/**
 * The assignee's avatars on a row or board card (`AssigneeAvatars`). Hovering them shows who the thread is
 * assigned to and the AI agent working under them: whether it is working now and when it started beside its name, then its model by name, reasoning level and session.
 * A mouse click still opens the thread (`onPress`, the row's link); the keyboard (Enter on the focused
 * avatars) and a tap open the card instead. Guests get no agent in their views, so they see the assignee only.
 */
export function AssigneeCard({ assignees, userId, subject, tabbable = true, onPress, className }: {
    assignees: Assignee[];
    /** Which thread the avatars belong to, after their name ("comment #12"): every row has them, so the names tell them apart */
    subject?: string;
    /** The signed-in member is the assignee: "You" */
    userId?: string;
    /** In the Tab order, like the row's link (the inbox list keeps one row there) */
    tabbable?: boolean;
    /** A mouse click: what clicking the rest of the row does */
    onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
    className?: string;
}) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const pointer = useRef<string>('');
    // Opened by the keyboard or a tap, focus goes to the card itself, not to its first cut-off line (and its tooltip)
    const popup = useRef<HTMLDivElement>(null);
    useAgentWorking(assignees.flatMap(person => assigneeAgents(person).map(agent => agent.workingUntil)));
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger {...hoverPopoverTrigger} delay={200} data-assignee-card="" aria-label={withSubject(assignedLabel(assignees, userId, t), subject)} tabIndex={tabbable ? undefined : -1}
                onPointerDown={event => { pointer.current = event.pointerType; }}
                onClick={event => {
                    // Keyboard clicks have no detail; a tap has no hover to show the card
                    if (event.detail === 0 || pointer.current === 'touch' || !onPress) return;
                    event.preventBaseUIHandler();
                    setOpen(false);
                    onPress(event);
                }}
                // A short delay: a pointer crossing the list does not flash a card per row. Above the row's link; on a touch screen the tap target reaches 44px around the 20px avatars
                className={cn('relative z-10 -m-0.5 flex shrink-0 rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-m-3 pointer-coarse:p-3', className)}>
                <AssigneeAvatars assignees={assignees} decorative />
            </PopoverTrigger>
            <PopoverContent ref={popup} initialFocus={popup} align="end" aria-label={t("Assignee details")} className="max-h-[min(32rem,80dvh)] w-72 gap-2 overflow-y-auto p-2">
                {assignees.map(assignee => <div key={assignee.id} data-assignee-details={assignee.id} className="flex min-w-0 flex-col gap-1">
                    <Item size="xs">
                        <ItemMedia><PersonAvatar assignee={assignee} className="size-8" initialsClassName="text-xs" /></ItemMedia>
                        <ItemContent className="min-w-0">
                            <ItemDescription>{t("Assigned to")}</ItemDescription>
                            <CutText full={assignee.id === userId ? t("You") : assignee.name} render={<ItemTitle className="block max-w-full truncate" />} />
                        </ItemContent>
                    </Item>
                    {/* The line runs down from the centre of the person's 32px avatar: the item's 10px inset plus half the avatar, less half the 1px line */}
                    {assigneeAgents(assignee).length > 0 && <div data-assignee-agents="" className="ml-[25.5px] flex min-w-0 flex-col gap-1 border-l pl-1.5">
                        {assigneeAgents(assignee).map((agent, index) => <AgentDetails key={agent.id ?? index} agent={agent} />)}
                    </div>}
                </div>)}
            </PopoverContent>
        </Popover>
    );
}

/** "Linked pull request, comment #12": a row's control named for its own thread */
export function withSubject(label: string, subject?: string) {
    return subject ? `${label}, ${subject}` : label;
}

function AgentDetails({ agent }: { agent: AssigneeAgentView }) {
    const { t } = useAppI18n();
    const working = useAgentWorking(agent.workingUntil);
    return (
        <Item size="xs">
            <ItemMedia><AgentAvatar kind={agent.kind} workingUntil={agent.workingUntil} className="size-6" /></ItemMedia>
            <ItemContent className="min-w-0">
                {/* The header: the name, then whether it is working and when it started, compact on the same line; the start gives way first */}
                <div data-agent-header="" className="flex min-w-0 items-baseline gap-1.5">
                    <CutText full={agent.label} render={<ItemTitle className="block min-w-0 max-w-[60%] shrink-0 truncate" />} />
                    {(working || agent.setAt) && <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                        {working && <span className="shrink-0">{t("Working now")}</span>}
                        {working && agent.setAt && <span aria-hidden="true" className="shrink-0">·</span>}
                        {agent.setAt && <span data-agent-since="" className="min-w-0 truncate">{t("Started ")}<RelativeTime value={agent.setAt} short /></span>}
                    </span>}
                </div>
                {/* By name like the thread's Assignee field, the reported id as its title; an unknown id as it is, in mono */}
                {agent.model
                    ? <CutText data-agent-model="" title={agent.model} full={<>{agentModelText({ label: agent.label, model: agent.model })}{modelName(agent.model) && <span className="block font-mono">{agent.model}</span>}</>}
                        render={<ItemDescription className={modelName(agent.model) ? 'truncate' : 'truncate font-mono'} />}>
                        {agentModelText({ label: agent.label, model: agent.model })}
                    </CutText>
                    : <ItemDescription className="truncate">{t("No model given")}</ItemDescription>}
                {agent.reasoning && <CutText full={t("{level} reasoning", { level: agent.reasoning })} render={<ItemDescription className="truncate" />} />}
                {agent.sessionId && <CutText data-agent-session="" full={<span className="font-mono break-all">{agent.sessionId}</span>} render={<ItemDescription className="truncate" />}>
                    {t("Session ")}<span className="font-mono">{agent.sessionId}</span>
                </CutText>}
                <AgentSessionLink sessionUrl={agent.sessionUrl} />
            </ItemContent>
        </Item>
    );
}

/**
 * One line of the card cut off with an ellipsis. Only while it is cut, its full text shows in a tooltip on hover and
 * on keyboard focus (the line joins the Tab order then); a line that fits keeps its `title`, if any, and no tab stop.
 * The DOM always holds the whole text, so a screen reader reads it in full either way.
 */
function CutText({ full, render, children, title, ...props }: {
    /** The whole value, shown in the tooltip */
    full: ReactNode;
    /** The line's element (`ItemTitle`, `ItemDescription`) with its truncating classes */
    render: ReactElement<Record<string, unknown>>;
    children?: ReactNode;
    title?: string;
    'data-agent-model'?: string;
    'data-agent-session'?: string;
}) {
    // The line's own element (`render`), not a button
    const ref = useRef<HTMLButtonElement>(null);
    const [cut, setCut] = useState(false);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const measure = () => setCut(element.scrollWidth > element.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return (
        <Tooltip disabled={!cut} disableHoverablePopup>
            <TooltipTrigger ref={ref} render={render} tabIndex={cut ? 0 : undefined} title={cut ? undefined : title} {...props}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {children ?? full}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="block max-w-72 break-words">{full}</TooltipContent>
        </Tooltip>
    );
}
