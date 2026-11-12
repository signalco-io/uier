'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import type { ReactNode } from 'react';
import { EyeIcon, LayoutGridIcon, PencilIcon } from 'lucide-react';
import { inferAgentKind } from '@uier/toolbar/agents';
import { Badge } from '@/src/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { cn } from '@/src/lib/utils';
import { AgentAvatar } from '../comments/AgentAvatar';
import { scopeOptions } from './scopes';

/**
 * A connected app's or access token's agent mark (Claude, Codex, ChatGPT, Cursor, or the generic bot), from what
 * it calls itself. Hints go first to last: the first that names a known agent decides, so an app's own name wins
 * over the name the person gave the connection. Untrusted names only choose a picture; they never grant anything.
 */
export function ConnectionAvatar({ hints, className }: { hints: (string | null | undefined)[]; className?: string }) {
    const kind = hints.map(hint => inferAgentKind(hint)).find(candidate => candidate !== 'agent') ?? 'agent';
    return <AgentAvatar kind={kind} className={cn('size-10', className)} />;
}

/**
 * One connected app or access token in a list: its agent mark, name and where it comes from, the action (Revoke)
 * beside them; what it can reach and do below, under the name (the full width on small screens).
 */
export function ConnectionItem({ avatar, title, description, actions, children }: {
    avatar: ReactNode;
    title: ReactNode;
    /** Short facts, a dot between them: each a child element */
    description?: ReactNode;
    actions: ReactNode;
    children: ReactNode;
}) {
    return (
        <Item variant="outline" role="listitem" className="gap-3">
            <ItemMedia>{avatar}</ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none break-words">{title}</ItemTitle>
                {description && <ItemDescription className={cn('line-clamp-none break-words', factsClassName)}>{description}</ItemDescription>}
            </ItemContent>
            <ItemActions className="self-start">{actions}</ItemActions>
            <div className="flex min-w-0 basis-full flex-col gap-3 sm:pl-13">{children}</div>
        </Item>
    );
}

/** Short facts: one per line on small screens, else in one line with a dot between them (each wraps as a whole) */
export const factsClassName = "flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-1.5 sm:[&>*+*]:before:mr-1.5 sm:[&>*+*]:before:content-['·']";

/** What a connection can reach: workspaces and projects, after the projects icon */
export function ConnectionReach({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-w-0 items-start gap-2 text-sm">
            <LayoutGridIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 break-words">{children}</div>
        </div>
    );
}

/**
 * What a connection can do, one chip per operation: an eye for reading, a pencil for a change it can make
 * in uier. Read as a list with commas ("Read feedback, Reply to feedback").
 */
export function ScopeBadges({ scopes }: { scopes: readonly string[] }) {
    const { t } = useAppI18n();
    return (
        <p className="m-0 flex flex-wrap gap-1.5">
            {scopes.map((scope, index) => {
                const option = scopeOptions.find(candidate => candidate.scope === scope);
                const Icon = option?.write ? PencilIcon : EyeIcon;
                return (
                    <Badge key={scope} variant="outline" className="font-normal" data-scope={scope}>
                        {option && <Icon aria-hidden="true" data-icon="inline-start" className="text-muted-foreground" />}
                        {option ? t(option.label) : scope}
                        {index < scopes.length - 1 && <span className="sr-only">, </span>}
                    </Badge>
                );
            })}
        </p>
    );
}
