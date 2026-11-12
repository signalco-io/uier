import { useContext, useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, ExpandDown, File, Globe, Layers, Search } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { useInkContainer } from '../InkScope';
import type { CommentsPageFilter } from './CommentsFilter';
import { pageSections } from '../../pageSections';
import { pageKeyPath, type InboxPage } from './useInboxComments';
import { toolbarSurface } from '../../toolbarReview';
import { useIconTooltip } from '../IconTooltip';
import { useMessages, type Messages } from '../../i18n';

/** Comments from addresses the project no longer has, or saved without one */
const historyEnvironments = (t: Messages) => [
    { id: 'removed', label: t.locations.removed },
    { id: 'unknown', label: t.locations.unknown }
];

/** Shown pages before searching; typing finds the rest */
const maxPages = 50;

// One element for every render: the kit's input wraps itself anew (and loses the focus) when its
// decorator changes
const searchIcon = <Search size={14} aria-hidden="true" className="ml-2.5 shrink-0 text-muted-foreground" />;
const sectionIcon = <Layers size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />;

/** "This page", "All pages", a section (`/blog/…`) or the other page's path */
export function pageLabel(value: CommentsPageFilter, t: Messages) {
    return value === 'current' ? t.locations.thisPage : value === 'all' ? t.locations.allPages
        : value.startsWith('section:') ? `${pageKeyPath(value)}/…` : pageKeyPath(value);
}

function Option({ selected, icon, label, detail, title, onSelect }: {
    selected: boolean;
    icon?: ReactNode;
    label: ReactNode;
    detail?: ReactNode;
    title?: string;
    onSelect: () => void;
}) {
    const t = useMessages();
    return (
        <button
            type="button"
            data-option=""
            aria-pressed={selected}
            title={title}
            onClick={onSelect}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent pointer-coarse:min-h-11">
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {/* Read as "/about, 3 comments" */}
            {detail !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><span className="sr-only">, </span>{detail}{typeof detail === 'number' && <span className="sr-only"> {t.locations.comments(detail)}</span>}</span>}
            <Check size={14} aria-hidden="true" className={cx('shrink-0 text-muted-foreground', !selected && 'invisible')} />
        </button>
    );
}

function GroupLabel({ children }: { children: ReactNode }) {
    return <p className="m-0 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

/**
 * Where the inbox's comments are from, in one control the width of the inbox, split like the app's location filter
 * (`LocationFilter`; this page shows its path, its full address in a tooltip): on the left the environment (when the
 * project has several), this page, all pages and the sections with several pages (`/blog/…`, from `@uier/toolbar/page-sections`,
 * as in the app); on the right the single pages and their search. A typed path lists every page under it.
 */
export function LocationPicker({ value, pages, currentPath, currentCount, otherCount, environment, onChange }: {
    value: CommentsPageFilter;
    /** The site's other pages (newest activity first), each with its comments that match the search and status */
    pages: InboxPage[];
    currentPath: string;
    currentCount: number;
    otherCount: number;
    /** The environment filter of a project review, when it has one */
    environment?: { value?: string; options: { id: string; label: string }[]; onChange: (value: string) => void };
    onChange: (value: CommentsPageFilter) => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const container = useInkContainer() ?? rootElement;
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const environmentLabel = environment && [...environment.options, ...historyEnvironments(t)].find(item => item.id === environment.value)?.label;
    // This page shows its path ("This page, /pricing" to a screen reader), its full address in the tooltip
    const current = value === 'current';
    const summary = [environmentLabel, current ? currentPath : pageLabel(value, t)].filter(Boolean).join(' · ');
    const spoken = [environmentLabel, current ? `${t.locations.thisPage}, ${currentPath}` : pageLabel(value, t)].filter(Boolean).join(' · ');
    const name = environment ? t.locations.environmentAndPage : t.locations.pages;
    const { triggerProps, tooltip } = useIconTooltip(current ? `${window.location.origin}${currentPath}` : summary);

    const { sections, shown, typed } = useMemo(() => {
        const query = search.trim().toLowerCase();
        // This page counts in its sections too
        const { sections, typed } = pageSections([{ path: currentPath, count: currentCount }, ...pages], search);
        const shown = pages.filter(item => !query || item.path.toLowerCase().includes(query));
        return { sections, shown, typed };
    }, [pages, currentPath, currentCount, search]);

    const choose = (next: CommentsPageFilter) => {
        onChange(next);
        setOpen(false);
        setSearch('');
    };
    // Up and down move between the search field and the options; Escape closes only the picker
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('input, [data-option]')];
        const active = (event.currentTarget.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
        const index = active ? items.indexOf(active) : -1;
        const next = items[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)];
        if (next) {
            event.preventDefault();
            next.focus();
        }
    };
    // Opens in the page search, so typing filters right away (the kit passes this to Radix's popover)
    const focusSearch = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector('input')?.focus();
        }
    } as HTMLAttributes<HTMLDivElement>;

    return <>
        <Popper
            container={container ?? undefined}
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (!next) setSearch('');
            }}
            align="start"
            aria-label={name}
            onKeyDown={handleKeyDown}
            {...focusSearch}
            {...toolbarSurface('uier-locations', 'z-[55] grid w-[min(36rem,calc(100vw-2rem))] gap-0 rounded-xl p-0 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]')}
            trigger={(
                <Button variant="outlined" aria-label={`${name}: ${spoken}`} {...triggerProps} className="w-full justify-between rounded-md font-normal"
                    startDecorator={value === 'current' || value.startsWith('page:') ? <File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                        : value.startsWith('section:') ? sectionIcon : <Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                    endDecorator={<ExpandDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}>
                    <span className={cx('min-w-0 flex-1 truncate text-left', current && 'font-mono text-[13px]')}>{summary}</span>
                </Button>
            )}>
            {/* Split like the app's location filter: what to list (the environment, this page, all pages, sections) on
                the left, the single pages with their search on the right; stacked on narrow screens */}
            <div className="flex min-w-0 flex-col border-b p-1 sm:max-h-96 sm:overflow-y-auto sm:border-r sm:border-b-0">
                {environment && (
                    <div role="group" aria-label={t.locations.environment} className="flex flex-col">
                        <GroupLabel>{t.locations.environment}</GroupLabel>
                        <Option selected={!environment.value || environment.value === 'all'} icon={<Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                            label={t.locations.allEnvironments} onSelect={() => environment.onChange('all')} />
                        {environment.options.map(item => (
                            <Option key={item.id} selected={environment.value === item.id} label={item.label} title={item.label} onSelect={() => environment.onChange(item.id)} />
                        ))}
                        {historyEnvironments(t).map(item => (
                            <Option key={item.id} selected={environment.value === item.id} label={<span className="text-muted-foreground">{item.label}</span>}
                                title={item.label} onSelect={() => environment.onChange(item.id)} />
                        ))}
                    </div>
                )}
                <div role="group" aria-label={t.locations.pages} className="flex flex-col">
                    {/* Which environment the pages are from */}
                    <div className="flex min-w-0 items-baseline justify-between gap-2 pr-2">
                        <GroupLabel>{t.locations.pages}</GroupLabel>
                        {environment && <span className="min-w-0 truncate text-xs text-muted-foreground">{environmentLabel ?? t.locations.allEnvironments}</span>}
                    </div>
                    <Option selected={value === 'current'} icon={<File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                        label={t.locations.thisPage} title={currentPath} detail={currentCount} onSelect={() => choose('current')} />
                    <Option selected={value === 'all'} icon={<Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                        label={t.locations.allPages} detail={currentCount + otherCount} onSelect={() => choose('all')} />
                </div>
                {sections.length > 0 && (
                    <div role="group" aria-label={t.locations.sections} className="flex flex-col">
                        <GroupLabel>{t.locations.sections}</GroupLabel>
                        {sections.map(section => (
                            <Option key={section.base} selected={value === `section:${section.base}`} icon={sectionIcon}
                                label={<span className="font-mono text-[13px]">{section.base}/…</span>}
                                title={`${section.base}/… · ${t.locations.sectionDetail(section.pages.length, section.count)}`}
                                detail={section.count} onSelect={() => choose(`section:${section.base}`)} />
                        ))}
                    </div>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-1 p-1">
                <GroupLabel>{sections.length > 0 ? t.locations.singlePages : t.locations.otherPages}</GroupLabel>
                <div className="px-1">
                    <Input
                        type="search"
                        aria-label={t.locations.searchPages}
                        placeholder={t.locations.searchPlaceholder}
                        autoComplete="off"
                        fullWidth
                        startDecorator={searchIcon}
                        className="h-8 font-mono text-[13px] focus-within:ring-2 focus-within:ring-ring"
                        value={search}
                        onChange={event => setSearch(event.target.value)} />
                </div>
                <div role="group" aria-label={sections.length > 0 ? t.locations.singlePages : t.locations.otherPages} className="flex max-h-72 flex-col overflow-y-auto">
                    {typed && (
                        <Option selected={value === `section:${typed.base}`} icon={sectionIcon}
                            label={<>{t.locations.pagesUnder}<span className="font-mono text-[13px]">{typed.base}</span></>}
                            title={`${typed.base}/…`} detail={typed.count} onSelect={() => choose(`section:${typed.base}`)} />
                    )}
                    {shown.slice(0, maxPages).map(page => (
                        <Option key={page.key} selected={value === page.key} title={page.path}
                            icon={<File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                            label={<><span className="font-mono text-[13px]">{page.path}</span>{page.environmentLabel && <span className="text-muted-foreground"> · {page.environmentLabel}</span>}</>}
                            detail={page.count} onSelect={() => choose(page.key)} />
                    ))}
                    {shown.length > maxPages && <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">{t.locations.typeToFind(shown.length - maxPages)}</p>}
                    {search && !shown.length && !sections.length && !typed && (
                        <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">{t.locations.noMatch}</p>
                    )}
                </div>
            </div>
        </Popper>
        {tooltip}
    </>;
}
