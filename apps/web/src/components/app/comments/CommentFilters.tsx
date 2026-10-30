'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { KanbanIcon, ListIcon, UserIcon, XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Toggle } from '@/src/components/ui/toggle';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import type { ReactNode } from 'react';
import { LocationFilter, type PageCount } from './LocationFilter';


/** Tab-like toggles, as `LinkTabs`' segmented filter (the projects list's Active and Done), at the height of the other filters */
const segmentedGroup = 'gap-0.5 rounded-lg bg-muted p-[3px]';
const segmentedItem = 'h-[26px] min-w-[26px] rounded-md px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm pointer-coarse:min-h-11';

/** The list's status and unread filter, then where (environment and page) and who, then the view (list or board); all kept in the URL */
export function CommentFilters({ unread, unreadCount, view, status, statusCounts, people, page, pages, environment, environments, readAction, author, summary }: {
    author?: AuthorFilter;
    readAction?: ReactNode;
    /** How many comments are shown, before the List/Board switch */
    summary?: ReactNode;
    environment?: string;
    environments: import('../../../lib/app/environments').EnvironmentOption[];
    unread: boolean;
    unreadCount: number;
    view: CommentsView;
    status: StatusFilter;
    /** Comments in each status with the other filters applied */
    statusCounts: Record<StatusFilter, number>;
    people: PeopleFilter;
    page: string | undefined;
    /** Relative URLs (paths) that have comments, with how many */
    pages: PageCount[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (name: string, value: string | undefined) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === undefined)
            params.delete(name);
        else
            params.set(name, value);
        const query = params.toString();
        router.push(`${pathname}${query ? `?${query}` : ''}#comments`);
    };

    return (
        <div className="flex w-full flex-wrap items-center gap-2">
            {/* The toolbar inbox's status tabs; the board already shows Open and Done side by side */}
            {view === 'list' && (
                <ToggleGroup
                    type="single"
                    size="sm"
                    spacing={0.5}
                    aria-label="Status"
                    className={segmentedGroup}
                    value={status}
                    onValueChange={(value) => value && go('status', value === 'open' ? undefined : value)}>
                    {(Object.keys(statusFilterLabels) as StatusFilter[]).map(value => (
                        <ToggleGroupItem key={value} value={value} className={segmentedItem}>
                            {statusFilterLabels[value]} <span className="tabular-nums text-muted-foreground">{statusCounts[value]}</span>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            )}
            {/* The toolbar inbox's Unread filter, styled as the outline buttons beside it: a blue dot and count while there is unread activity */}
            <Toggle size="sm" variant="outline" pressed={unread} onPressedChange={pressed => go('unread', pressed ? 'true' : undefined)}
                className="rounded-[min(var(--radius-md),10px)] border-border bg-background px-2.5 font-normal dark:border-input dark:bg-input/30 dark:hover:bg-input/50 aria-pressed:bg-muted dark:aria-pressed:bg-input/60">
                {unreadCount > 0 && <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />}
                Unread <span className={cn('tabular-nums', unreadCount > 0 ? 'text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>{unreadCount}</span>
            </Toggle>
            {readAction}
            {/* Then the scope, broadest first: where (site and page), then who */}
            <LocationFilter environment={environment} environments={environments} page={page} pages={pages}
                onEnvironment={value => go('environment', value)} onPage={value => go('page', value)} />
            <Select value={people} onValueChange={(value) => go('people', value === 'all' ? undefined : value)}>
                <SelectTrigger size="sm" aria-label="People" className="min-w-36">
                    <UserIcon className="text-muted-foreground" />
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {(Object.keys(peopleFilterLabels) as PeopleFilter[]).map(value => (
                            <SelectItem key={value} value={value}>{peopleFilterLabels[value]}</SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            {author && (
                <Button size="sm" variant="outline" className="max-w-full" onClick={() => go('author', undefined)} aria-label={`Clear author filter: ${author.name}`}>
                    <UserIcon data-icon="inline-start" />
                    <span className="truncate">Author: {author.name}</span>
                    <XIcon data-icon="inline-end" />
                </Button>
            )}
            {/* How the result is shown, with its count, at the end of the row */}
            <div className="ml-auto flex items-center gap-3">
                {summary}
                {/* Icon-only tabs; the tooltip and the accessible name say which */}
                <ToggleGroup
                    type="single"
                    size="sm"
                    spacing={0.5}
                    aria-label="View"
                    className={segmentedGroup}
                    value={view}
                    onValueChange={(value) => value && go('view', value === 'board' ? 'board' : undefined)}>
                    {([['list', 'List', ListIcon], ['board', 'Board', KanbanIcon]] as const).map(([value, label, Icon]) => (
                        <Tooltip key={value}>
                            <TooltipTrigger asChild>
                                <ToggleGroupItem value={value} aria-label={label} className={cn(segmentedItem, 'px-0 pointer-coarse:min-w-11')}>
                                    <Icon />
                                </ToggleGroupItem>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    ))}
                </ToggleGroup>
            </div>
        </div>
    );
}
