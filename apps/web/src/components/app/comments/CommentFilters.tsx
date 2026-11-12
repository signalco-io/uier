'use client';

import type { ThreadLabel } from '../../../lib/app/threadLabel';
import { ThreadLabelMark } from '../ThreadLabelBadge';
import { useAppI18n } from '@/src/lib/i18n/client';

import { priorities, priorityLabels, MAX_FEEDBACK_SEARCH, type CommentPriority } from '@uier/toolbar/triage';
import { Fragment, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDownIcon, ListFilterIcon, SearchIcon, UserIcon, XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { setUrlSearchParams, urlWith } from '@/src/hooks/use-url-search-params';
import { useViewVisible } from '@/src/hooks/use-view-visible';
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
import { activeStatusFilters, boardStatusFilter, boardStatusFilters, doneStatusFilters, isActiveStatusFilter, isDoneStatusFilter, peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import { LocationFilter, type PageCount } from './LocationFilter';
import { pageFilterBase } from './pageFilter';
import { PriorityFlag } from './PriorityFlag';
import { StateDot } from './CommentStatus';
import { useKeyShortcutLabel } from '../keyboard/keys';
import { rememberCommentsView } from './commentsView';
import { CommentsViewToggle, segmentedGroup, segmentedItem } from './CommentsViewToggle';
import { ProjectMark } from '../projects/ProjectMark';

/**
 * From this width of the comments (`@container/comments`) the count line (the unread count and Mark all as read) is in
 * the search row, left of Filter; under it the count line keeps its own row under the search row (`TriageSelection`,
 * which this hides from here). Wide enough for the search's minimum, the status tabs, the count, Filter and List/Board
 * on one line, so the count appearing or going to zero never wraps the row. The query measures the reading column (at
 * most 60rem); from 48rem the header is as wide as the list with its thread (`ProjectComments`), wider than that.
 */
export const countLineInHeader = '@4xl/comments:hidden';

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

/** A project the Project filter offers, where comments of several projects are listed together (My work) */
export type FilterProject = { id: string; name: string; url?: string };

/**
 * Search, one Filter button (priority, environment and page, people, unread) and the status tabs;
 * the filters in effect show left of the Filter button, each named, with its own clear button. All kept in the URL.
 * Comments of several projects (My work) pass `projects` for a Project filter (`?project=`) and leave out what only
 * one project has (`environments`, `statusCounts`).
 */
export function CommentFilters({ className, unread, unreadCount, view, onView, status, statusCounts, statusUnread, people, page, pages = [], environment, environments, historySources, author, search, onSearch, priority, countLine, project, projects, labels, label }: {
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
    labels?: ThreadLabel[];
    label?: string;
    author?: AuthorFilter;
    environment?: string;
    /** A project's environments: without them (several projects) there is no Environment and page filter */
    environments?: EnvironmentOption[];
    /** Which of "removed" and "unknown" have comments, when known */
    historySources?: string[];
    unread: boolean;
    unreadCount: number;
    view: CommentsView;
    /** Where the List/Board choice goes instead of a project's comments' (My work remembers its own) */
    onView?: (view: CommentsView) => void;
    status?: StatusFilter;
    /** Comments in each status with the other filters applied; without them the list has no status tabs */
    statusCounts?: Record<StatusFilter, number>;
    /** The statuses whose comments (with the other filters applied) include unread ones: their tabs show the unread dot */
    statusUnread?: Partial<Record<StatusFilter, boolean>>;
    people: PeopleFilter;
    page?: string;
    /** Relative URLs (paths) that have comments, with how many */
    pages?: PageCount[];
    /** The chosen project's id (`?project=`), with `projects` */
    project?: string;
    /** The projects to filter by, where comments of several projects are listed together (My work) */
    projects?: FilterProject[];
}) {
    const { t } = useAppI18n();
    const searchRef = useRef<HTMLInputElement>(null);
    // A hidden project page Next keeps after navigating away gives up the id, so clearing filters focuses this one
    const visible = useViewVisible();
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
        ? environments?.find(option => option.id === environment)?.label
            ?? (environment === 'removed' ? t("Removed addresses") : environment === 'unknown' ? t("Source not recorded") : environment)
        : undefined;
    const pagePrefix = page ? pageFilterBase(page) : undefined;
    // The list's status tabs show its status; the board's is a filter like the others, in the Filter popover (uier #335).
    // Only a project's board (with `statusCounts`): My work's board groups by category and has no status filter
    const boardStatus = view === 'board' && statusCounts && status ? boardStatusFilter(status) : undefined;
    const projectLabel = project ? projects?.find(option => option.id === project)?.name : undefined;
    const chips = [
        label && { key: 'label', name: t('Label'), value: labels?.find(item => item.id === label)?.name ?? t('Unavailable label'), clear: () => go({ label: undefined }) },
        projectLabel && { key: 'project', name: t('Project'), value: projectLabel, clear: () => go({ project: undefined }) },
        boardStatus && { key: 'status', name: t('Status'), value: t(statusFilterLabels[boardStatus]), clear: () => go({ status: undefined }) },
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
                    <InputGroupInput ref={searchRef} id={visible ? 'feedback-search' : undefined} type="search" aria-label={t("Search feedback")} maxLength={MAX_FEEDBACK_SEARCH} className="pointer-coarse:min-h-11"
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
                {/* Active (the default, every status but Done), Done and All, right after the search (uier #345); on a phone on
                    their own line under the row, before the filters in effect. The board shows the statuses side by side,
                    with Archive as its last column. Open, In progress and Ready to verify fold under Active, Archive under
                    Done: each menu picks one, and the tab then names it. */}
                {view === 'list' && statusCounts && <StatusTabs status={status ?? 'active'} counts={statusCounts} unread={statusUnread ?? {}} onStatus={value => go({ status: value === 'active' ? undefined : value })} />}
                {(active > 0 || countLine) && (
                    // Right-aligned against Filter: the count line first, so the filters in effect stay where they are
                    // when the count appears or goes to zero
                    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-end',
                        active > 0 ? 'order-last basis-full sm:order-none sm:flex-1 sm:basis-0' : 'hidden @4xl/comments:flex @4xl/comments:flex-1')}>
                        {countLine && (
                            <div className={cn('hidden shrink-0 items-center gap-x-3 @4xl/comments:flex', !countLine.summary && !countLine.actions && '@4xl/comments:sr-only')}>
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
                            {projects && (
                                <Field>
                                    <FieldLabel htmlFor="filter-project">{t("Project")}</FieldLabel>
                                    <Select items={{ all: t("All projects"), ...Object.fromEntries(projects.map(option => [option.id, option.name])) }} value={projectLabel ? project : 'all'} onValueChange={value => go({ project: value === 'all' ? undefined : value ?? undefined })}>
                                        <SelectTrigger id="filter-project" aria-label={t("Project")} className="w-full pointer-coarse:min-h-11">
                                            <SelectValue>{(value: string) => {
                                                const chosen = projects.find(option => option.id === value);
                                                return chosen ? <><ProjectMark name={chosen.name} projectId={chosen.id} url={chosen.url} /><span className="truncate">{chosen.name}</span></> : t("All projects");
                                            }}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent><SelectGroup>
                                            <SelectItem className="pointer-coarse:min-h-11" value="all">{t("All projects")}</SelectItem>
                                            {projects.map(option => (
                                                <SelectItem className="pointer-coarse:min-h-11" key={option.id} value={option.id}>
                                                    <ProjectMark name={option.name} projectId={option.id} url={option.url} />
                                                    <span className="truncate">{option.name}</span>
                                                </SelectItem>
                                            ))}
                                        </SelectGroup></SelectContent>
                                    </Select>
                                </Field>
                            )}
                            {view === 'board' && statusCounts && (
                                <Field>
                                    <FieldLabel htmlFor="filter-status">{t("Status")}</FieldLabel>
                                    <Select items={{ all: t("All statuses"), ...Object.fromEntries(boardStatusFilters.map(value => [value, t(statusFilterLabels[value])])) }} value={boardStatus ?? 'all'}
                                        onValueChange={value => go({ status: value === 'all' ? undefined : value ?? undefined })}>
                                        <SelectTrigger id="filter-status" aria-label={t("Status filter")} className="w-full pointer-coarse:min-h-11">
                                            <SelectValue>{(value: typeof boardStatusFilters[number] | 'all') => value === 'all' ? t("All statuses") : <><StateDot status={value} />{t(statusFilterLabels[value])}</>}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent><SelectGroup>
                                            <SelectItem className="pointer-coarse:min-h-11" value="all">{t("All statuses")}</SelectItem>
                                            {boardStatusFilters.map(value => <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}>
                                                <StateDot status={value} />{t(statusFilterLabels[value])}<span className="ml-auto tabular-nums text-muted-foreground">{statusCounts[value]}</span>
                                            </SelectItem>)}
                                        </SelectGroup></SelectContent>
                                    </Select>
                                </Field>
                            )}
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
                            {Boolean(labels?.length || label) && <Field>
                                <FieldLabel htmlFor="filter-label">{t('Label')}</FieldLabel>
                                <Select value={label ?? 'all'} items={[{ value: 'all', label: t('All labels') }, ...(labels ?? []).map(item => ({ value: item.id, label: item.name })), ...(label && !labels?.some(item => item.id === label) ? [{ value: label, label: t('Unavailable label') }] : [])]}
                                    onValueChange={value => go({ label: value === 'all' ? undefined : value ?? undefined })}>
                                    <SelectTrigger id="filter-label" aria-label={t('Label filter')} className="w-full pointer-coarse:min-h-11"><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectGroup><SelectItem value="all" className="pointer-coarse:min-h-11">{t('All labels')}</SelectItem>{(labels ?? []).map(item => <SelectItem key={item.id} value={item.id} className="pointer-coarse:min-h-11"><ThreadLabelMark label={item} />{item.name}</SelectItem>)}{label && !labels?.some(item => item.id === label) && <SelectItem value={label}>{t('Unavailable label')}</SelectItem>}</SelectGroup></SelectContent>
                                </Select>
                            </Field>}
                            {environments && (
                                <Field>
                                    <FieldTitle>{t("Environment and page")}</FieldTitle>
                                    <LocationFilter environment={environment} environments={environments} historySources={historySources} page={page} pages={pages} triggerClassName="w-full max-w-none"
                                        onEnvironment={value => go({ environment: value })} onPage={value => go({ page: value })} />
                                </Field>
                            )}
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
                                    onClick={() => { go({ priority: undefined, unread: undefined, environment: undefined, page: undefined, people: undefined, author: undefined, ...(boardStatus ? { status: undefined } : {}), ...(projects ? { project: undefined } : {}) }); setFiltersOpen(false); }}>
                                    {t("Clear filters")}
                                </Button>
                            )}
                        </FieldGroup>
                    </PopoverContent>
                </Popover>
                {/* A new layout starts with no thread open (the board would open it in a sheet over itself). The choice is
                    remembered as the default and kept in the address, list too, so it wins over the remembered one there */}
                <CommentsViewToggle view={view} onChange={next => {
                    if (onView) return onView(next);
                    rememberCommentsView(next);
                    go({ view: next, comment: undefined, ...(status === 'archived' ? { status: undefined } : {}) });
                }} />
            </div>
        </div>
    );
}

/**
 * A status tab's or menu item's unread dot (uier #346): shown whenever its comments include unread ones, chosen or not,
 * like a row's (the brand accent). Assistive tech hears "Unread" as the tab's description (`aria-describedby`), so
 * its name stays its label and count.
 */
function TabUnread({ unread }: { unread?: boolean }) {
    if (!unread) return null;
    return <span aria-hidden="true" data-tab-unread="" className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-accent))]" />;
}

/**
 * The list's status tabs: Active, Done and All. The menu beside Active picks one of the statuses folded under it
 * (Open, In progress, Ready to verify), which the Active tab then shows ("Active: In progress"); pressing that tab
 * goes back to every active status. Done holds Archive the same way (uier #302): its menu picks Done or Archive, the
 * tab then reads "Archive", and pressing it goes back to Done. The tabs have no status dot, so none reads as a
 * notification; the Active menu keeps them. A tab whose comments include unread ones has the unread dot after its
 * count, chosen or not (`unread`, uier #346), and so do the menus' items.
 */
function StatusTabs({ status, counts, unread, onStatus }: {
    status: StatusFilter;
    counts: Record<StatusFilter, number>;
    unread: Partial<Record<StatusFilter, boolean>>;
    onStatus: (status: StatusFilter) => void;
}) {
    const { t } = useAppI18n();
    const activeShown = isActiveStatusFilter(status);
    const activeValue = activeShown ? status : 'active';
    const activeLabel = activeValue === 'active' ? t(statusFilterLabels.active) : `${t(statusFilterLabels.active)}: ${t(statusFilterLabels[activeValue])}`;
    const doneShown = isDoneStatusFilter(status);
    const doneValue = doneShown ? status : 'done';
    // What a tab with the unread dot is described by
    const unreadId = useId();
    const described = (value: StatusFilter) => unread[value] ? unreadId : undefined;
    return (
        <div className="order-last -mx-1 -my-0.5 max-w-[calc(100%+0.5rem)] basis-[calc(100%+0.5rem)] overflow-x-auto px-1 py-0.5 sm:order-none sm:shrink-0 sm:basis-auto">
            {/* Full width on a phone, the tabs sharing the room (uier #278); still scrolls when their words don't fit */}
            <span id={unreadId} hidden>{t("Unread")}</span>
            <ToggleGroup size="sm" spacing={0.5} aria-label={t("Status")} className={cn(segmentedGroup, 'w-max min-w-full sm:min-w-0')}
                value={[activeShown ? 'active' : doneShown ? 'done' : status]}
                // Pressing Active or Done again while it shows one of its folded choices unpresses it: back to Active or Done
                onValueChange={([value]) => {
                    if (value) onStatus(value as StatusFilter);
                    else if (activeShown && status !== 'active') onStatus('active');
                    else if (doneShown && status !== 'done') onStatus('done');
                }}>
                <ToggleGroupItem value="active" aria-describedby={described(activeValue)} className={cn(segmentedItem, statusTab)}>
                    {activeLabel} <span className="tabular-nums text-muted-foreground">{counts[activeValue]}</span><TabUnread unread={unread[activeValue]} />
                </ToggleGroupItem>
                <StatusesMenu label={t("Active statuses")} values={['active', ...activeStatusFilters]} status={status} counts={counts} unread={unread} unreadId={unreadId} onStatus={onStatus} />
                <ToggleGroupItem value="done" aria-describedby={described(doneValue)} className={cn(segmentedItem, statusTab)}>
                    {t(statusFilterLabels[doneValue])} <span className="tabular-nums text-muted-foreground">{counts[doneValue]}</span><TabUnread unread={unread[doneValue]} />
                </ToggleGroupItem>
                <StatusesMenu label={t("Done and archive")} values={doneStatusFilters} status={status} counts={counts} unread={unread} unreadId={unreadId} onStatus={onStatus} />
                <ToggleGroupItem value="all" aria-describedby={described('all')} className={cn(segmentedItem, statusTab)}>
                    {t(statusFilterLabels.all)} <span className="tabular-nums text-muted-foreground">{counts.all}</span><TabUnread unread={unread.all} />
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}

/**
 * The chevron beside a status tab: a menu of the tab's own filter, then the ones folded under it, each with its count
 * (Active, then Open, In progress and Ready to verify with their status dots; Done, then Archive); a choice closes it
 */
function StatusesMenu({ label, values, status, counts, unread, unreadId, onStatus }: {
    label: string;
    values: readonly StatusFilter[];
    status: StatusFilter;
    counts: Record<StatusFilter, number>;
    unread: Partial<Record<StatusFilter, boolean>>;
    /** The tabs' "Unread" description */
    unreadId: string;
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
                            <DropdownMenuRadioItem value={value} closeOnClick aria-describedby={unread[value] ? unreadId : undefined} className="pointer-coarse:min-h-11">
                                {(activeStatusFilters as readonly StatusFilter[]).includes(value) && <StateDot status={value as typeof activeStatusFilters[number]} />}
                                {t(statusFilterLabels[value])}
                                <span className="ml-auto tabular-nums text-muted-foreground">{counts[value]}</span>
                                {/* Its own room, so the counts line up whether or not an item has unread comments */}
                                <span className="flex w-1.5 shrink-0 justify-center"><TabUnread unread={unread[value]} /></span>
                            </DropdownMenuRadioItem>
                        </Fragment>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
