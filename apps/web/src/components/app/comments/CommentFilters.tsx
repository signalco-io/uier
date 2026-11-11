'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { priorities, priorityLabels, MAX_FEEDBACK_SEARCH, type CommentPriority } from '@uier/toolbar/triage';
import { Fragment, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDownIcon, ListFilterIcon, SearchIcon, UserIcon, XIcon } from 'lucide-react';
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
import { activeStatusFilters, doneStatusFilters, isActiveStatusFilter, isDoneStatusFilter, peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import { LocationFilter, type PageCount } from './LocationFilter';
import { pageFilterBase } from './pageFilter';
import { PriorityFlag } from './PriorityFlag';
import { StateDot } from './CommentStatus';
import { useKeyShortcutLabel } from '../keyboard/keys';
import { rememberCommentsView } from './commentsView';
import { CommentsViewToggle, segmentedGroup, segmentedItem } from './CommentsViewToggle';

/**
 * From this width of the comments (`@container/comments`) the count line (the unread count and Mark all as read) is in
 * the search row, left of Filter; under it the count line keeps its own row under the status tabs (`TriageSelection`,
 * which this hides from here). Wide enough for the search's minimum, the count, Filter and List/Board on one line, so
 * the count appearing or going to zero never wraps the row.
 */
export const countLineInHeader = '@2xl/comments:hidden';

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
export function CommentFilters({ className, unread, unreadCount, view, status, statusCounts, people, page, pages, environment, environments, historySources, author, search, onSearch, priority, countLine }: {
    /** The header's width: the list's or the board's (ProjectComments) */
    className?: string;
    /**
     * The count line's unread count and Mark all as read, shown in the search row left of Filter when the comments are
     * wide enough (`countLineInHeader`); empty ones keep the status mounted for announcements and take no room
     */
    countLine?: { summary: React.ReactNode; actions: React.ReactNode };
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
                {(active > 0 || countLine) && (
                    // Right-aligned against Filter: the count line first, so the filters in effect stay where they are
                    // when the count appears or goes to zero
                    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-end',
                        active > 0 ? 'order-last basis-full sm:order-none sm:flex-1 sm:basis-0' : 'hidden @2xl/comments:flex @2xl/comments:flex-1')}>
                        {countLine && (
                            <div className={cn('hidden shrink-0 items-center gap-x-3 @2xl/comments:flex', !countLine.summary && !countLine.actions && '@2xl/comments:sr-only')}>
                                <span role="status" className="text-sm text-muted-foreground tabular-nums">{countLine.summary}</span>
                                {countLine.actions}
                            </div>
                        )}
                        {active > 0 && (
                            <div role="group" aria-label={t("Filters in effect")}
                                className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end">
                                {chips.map(chip => <FilterChip key={chip.key} name={chip.name} value={chip.value} onClear={chip.clear} />)}
                                {author && <FilterChip name="Author" value={author.name} icon={<UserIcon data-icon="inline-start" />} onClear={() => go({ author: undefined })} />}
                            </div>
                        )}
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
                {/* A new layout starts with no thread open (the board would open it in a sheet over itself). The choice is
                    remembered as the default and kept in the address, list too, so it wins over the remembered one there */}
                <CommentsViewToggle view={view} onChange={next => {
                    rememberCommentsView(next);
                    go({ view: next, comment: undefined, ...(status === 'archived' ? { status: undefined } : {}) });
                }} />
            </div>
            {/* Active (the default, every status but Done), Done and All; the board shows the statuses side by side,
                with Archive as its last column.
                Open, In progress and Ready to verify fold under Active, Archive under Done: each menu picks one, and the tab then names it. */}
            {view === 'list' && <StatusTabs status={status} counts={statusCounts} onStatus={value => go({ status: value === 'active' ? undefined : value })} />}
        </div>
    );
}

/**
 * The list's status tabs: Active, Done and All. The menu beside Active picks one of the statuses folded under it
 * (Open, In progress, Ready to verify), which the Active tab then shows ("Active: In progress"); pressing that tab
 * goes back to every active status. Done holds Archive the same way (uier #302): its menu picks Done or Archive, the
 * tab then reads "Archive", and pressing it goes back to Done. The tabs have no status dot, so none reads as a
 * notification; the Active menu keeps them.
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
    const doneShown = isDoneStatusFilter(status);
    const doneValue = doneShown ? status : 'done';
    return (
        <div className="-mx-1 -my-0.5 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 py-0.5">
            {/* Full width on a phone, the tabs sharing the room (uier #278); still scrolls when their words don't fit */}
            <ToggleGroup size="sm" spacing={0.5} aria-label={t("Status")} className={cn(segmentedGroup, 'w-max min-w-full sm:min-w-0')}
                value={[activeShown ? 'active' : doneShown ? 'done' : status]}
                // Pressing Active or Done again while it shows one of its folded choices unpresses it: back to Active or Done
                onValueChange={([value]) => {
                    if (value) onStatus(value as StatusFilter);
                    else if (activeShown && status !== 'active') onStatus('active');
                    else if (doneShown && status !== 'done') onStatus('done');
                }}>
                <ToggleGroupItem value="active" className={cn(segmentedItem, statusTab)}>
                    {activeLabel} <span className="tabular-nums text-muted-foreground">{counts[activeValue]}</span>
                </ToggleGroupItem>
                <StatusesMenu label={t("Active statuses")} values={['active', ...activeStatusFilters]} status={status} counts={counts} onStatus={onStatus} />
                <ToggleGroupItem value="done" className={cn(segmentedItem, statusTab)}>
                    {t(statusFilterLabels[doneValue])} <span className="tabular-nums text-muted-foreground">{counts[doneValue]}</span>
                </ToggleGroupItem>
                <StatusesMenu label={t("Done and archive")} values={doneStatusFilters} status={status} counts={counts} onStatus={onStatus} />
                <ToggleGroupItem value="all" className={cn(segmentedItem, statusTab)}>
                    {t(statusFilterLabels.all)} <span className="tabular-nums text-muted-foreground">{counts.all}</span>
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}

/**
 * The chevron beside a status tab: a menu of the tab's own filter, then the ones folded under it, each with its count
 * (Active, then Open, In progress and Ready to verify with their status dots; Done, then Archive); a choice closes it
 */
function StatusesMenu({ label, values, status, counts, onStatus }: {
    label: string;
    values: readonly StatusFilter[];
    status: StatusFilter;
    counts: Record<StatusFilter, number>;
    onStatus: (status: StatusFilter) => void;
}) {
    const { t } = useAppI18n();
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label}
                    className={cn(segmentedItem, '-ml-0.5 w-6 min-w-6 px-0 data-popup-open:text-foreground pointer-coarse:min-w-8')} />} />}>
                    <ChevronDownIcon />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuRadioGroup value={values.includes(status) ? status : null} onValueChange={(value: StatusFilter) => onStatus(value)}>
                    {values.map((value, index) => (
                        <Fragment key={value}>
                            {index === 1 && <DropdownMenuSeparator />}
                            <DropdownMenuRadioItem value={value} closeOnClick className="pointer-coarse:min-h-11">
                                {(activeStatusFilters as readonly StatusFilter[]).includes(value) && <StateDot status={value as typeof activeStatusFilters[number]} />}
                                {t(statusFilterLabels[value])}
                                <span className="ml-auto tabular-nums text-muted-foreground">{counts[value]}</span>
                            </DropdownMenuRadioItem>
                        </Fragment>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
