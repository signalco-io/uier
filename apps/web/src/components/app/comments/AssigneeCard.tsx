'use client';

import { useRef, useState, type MouseEvent } from 'react';
import { agentModelText, modelName, reasoningText } from '@uier/toolbar/agents';
import { cn } from '@/src/lib/utils';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
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
    const agent = assignee.agent;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger {...hoverPopoverTrigger} delay={200} data-assignee-card="" aria-label={assignedLabel(assignee, me ? assignee.id : undefined)} tabIndex={tabbable ? undefined : -1}
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
            <PopoverContent align="end" aria-label="Assignee details" className="w-72 gap-1 p-2">
                <Item size="xs">
                    <ItemMedia><PersonAvatar assignee={assignee} className="size-8" initialsClassName="text-xs" /></ItemMedia>
                    <ItemContent className="min-w-0">
                        <ItemDescription>Assigned to</ItemDescription>
                        <ItemTitle className="max-w-full truncate">{me ? 'You' : assignee.name}</ItemTitle>
                    </ItemContent>
                </Item>
                {agent && (
                    <Item size="xs" variant="muted">
                        <ItemMedia><AgentAvatar kind={agent.kind} className="size-8" /></ItemMedia>
                        <ItemContent className="min-w-0">
                            <ItemTitle>{agent.label}</ItemTitle>
                            {/* By name like the thread's Assignee field, the reported id as its title; an unknown id as it is, in mono */}
                            {agent.model
                                ? <ItemDescription data-agent-model="" title={agent.model} className={modelName(agent.model) ? 'truncate' : 'truncate font-mono'}>
                                    {agentModelText({ label: agent.label, model: agent.model })}
                                </ItemDescription>
                                : <ItemDescription className="truncate">No model given</ItemDescription>}
                            {agent.reasoning && <ItemDescription className="truncate">{reasoningText(agent.reasoning)}</ItemDescription>}
                            {agent.setAt && <ItemDescription data-agent-since="">Started <RelativeTime value={agent.setAt} /></ItemDescription>}
                            {agent.sessionId && <ItemDescription className="truncate">Session <span className="font-mono">{agent.sessionId}</span></ItemDescription>}
                        </ItemContent>
                    </Item>
                )}
            </PopoverContent>
        </Popover>
    );
}
