'use client';

import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { agentModelText, modelName, reasoningText } from '@uier/toolbar/agents';
import { useAgentWorking } from '@uier/toolbar/agent-working';
import { cn } from '@/src/lib/utils';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { hoverPopoverTrigger } from '../hoverPopover';
import { AgentAvatar, AssigneeAvatars, assignedLabel, PersonAvatar, type Assignee } from './AgentAvatar';
import { RelativeTime } from './DateTime';

/**
 * The assignee's avatars on a row or board card (`AssigneeAvatars`). Hovering them shows who the thread is
 * assigned to and the AI agent working under them: its model by name, reasoning level, when it started and its session.
 * A mouse click still opens the thread (`onPress`, the row's link); the keyboard (Enter on the focused
 * avatars) and a tap open the card instead. Guests get no agent in their views, so they see the assignee only.
 */
export function AssigneeCard({ assignee, me, tabbable = true, onPress, className }: {
    assignee: Assignee;
    /** The signed-in member is the assignee: "You" */
    me?: boolean;
    /** In the Tab order, like the row's link (the inbox list keeps one row there) */
    tabbable?: boolean;
    /** A mouse click: what clicking the rest of the row does */
    onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const pointer = useRef<string>('');
    // Opened by the keyboard or a tap, focus goes to the card itself, not to its first cut-off line (and its tooltip)
    const popup = useRef<HTMLDivElement>(null);
    const agent = assignee.agent;
    const working = useAgentWorking(agent?.workingUntil);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger {...hoverPopoverTrigger} delay={200} data-assignee-card="" aria-label={assignedLabel(assignee, me ? assignee.id : undefined, working)} tabIndex={tabbable ? undefined : -1}
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
                <AssigneeAvatars assignee={assignee} decorative />
            </PopoverTrigger>
            <PopoverContent ref={popup} initialFocus={popup} align="end" aria-label="Assignee details" className="w-72 gap-1 p-2">
                <Item size="xs">
                    <ItemMedia><PersonAvatar assignee={assignee} className="size-8" initialsClassName="text-xs" /></ItemMedia>
                    <ItemContent className="min-w-0">
                        <ItemDescription>Assigned to</ItemDescription>
                        <CutText full={me ? 'You' : assignee.name} render={<ItemTitle className="block max-w-full truncate" />} />
                    </ItemContent>
                </Item>
                {agent && (
                    <Item size="xs" variant="muted">
                        <ItemMedia><AgentAvatar kind={agent.kind} workingUntil={agent.workingUntil} className="size-8" /></ItemMedia>
                        <ItemContent className="min-w-0">
                            <CutText full={agent.label} render={<ItemTitle className="block max-w-full truncate" />} />
                            {working && <ItemDescription>Working now</ItemDescription>}
                            {/* By name like the thread's Assignee field, the reported id as its title; an unknown id as it is, in mono */}
                            {agent.model
                                ? <CutText data-agent-model="" title={agent.model} full={<>{agentModelText({ label: agent.label, model: agent.model })}{modelName(agent.model) && <span className="block font-mono">{agent.model}</span>}</>}
                                    render={<ItemDescription className={modelName(agent.model) ? 'truncate' : 'truncate font-mono'} />}>
                                    {agentModelText({ label: agent.label, model: agent.model })}
                                </CutText>
                                : <ItemDescription className="truncate">No model given</ItemDescription>}
                            {agent.reasoning && <CutText full={reasoningText(agent.reasoning)} render={<ItemDescription className="truncate" />} />}
                            {agent.setAt && <ItemDescription data-agent-since="">Started <RelativeTime value={agent.setAt} /></ItemDescription>}
                            {agent.sessionId && <CutText data-agent-session="" full={<span className="font-mono break-all">{agent.sessionId}</span>} render={<ItemDescription className="truncate" />}>
                                Session <span className="font-mono">{agent.sessionId}</span>
                            </CutText>}
                        </ItemContent>
                    </Item>
                )}
            </PopoverContent>
        </Popover>
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
