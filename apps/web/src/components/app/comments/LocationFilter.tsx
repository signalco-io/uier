'use client';

import { useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, FileIcon, FolderIcon, GlobeIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { cn } from '@/src/lib/utils';
import type { EnvironmentOption } from '../../../lib/app/environments';
import { pageFilterBase, pageMatches } from './pageFilter';

export type PageCount = { path: string; count: number };

const historyEnvironments = [
    { id: 'removed', label: 'Removed addresses' },
    { id: 'unknown', label: 'Source not recorded' }
];

/** Shown pages before searching; typing finds the rest */
const maxPages = 50;

function Option({ selected, icon, label, detail, onSelect }: {
    selected: boolean;
    icon?: ReactNode;
    label: ReactNode;
    detail?: ReactNode;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            data-option=""
            aria-pressed={selected}
            onClick={onSelect}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {/* Read as "/about, 3 comments" */}
            {detail !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums"><span className="sr-only">, </span>{detail}{typeof detail === 'number' && <span className="sr-only"> {detail === 1 ? 'comment' : 'comments'}</span>}</span>}
            <CheckIcon aria-hidden="true" className={cn(!selected && 'invisible')} />
        </button>
    );
}

function GroupLabel({ children }: { children: ReactNode }) {
    return <p className="m-0 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{children}</p>;
}

/**
 * Where the comments were left, in one control: the environment (which site) on the left and its pages
 * on the right. Choosing an environment reloads the pages beside it. Pages can be searched; sections with
 * several pages (`/blog/*`) and a typed path match every page under it.
 */
export function LocationFilter({ environment, environments, page, pages, onEnvironment, onPage }: {
    environment?: string;
    environments: EnvironmentOption[];
    page?: string;
    /** Pages (relative URLs) with their number of comments */
    pages: PageCount[];
    onEnvironment: (value: string | undefined) => void;
    onPage: (value: string | undefined) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    // The pages come with the environment's comments from the server
    const [loading, startLoading] = useTransition();
    const environmentLabel = [...environments, ...historyEnvironments].find(item => item.id === environment)?.label;
    const prefix = page ? pageFilterBase(page) : undefined;
    const pageLabel = page && (prefix !== undefined ? `${prefix}/…` : page);
    const summary = [environmentLabel, pageLabel].filter(Boolean).join(' · ') || 'All environments and pages';

    const { sections, shown, typedPrefix } = useMemo(() => {
        const query = search.trim().toLowerCase();
        const count = (filter: string) => pages.filter(item => pageMatches(filter, item.path));
        // Sections: every parent path with at least two pages
        const parents = new Set<string>();
        for (const { path } of pages) {
            const segments = path.split(/[?#]/)[0]!.split('/').filter(Boolean);
            for (let index = 1; index < segments.length; index++)
                parents.add(`/${segments.slice(0, index).join('/')}`);
        }
        const sections = [...parents]
            .map(base => ({ filter: `${base}/*`, base, matches: count(`${base}/*`) }))
            .filter(section => section.matches.length > 1 && (!query || section.base.toLowerCase().includes(query)))
            .sort((a, b) => a.base.localeCompare(b.base))
            .slice(0, query ? 10 : 5);
        const shown = pages
            .filter(item => !query || item.path.toLowerCase().includes(query))
            .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
        // A typed path that is not a section yet: everything under it
        const typed = search.trim().replace(/\/+$/, '');
        const typedPrefix = typed.startsWith('/') && typed.length > 1 && !sections.some(section => section.base === typed)
            ? { filter: `${typed}/*`, base: typed, matches: count(`${typed}/*`) }
            : undefined;
        return { sections, shown, typedPrefix };
    }, [pages, search]);

    const total = (items: PageCount[]) => items.reduce((sum, item) => sum + item.count, 0);
    const chooseEnvironment = (value: string | undefined) => startLoading(() => onEnvironment(value));
    const choosePage = (value: string | undefined) => {
        onPage(value);
        setOpen(false);
        setSearch('');
    };
    // Up and down move between the search field and the options
    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('input, [data-option]')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = items[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)];
        if (next) {
            event.preventDefault();
            next.focus();
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label={`Environment and page: ${summary}`} className="max-w-80 min-w-36 justify-between font-normal">
                    {prefix !== undefined ? <FolderIcon data-icon="inline-start" className="text-muted-foreground" />
                        : page ? <FileIcon data-icon="inline-start" className="text-muted-foreground" />
                            : <GlobeIcon data-icon="inline-start" className="text-muted-foreground" />}
                    <span className={cn('min-w-0 flex-1 truncate text-left', page && 'font-mono text-[13px]')}>{summary}</span>
                    <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            {/* Environments left, their pages right (stacked on narrow screens); opens in the page search, so typing filters right away */}
            <PopoverContent align="start" className="grid w-[min(40rem,calc(100vw-2rem))] gap-0 p-0 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]" onKeyDown={moveFocus}
                onOpenAutoFocus={event => {
                    event.preventDefault();
                    searchRef.current?.focus();
                }}>
                <div role="group" aria-label="Environment" className="flex flex-col border-b p-1 sm:max-h-96 sm:overflow-y-auto sm:border-r sm:border-b-0">
                    <GroupLabel>Environment</GroupLabel>
                    <Option selected={!environment || environment === 'all'} icon={<GlobeIcon aria-hidden="true" />} label="All environments"
                        onSelect={() => chooseEnvironment(undefined)} />
                    {environments.map(item => (
                        <Option key={item.id} selected={environment === item.id} label={item.label} onSelect={() => chooseEnvironment(item.id)} />
                    ))}
                    {historyEnvironments.map(item => (
                        <Option key={item.id} selected={environment === item.id} label={<span className="text-muted-foreground">{item.label}</span>}
                            onSelect={() => chooseEnvironment(item.id)} />
                    ))}
                </div>
                <div aria-busy={loading} className={cn('flex min-w-0 flex-col gap-1 p-1 transition-opacity', loading && 'opacity-60')}>
                    {/* Which environment the pages are from */}
                    <div className="flex min-w-0 items-baseline justify-between gap-2 pr-2">
                        <GroupLabel>Pages</GroupLabel>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">{environmentLabel ?? 'All environments'}</span>
                    </div>
                    <div className="px-1">
                        <InputGroup className="h-8">
                            <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
                            <InputGroupInput ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)}
                                aria-label="Search pages" placeholder="Search pages or type a path" className="font-mono text-[13px]" />
                        </InputGroup>
                    </div>
                    <div role="group" aria-label="Pages" className="flex max-h-72 flex-col overflow-y-auto">
                        {!search && (
                            <Option selected={!page} icon={<GlobeIcon aria-hidden="true" />} label="All pages" detail={total(pages)} onSelect={() => choosePage(undefined)} />
                        )}
                        {typedPrefix && (
                            <Option selected={page === typedPrefix.filter} icon={<FolderIcon aria-hidden="true" />}
                                label={<>Pages under <span className="font-mono text-[13px]">{typedPrefix.base}</span></>}
                                detail={total(typedPrefix.matches)} onSelect={() => choosePage(typedPrefix.filter)} />
                        )}
                        {sections.length > 0 && <GroupLabel>Sections</GroupLabel>}
                        {sections.map(section => (
                            <Option key={section.filter} selected={page === section.filter} icon={<FolderIcon aria-hidden="true" />}
                                label={<span className="font-mono text-[13px]">{section.base}/…</span>}
                                detail={`${section.matches.length} pages · ${total(section.matches)} comments`} onSelect={() => choosePage(section.filter)} />
                        ))}
                        {shown.length > 0 && sections.length > 0 && <GroupLabel>Single pages</GroupLabel>}
                        {shown.slice(0, maxPages).map(item => (
                            <Option key={item.path} selected={page === item.path} icon={<FileIcon aria-hidden="true" />}
                                label={<span className="font-mono text-[13px]">{item.path}</span>} detail={item.count} onSelect={() => choosePage(item.path)} />
                        ))}
                        {shown.length > maxPages && <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">Type to find the other {shown.length - maxPages} pages.</p>}
                        {search && !shown.length && !sections.length && !typedPrefix && (
                            <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No pages match. Type a path that starts with / to match every page under it.</p>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
