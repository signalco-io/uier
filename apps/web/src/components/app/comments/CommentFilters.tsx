'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { priorities, priorityLabels, MAX_FEEDBACK_SEARCH, type CommentPriority } from '@uier/toolbar/triage';
import { Fragment, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDownIcon, KanbanIcon, ListFilterIcon, ListIcon, SearchIcon, UserIcon, XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { setUrlSearchParams, urlWith } from '@/src/hooks/use-url-search-params';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/src/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/src/components/ui/input-group';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import type { EnvironmentOption } from '../../../lib/app/environments';
import { activeStatusFilters, isActiveStatusFilter, peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import { LocationFilter, type PageCount } from './LocationFilter';
import { pageFilterBase } from './pageFilter';
import { PriorityFlag } from './PriorityFlag';
import { StateDot } from './CommentStatus';
import { useKeyShortcutLabel } from '../keyboard/keys';

/** Tab-like toggles, as `LinkTabs`' segmented filter (the projects list's Active and Done) */
const segmentedGroup = 'gap-0.5 rounded-lg bg-muted p-[3px]';
const segmentedItem = 'h-[26px] min-w-[26px] shrink-0 rounded-md px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm pointer-coarse:min-h-11';
/** A status tab grows into the room a full-width group has on a phone */
const statusTab = 'grow sm:grow-0';

/** A filter in effect, left of the Filter button: the filter's name, what it is set to and a button that clears it */
function FilterChip({ name, value, icon, onClear }: { name?: string; value: string; icon?: React.ReactNode; onClear: () => void }) {
    const { t } = useAppI18n();
    return (
        <Button size="xs" variant="outline" className="max-w-full font-normal pointer-coarse:min-h-11"
            aria-label={t("{value0}{value1}, clear filter", { value0: name ? `${name}: ` : '', value1: value })} onClick={onClear}>
            {icon}
            {name && <span className="shrink-0 text-muted-foreground">{name}:</span>}
            <span className="truncate">{value}</span>
            <XIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
    );
}

/**
 * Search, one Filter button (priority, environment and page, people, unread) and the status tabs;
 * the filters in effect show left of the Filter button, each named, with its own clear button. All kept in the URL.
 */
export function CommentFilters({ className, unread, unreadCount, view, status, statusCounts, people, page, pages, environment, environments, historySources, author, search, onSearch, priority }: {
    /** The header's width: the list's or the board's (ProjectComments) */
    className?: string;
    search: string;
    onSearch: (value: string) => void;
    priority?: CommentPriority;
    author?: AuthorFilter;
    environment?: string;
    environments: EnvironmentOption[];
    /** Which of "removed" and "unknown" have comments, when known */
    historySources?: string[];
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
    const { t } = useAppI18n();
    const searchRef = useRef<HTMLInputElement>(null);
    const searchShortcut = useKeyShortcutLabel('/');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();

    const go = (changes: Record<string, string | undefined>) => {
        // With the search still inside its debounce window
        const all = { q: search || undefined, ...changes };
        // Environment and author are server scopes; the rest filter what is already loaded, at once
        if ('environment' in changes || 'author' in changes) {
            const query = urlWith(all).searchParams.toString();
            router.push(`${pathname}${query ? `?${query}` : ''}#comments`, { scroll: false });
        } else setUrlSearchParams(all, { history: 'push' });
    };

    const environmentLabel = environment && environment !== 'all'
        ? environments.find(option => option.id === environment)?.label
            ?? (environment === 'removed' ? t("Removed addresses") : environment === 'unknown' ? t("Source not recorded") : environment)
        : undefined;
    const pagePrefix = page ? pageFilterBase(page) : undefined;
    const chips = [
        priority && { key: 'priority', name: t('Priority'), value: t(priorityLabels[priority]), clear: () => go({ priority: undefined }) },
        unread && { key: 'unread', value: t('Only unread'), clear: () => go({ unread: undefined }) },
        environmentLabel && { key: 'environment', name: t('Environment'), value: environmentLabel, clear: () => go({ environment: undefined, page: undefined }) },
        page && { key: 'page', name: t('Page'), value: pagePrefix !== undefined ? `${pagePrefix}/…` : page, clear: () => go({ page: undefined }) },
        people !== 'all' && { key: 'people', name: t('People'), value: t(peopleFilterLabels[people]), clear: () => go({ people: undefined }) }
    ].filter(Boolean) as { key: string; name?: string; value: string; clear: () => void }[];
    const active = chips.length + (author ? 1 : 0);

    return (
        <div className={cn('flex w-full min-w-0 flex-col gap-2', className)}>
            {/* Search on the left; the filters in effect, Filter and List/Board on the right. The filters in effect wrap
                within their room, and on a phone go to their own line under the row. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <InputGroup className="min-w-0 flex-1 sm:max-w-80 sm:min-w-48 pointer-coarse:min-h-11">
                    <InputGroupAddon><SearchIcon /></InputGroupAddon>
                    <InputGroupInput ref={searchRef} id="feedback-search" type="search" aria-label={t("Search feedback")} maxLength={MAX_FEEDBACK_SEARCH} className="pointer-coarse:min-h-11"
                        // `/` goes here from the page (`AppShortcuts`)
                        data-shortcut-search="" aria-keyshortcuts={searchShortcut}
                        placeholder={t("Search feedback")} value={search} onChange={event => onSearch(event.target.value)} />
                    {search && (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton size="icon-xs" aria-label={t("Clear search")} onClick={() => { onSearch(''); searchRef.current?.focus(); }}>
                                <XIcon />
                            </InputGroupButton>
                        </InputGroupAddon>
                    )}
                </InputGroup>
                {active > 0 && (
                    <div role="group" aria-label={t("Filters in effect")}
                        className="order-last flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:order-none sm:flex-1 sm:basis-0 sm:justify-end">
                        {chips.map(chip => <FilterChip key={chip.key} name={chip.name} value={chip.value} onClear={chip.clear} />)}
                        {author && <FilterChip name="Author" value={author.name} icon={<UserIcon data-icon="inline-start" />} onClear={() => go({ author: undefined })} />}
                    </div>
                )}
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                    {/* Named by its words: "Filter", or "Filter 2" with two in effect */}
                    <PopoverTrigger render={<Button variant="outline" className="ml-auto shrink-0 pointer-coarse:min-h-11" />}>
                        <ListFilterIcon data-icon="inline-start" />
                        {t("Filter")}
                        {active > 0 && <Badge variant="secondary" className="h-5 min-w-5 px-1.5 tabular-nums">{active}</Badge>}
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                        <PopoverHeader><PopoverTitle>{t("Filter comments")}</PopoverTitle></PopoverHeader>
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel htmlFor="filter-priority">{t("Priority")}</FieldLabel>
                                <Select items={{ all: t("All priorities"), ...Object.fromEntries(Object.entries(priorityLabels).map(([key, label]) => [key, t(label)])) }} value={priority ?? 'all'} onValueChange={value => go({ priority: value === 'all' ? undefined : value ?? undefined })}>
                                    <SelectTrigger id="filter-priority" aria-label={t("Priority filter")} className="w-full pointer-coarse:min-h-11">
                                        <SelectValue>{(value: CommentPriority | 'all') => value === 'all' ? t("All priorities") : <><PriorityFlag priority={value} />{t(priorityLabels[value])}</>}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent><SelectGroup>
                                        <SelectItem className="pointer-coarse:min-h-11" value="all">{t("All priorities")}</SelectItem>
                                        {priorities.map(value => <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}><PriorityFlag priority={value} />{t(priorityLabels[value])}</SelectItem>)}
                                    </SelectGroup></SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldTitle>{t("Environment and page")}</FieldTitle>
                                <LocationFilter environment={environment} environments={environments} historySources={historySources} page={page} pages={pages} triggerClassName="w-full max-w-none"
                                    onEnvironment={value => go({ environment: value })} onPage={value => go({ page: value })} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="filter-people">{t("People")}</FieldLabel>
                                <Select items={Object.fromEntries(Object.entries(peopleFilterLabels).map(([key, label]) => [key, t(label)]))} value={people} onValueChange={value => go({ people: value === 'all' ? undefined : value ?? undefined })}>
                                    <SelectTrigger id="filter-people" aria-label={t("People")} className="w-full pointer-coarse:min-h-11">
                                        <UserIcon className="text-muted-foreground" />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent><SelectGroup>
                                        {(Object.keys(peopleFilterLabels) as PeopleFilter[]).map(value => (
                                            <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}>{t(peopleFilterLabels[value])}</SelectItem>
                                        ))}
                                    </SelectGroup></SelectContent>
                                </Select>
                            </Field>
                            <Field orientation="horizontal" className="pointer-coarse:min-h-11">
                                <Checkbox id="filter-unread" checked={unread} onCheckedChange={checked => go({ unread: checked ? 'true' : undefined })} className="pointer-coarse:after:-inset-3.5" />
                                <FieldLabel htmlFor="filter-unread" className="font-normal">
                                    {t("Only unread")}
                                    <span className={cn('tabular-nums', unreadCount > 0 ? 'text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>{unreadCount}</span>
                                </FieldLabel>
                            </Field>
                            {active > 0 && (
                                <Button variant="ghost" size="sm" className="self-start pointer-coarse:min-h-11"
                                    onClick={() => { go({ priority: undefined, unread: undefined, environment: undefined, page: undefined, people: undefined, author: undefined }); setFiltersOpen(false); }}>
                                    {t("Clear filters")}
                                </Button>
                            )}
                        </FieldGroup>
                    </PopoverContent>
                </Popover>
                {/* Icon-only tabs; the tooltip and the accessible name say which. On a touch screen the group, not each tab,
                    takes the 44 px of the search and Filter beside it (its 3 px padding around 38 px tabs; uier #277) */}
                <ToggleGroup size="sm" spacing={0.5} aria-label={t("View")} className={cn(segmentedGroup, 'shrink-0')} value={[view]}
                    // A new layout starts with no thread open (the board would open it in a sheet over itself)
                    onValueChange={([value]) => value && go({ view: value === 'board' ? 'board' : undefined, comment: undefined, ...(status === 'archived' ? { status: undefined } : {}) })}>
                    {([['list', t("List"), ListIcon], ['board', t("Board"), KanbanIcon]] as const).map(([value, label, Icon]) => (
                        <Tooltip key={value}>
                            <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={t(label)} className={cn(segmentedItem, 'px-0 pointer-coarse:min-h-[38px] pointer-coarse:min-w-11')} />}>
                                <Icon />
                            </TooltipTrigger>
                            <TooltipContent>{t(label)}</TooltipContent>
                        </Tooltip>
                    ))}
                </ToggleGroup>
            </div>
            {/* Active (the default, every status but Done), Done, All and Archive; the board shows the statuses side by side,
                with Archive as its last column.
                Open, In progress and Ready to verify fold under Active: its menu picks one, and the Active tab then names it. */}
            {view === 'list' && <StatusTabs status={status} counts={statusCounts} onStatus={value => go({ status: value === 'active' ? undefined : value })} />}
        </div>
    );
}

/**
 * The list's status tabs: Active, Done and All. The menu beside Active picks one of the statuses folded under it
 * (Open, In progress, Ready to verify), which the Active tab then shows ("Active: In progress"); pressing that tab
 * goes back to every active status. The tabs have no status dot, so none reads as a notification; the menu keeps them.
 */
function StatusTabs({ status, counts, onStatus }: {
    status: StatusFilter;
    counts: Record<StatusFilter, number>;
    onStatus: (status: StatusFilter) => void;
}) {
    const { t } = useAppI18n();
    const activeShown = isActiveStatusFilter(status);
    const activeValue = activeShown ? status : 'active';
    const activeLabel = activeValue === 'active' ? t(statusFilterLabels.active) : `${t(statusFilterLabels.active)}: ${t(statusFilterLabels[activeValue])}`;
    return (
        <div className="-mx-1 -my-0.5 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 py-0.5">
            {/* Full width on a phone, the tabs sharing the room (uier #278); still scrolls when their words don't fit */}
            <ToggleGroup size="sm" spacing={0.5} aria-label={t("Status")} className={cn(segmentedGroup, 'w-max min-w-full sm:min-w-0')} value={[activeShown ? 'active' : status]}
                // Pressing the Active tab again while it shows one of its statuses unpresses it: back to every active status
                onValueChange={([value]) => {
                    if (value) onStatus(value as StatusFilter);
                    else if (activeShown && status !== 'active') onStatus('active');
                }}>
                <ToggleGroupItem value="active" className={cn(segmentedItem, statusTab)}>
                    {activeLabel} <span className="tabular-nums text-muted-foreground">{counts[activeValue]}</span>
                </ToggleGroupItem>
                <DropdownMenu>
                    <Tooltip>
                        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t("Active statuses")}
                            className={cn(segmentedItem, '-ml-0.5 w-6 min-w-6 px-0 data-popup-open:text-foreground pointer-coarse:min-w-8')} />} />}>
                            <ChevronDownIcon />
                        </TooltipTrigger>
                        <TooltipContent>{t("Active statuses")}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuRadioGroup value={activeShown ? status : null} onValueChange={(value: StatusFilter) => onStatus(value)}>
                            {(['active', ...activeStatusFilters] as const).map((value, index) => (
                                <Fragment key={value}>
                                    {index === 1 && <DropdownMenuSeparator />}
                                    <DropdownMenuRadioItem value={value} closeOnClick className="pointer-coarse:min-h-11">
                                        {value !== 'active' && <StateDot status={value} />}
                                        {t(statusFilterLabels[value])}
                                        <span className="ml-auto tabular-nums text-muted-foreground">{counts[value]}</span>
                                    </DropdownMenuRadioItem>
                                </Fragment>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
                {(['done', 'all', 'archived'] as const).map(value => (
                    <ToggleGroupItem key={value} value={value} className={cn(segmentedItem, statusTab)}>
                        {t(statusFilterLabels[value])} <span className="tabular-nums text-muted-foreground">{counts[value]}</span>
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}
