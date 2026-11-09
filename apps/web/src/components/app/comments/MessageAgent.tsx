'use client';

import { reasoningText } from '@uier/toolbar/agents';
import { Button } from '@/src/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import type { ProjectCommentAuthor } from '../../../lib/app/projectComments';
import { hoverPopoverTrigger } from '../hoverPopover';
import { AgentAvatar, AgentMark } from './AgentAvatar';

/**
 * "via Claude" after a message's author: the AI agent that wrote it for them through a coding tool
 * connection, with its logo. Hovering or clicking it shows the model and reasoning level it gave and the
 * connection it came through. The message is still the person's: they edit and delete it as their own.
 */
export function MessageAgent({ author }: { author: ProjectCommentAuthor }) {
    const agent = author.agent;
    if (!agent) return null;
    return (
        <Popover>
            <PopoverTrigger {...hoverPopoverTrigger} render={<Button variant="ghost" size="xs" data-message-agent={agent.kind}
                className="shrink-0 gap-1 px-1 font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" />}>
                via
                <AgentMark kind={agent.kind} className="size-3.5 text-foreground" />
                <span className="text-foreground">{agent.label}</span>
            </PopoverTrigger>
            <PopoverContent align="start" aria-label={`${agent.label} details`} className="w-72 gap-3 p-3">
                <p className="m-0 text-sm">{agent.label} wrote this for {author.isMe ? 'you' : author.name}.</p>
                <Item size="xs" variant="muted">
                    <ItemMedia><AgentAvatar kind={agent.kind} className="size-8" /></ItemMedia>
                    <ItemContent className="min-w-0">
                        <ItemTitle>{agent.label}</ItemTitle>
                        <ItemDescription className="truncate font-mono">{agent.model ?? 'No model given'}</ItemDescription>
                        {agent.reasoning && <ItemDescription className="truncate">{reasoningText(agent.reasoning)}</ItemDescription>}
                    </ItemContent>
                </Item>
                {agent.connection && <p className="m-0 text-xs break-words text-muted-foreground">Connection: {agent.connection}</p>}
            </PopoverContent>
        </Popover>
    );
}
