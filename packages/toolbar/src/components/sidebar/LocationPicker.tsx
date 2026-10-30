import { useContext, useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, ExpandDown, File, Globe, Layers, Search } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { useInkContainer } from '../InkScope';
import { inSection, type CommentsPageFilter } from './CommentsFilter';
import { pageKeyPath, type InboxPage } from './useInboxComments';

const historyEnvironments = [
    { id: 'removed', label: 'Removed addresses' },
    { id: 'unknown', label: 'Source not recorded' }
];

/** Shown pages before searching; typing finds the rest */
const maxPages = 50;

// One element for every render: the kit's input wraps itself anew (and loses the focus) when its
// decorator changes
const searchIcon = <Search size={14} aria-hidden="true" className="ml-2.5 shrink-0 text-muted-foreground" />;
const sectionIcon = <Layers size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />;

/** "This page", "All pages", a section (`/blog/…`) or the other page's path */
export function pageLabel(value: CommentsPageFilter) {
    return value === 'current' ? 'This page' : value === 'all' ? 'All pages'
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
            {detail !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><span className="sr-only">, </span>{detail}{typeof detail === 'number' && <span className="sr-only"> {detail === 1 ? 'comment' : 'comments'}</span>}</span>}
            <Check size={14} aria-hidden="true" className={cx('shrink-0 text-muted-foreground', !selected && 'invisible')} />
        </button>
    );
}

function GroupLabel({ children }: { children: ReactNode }) {
    return <p className="m-0 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

/**
 * Where the inbox's comments are from, in one control, like the app's location filter: the
 * environment (when the project has several) on the left and the pages on the right. Pages can be
 * searched; sections with several pages (`/blog/…`) and a typed path list every page under it.
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
    const container = useInkContainer() ?? rootElement;
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const environmentLabel = environment && [...environment.options, ...historyEnvironments].find(item => item.id === environment.value)?.label;
    const summary = [environmentLabel, pageLabel(value)].filter(Boolean).join(' · ');
    const name = environment ? 'Environment and page' : 'Pages';

    const { sections, shown, typed } = useMemo(() => {
        const query = search.trim().toLowerCase();
        // This page counts in its sections too
        const everyPage = [{ path: currentPath, count: currentCount }, ...pages];
        const parents = new Set<string>();
        for (const { path } of everyPage) {
            const segments = path.split(/[?#]/)[0]!.split('/').filter(Boolean);
            for (let index = 1; index < segments.length; index++)
                parents.add(`/${segments.slice(0, index).join('/')}`);
        }
        const section = (base: string) => {
            const matches = everyPage.filter(item => inSection(base, item.path));
            return { key: `section:${base}` as const, base, pages: matches.length, count: matches.reduce((sum, item) => sum + item.count, 0) };
        };
        const sections = [...parents]
            .map(section)
            .filter(item => item.pages > 1 && (!query || item.base.toLowerCase().includes(query)))
            .sort((a, b) => a.base.localeCompare(b.base))
            .slice(0, query ? 10 : 5);
        const shown = pages.filter(item => !query || item.path.toLowerCase().includes(query));
        // A typed path that is not a section yet: everything under it
        const path = search.trim().replace(/\/+$/, '');
        const typed = path.startsWith('/') && path.length > 1 && !sections.some(item => item.base === path) ? section(path) : undefined;
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

    return (
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
            className={cx('z-[55] grid gap-0 rounded-xl p-0',
                environment ? 'w-[min(36rem,calc(100vw-2rem))] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]' : 'w-[min(22rem,calc(100vw-2rem))]')}
            trigger={(
                <Button variant="outlined" aria-label={`${name}: ${summary}`} className="min-w-36 max-w-full flex-1 justify-between rounded-md font-normal"
                    startDecorator={value === 'current' || value.startsWith('page:') ? <File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                        : value.startsWith('section:') ? sectionIcon : <Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                    endDecorator={<ExpandDown size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}>
                    <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
                </Button>
            )}>
            {environment && (
                <div role="group" aria-label="Environment" className="flex flex-col border-b p-1 sm:max-h-96 sm:overflow-y-auto sm:border-r sm:border-b-0">
                    <GroupLabel>Environment</GroupLabel>
                    <Option selected={!environment.value || environment.value === 'all'} icon={<Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                        label="All environments" onSelect={() => environment.onChange('all')} />
                    {environment.options.map(item => (
                        <Option key={item.id} selected={environment.value === item.id} label={item.label} onSelect={() => environment.onChange(item.id)} />
                    ))}
                    {historyEnvironments.map(item => (
                        <Option key={item.id} selected={environment.value === item.id} label={<span className="text-muted-foreground">{item.label}</span>}
                            onSelect={() => environment.onChange(item.id)} />
                    ))}
                </div>
            )}
            <div className="flex min-w-0 flex-col gap-1 p-1">
                {/* Which environment the pages are from */}
                <div className="flex min-w-0 items-baseline justify-between gap-2 pr-2">
                    <GroupLabel>Pages</GroupLabel>
                    {environment && <span className="min-w-0 truncate text-xs text-muted-foreground">{environmentLabel ?? 'All environments'}</span>}
                </div>
                <div className="px-1">
                    <Input
                        type="search"
                        aria-label="Search pages"
                        placeholder="Search pages or type a path"
                        autoComplete="off"
                        fullWidth
                        startDecorator={searchIcon}
                        className="h-8 font-mono text-[13px] focus-within:ring-2 focus-within:ring-ring"
                        value={search}
                        onChange={event => setSearch(event.target.value)} />
                </div>
                <div role="group" aria-label="Pages" className="flex max-h-72 flex-col overflow-y-auto">
                    {!search && <>
                        <Option selected={value === 'current'} icon={<File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                            label="This page" detail={currentCount} onSelect={() => choose('current')} />
                        <Option selected={value === 'all'} icon={<Globe size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                            label="All pages" detail={currentCount + otherCount} onSelect={() => choose('all')} />
                    </>}
                    {typed && (
                        <Option selected={value === typed.key} icon={sectionIcon}
                            label={<>Pages under <span className="font-mono text-[13px]">{typed.base}</span></>}
                            detail={typed.count} onSelect={() => choose(typed.key)} />
                    )}
                    {sections.length > 0 && <GroupLabel>Sections</GroupLabel>}
                    {sections.map(section => (
                        <Option key={section.key} selected={value === section.key} icon={sectionIcon}
                            label={<span className="font-mono text-[13px]">{section.base}/…</span>}
                            detail={`${section.pages} pages · ${section.count} comments`} onSelect={() => choose(section.key)} />
                    ))}
                    {shown.length > 0 && <GroupLabel>{sections.length > 0 ? 'Single pages' : 'Other pages'}</GroupLabel>}
                    {shown.slice(0, maxPages).map(page => (
                        <Option key={page.key} selected={value === page.key} title={page.path}
                            icon={<File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                            label={<><span className="font-mono text-[13px]">{page.path}</span>{page.environmentLabel && <span className="text-muted-foreground"> · {page.environmentLabel}</span>}</>}
                            detail={page.count} onSelect={() => choose(page.key)} />
                    ))}
                    {shown.length > maxPages && <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">Type to find the other {shown.length - maxPages} pages.</p>}
                    {search && !shown.length && !sections.length && !typed && (
                        <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No pages match. Type a path that starts with / to match every page under it.</p>
                    )}
                </div>
            </div>
        </Popper>
    );
}
