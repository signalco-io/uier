'use client';

import { priorities, priorityLabels, MAX_FEEDBACK_SEARCH, type CommentPriority } from '@uier/toolbar/triage';
import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { KanbanIcon, ListFilterIcon, ListIcon, SearchIcon, UserIcon, XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/src/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/src/components/ui/input-group';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import type { EnvironmentOption } from '../../../lib/app/environments';
import { peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import { LocationFilter, type PageCount } from './LocationFilter';
import { pageFilterBase } from './pageFilter';

/** Tab-like toggles, as `LinkTabs`' segmented filter (the projects list's Active and Done) */
const segmentedGroup = 'gap-0.5 rounded-lg bg-muted p-[3px]';
const segmentedItem = 'h-[26px] min-w-[26px] shrink-0 rounded-md px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm pointer-coarse:min-h-11';

/** A filter in effect, under the bar: its name and a button that clears it */
function FilterChip({ label, clearLabel = `Clear filter: ${label}`, icon, onClear }: { label: string; clearLabel?: string; icon?: React.ReactNode; onClear: () => void }) {
    return (
        <Button size="xs" variant="outline" className="max-w-full font-normal pointer-coarse:min-h-11" aria-label={clearLabel} onClick={onClear}>
            {icon}
            <span className="truncate">{label}</span>
            <XIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
    );
}

/**
 * Search, the status tabs and one Filter button (priority, environment and page, people, unread);
 * the filters in effect show under the bar, each with its own clear button. All kept in the URL.
 */
export function CommentFilters({ unread, unreadCount, view, status, statusCounts, people, page, pages, environment, environments, author, search, onSearch, priority }: {
    search: string;
    onSearch: (value: string) => void;
    priority?: CommentPriority;
    author?: AuthorFilter;
    environment?: string;
    environments: EnvironmentOption[];
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
    const searchRef = useRef<HTMLInputElement>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (changes: Record<string, string | undefined>) => {
        const params = new URLSearchParams(searchParams.toString());
        if (search) params.set('q', search); else params.delete('q');
        for (const [name, value] of Object.entries(changes)) {
            if (value === undefined) params.delete(name);
            else params.set(name, value);
        }
        const query = params.toString();
        const href = `${pathname}${query ? `?${query}` : ''}#comments`;
        // Environment and author are server scopes; the rest filter what is already loaded
        if ('environment' in changes || 'author' in changes) router.push(href, { scroll: false });
        else window.history.pushState(null, '', href);
    };

    const environmentLabel = environment && environment !== 'all'
        ? environments.find(option => option.id === environment)?.label
            ?? (environment === 'removed' ? 'Removed addresses' : environment === 'unknown' ? 'Source not recorded' : environment)
        : undefined;
    const pagePrefix = page ? pageFilterBase(page) : undefined;
    const chips = [
        priority && { key: 'priority', label: `${priorityLabels[priority]} priority`, clear: () => go({ priority: undefined }) },
        unread && { key: 'unread', label: 'Unread', clear: () => go({ unread: undefined }) },
        environmentLabel && { key: 'environment', label: environmentLabel, clear: () => go({ environment: undefined, page: undefined }) },
        page && { key: 'page', label: pagePrefix !== undefined ? `${pagePrefix}/…` : page, clear: () => go({ page: undefined }) },
        people !== 'all' && { key: 'people', label: peopleFilterLabels[people], clear: () => go({ people: undefined }) }
    ].filter(Boolean) as { key: string; label: string; clear: () => void }[];
    const active = chips.length + (author ? 1 : 0);

    return (
        <div className="flex w-full min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
                <InputGroup className="min-w-0 flex-1 sm:max-w-80 pointer-coarse:min-h-11">
                    <InputGroupAddon><SearchIcon /></InputGroupAddon>
                    <InputGroupInput ref={searchRef} id="feedback-search" type="search" aria-label="Search feedback" maxLength={MAX_FEEDBACK_SEARCH} className="pointer-coarse:min-h-11"
                        placeholder="Search feedback" value={search} onChange={event => onSearch(event.target.value)} />
                    {search && (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => { onSearch(''); searchRef.current?.focus(); }}>
                                <XIcon />
                            </InputGroupButton>
                        </InputGroupAddon>
                    )}
                </InputGroup>
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                    {/* Named by its words: "Filter", or "Filter 2" with two in effect */}
                    <PopoverTrigger render={<Button variant="outline" className="shrink-0 pointer-coarse:min-h-11" />}>
                        <ListFilterIcon data-icon="inline-start" />
                        Filter
                        {active > 0 && <Badge variant="secondary" className="h-5 min-w-5 px-1.5 tabular-nums">{active}</Badge>}
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                        <PopoverHeader><PopoverTitle>Filter comments</PopoverTitle></PopoverHeader>
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel htmlFor="filter-priority">Priority</FieldLabel>
                                <Select items={{ all: 'All priorities', ...priorityLabels }} value={priority ?? 'all'} onValueChange={value => go({ priority: value === 'all' ? undefined : value ?? undefined })}>
                                    <SelectTrigger id="filter-priority" aria-label="Priority filter" className="w-full pointer-coarse:min-h-11"><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectGroup>
                                        <SelectItem className="pointer-coarse:min-h-11" value="all">All priorities</SelectItem>
                                        {priorities.map(value => <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}>{priorityLabels[value]}</SelectItem>)}
                                    </SelectGroup></SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldTitle>Environment and page</FieldTitle>
                                <LocationFilter environment={environment} environments={environments} page={page} pages={pages} triggerClassName="w-full max-w-none"
                                    onEnvironment={value => go({ environment: value })} onPage={value => go({ page: value })} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="filter-people">People</FieldLabel>
                                <Select items={peopleFilterLabels} value={people} onValueChange={value => go({ people: value === 'all' ? undefined : value ?? undefined })}>
                                    <SelectTrigger id="filter-people" aria-label="People" className="w-full pointer-coarse:min-h-11">
                                        <UserIcon className="text-muted-foreground" />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent><SelectGroup>
                                        {(Object.keys(peopleFilterLabels) as PeopleFilter[]).map(value => (
                                            <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}>{peopleFilterLabels[value]}</SelectItem>
                                        ))}
                                    </SelectGroup></SelectContent>
                                </Select>
                            </Field>
                            <Field orientation="horizontal" className="pointer-coarse:min-h-11">
                                <Checkbox id="filter-unread" checked={unread} onCheckedChange={checked => go({ unread: checked ? 'true' : undefined })} className="pointer-coarse:after:-inset-3.5" />
                                <FieldLabel htmlFor="filter-unread" className="font-normal">
                                    Only unread
                                    <span className={cn('tabular-nums', unreadCount > 0 ? 'text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>{unreadCount}</span>
                                </FieldLabel>
                            </Field>
                            {active > 0 && (
                                <Button variant="ghost" size="sm" className="self-start pointer-coarse:min-h-11"
                                    onClick={() => { go({ priority: undefined, unread: undefined, environment: undefined, page: undefined, people: undefined, author: undefined }); setFiltersOpen(false); }}>
                                    Clear filters
                                </Button>
                            )}
                        </FieldGroup>
                    </PopoverContent>
                </Popover>
                {/* Icon-only tabs; the tooltip and the accessible name say which */}
                <ToggleGroup size="sm" spacing={0.5} aria-label="View" className={cn(segmentedGroup, 'ml-auto shrink-0')} value={[view]}
                    // A new layout starts with no thread open (the board would open it in a sheet over itself)
                    onValueChange={([value]) => value && go({ view: value === 'board' ? 'board' : undefined, comment: undefined })}>
                    {([['list', 'List', ListIcon], ['board', 'Board', KanbanIcon]] as const).map(([value, label, Icon]) => (
                        <Tooltip key={value}>
                            <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} className={cn(segmentedItem, 'px-0 pointer-coarse:min-w-11')} />}>
                                <Icon />
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    ))}
                </ToggleGroup>
            </div>
            {/* The toolbar inbox's status tabs; the board shows the three statuses side by side */}
            {view === 'list' && (
                <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
                    <ToggleGroup size="sm" spacing={0.5} aria-label="Status" className={cn(segmentedGroup, 'w-max')} value={[status]}
                        onValueChange={([value]) => value && go({ status: value === 'open' ? undefined : value })}>
                        {(Object.keys(statusFilterLabels) as StatusFilter[]).map(value => (
                            <ToggleGroupItem key={value} value={value} className={segmentedItem}>
                                {statusFilterLabels[value]} <span className="tabular-nums text-muted-foreground">{statusCounts[value]}</span>
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </div>
            )}
            {active > 0 && (
                <div role="group" aria-label="Filters in effect" className="flex flex-wrap items-center gap-1.5">
                    {chips.map(chip => <FilterChip key={chip.key} label={chip.label} onClear={chip.clear} />)}
                    {author && (
                        <FilterChip label={`Author: ${author.name}`} clearLabel={`Clear author filter: ${author.name}`}
                            icon={<UserIcon data-icon="inline-start" />} onClear={() => go({ author: undefined })} />
                    )}
                </div>
            )}
        </div>
    );
}
