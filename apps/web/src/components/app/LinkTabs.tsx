'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { setUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { cn } from '@/src/lib/utils';
import { useRovingTabStop } from './keyboard/keys';

export type LinkTab = {
    href: string;
    label: string;
    count?: number;
    /** Current when this matches the page (defaults to comparing the href, see `match`) */
    current?: boolean;
    /** Also current on the pages below its href (a settings section's own pages) */
    nested?: boolean;
    /**
     * The search params this tab sets (a value) or removes (`undefined`) when the page already holds what it
     * shows (a list's Active and Done): a click changes the address at once, without a server request. Pass
     * `current` from `useUrlSearchParams`.
     */
    query?: Record<string, string | undefined>;
};

/**
 * Tabs that are links (a page or a filter kept in the URL), styled like shadcn's tabs:
 * `line` under a page header, `segmented` for a filter, `side` for the sections of a page (a column
 * beside them on wide screens, a row above them on small ones). The current tab has `aria-current`. A tab
 * shows no loading spinner: app pages load fast enough that the current tab moves on the click (uier #272),
 * and a `query` tab switches at once. A `line` tab has no padding, so the first label lines up with the page
 * content and the gap is the only space between tabs. Opening a tab in a new tab or window loads its href.
 *
 * Like tabs, they are one tab stop (the current tab, or the one last focused): ← and → (and ↑ and ↓ for `side`)
 * move between them, Home and End to the first and the last, Enter opens one.
 */
export function LinkTabs({ tabs, label, variant = 'line', match = 'url', className }: {
    tabs: LinkTab[];
    label: string;
    variant?: 'line' | 'segmented' | 'side';
    /** `path`: a tab stays current whatever the query (a page's own filters) */
    match?: 'url' | 'path';
    className?: string;
}) {
    const { t } = useAppI18n();
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const here = match === 'path' ? pathname : `${pathname}${search ? `?${search}` : ''}`;
    const navRef = useRef<HTMLElement>(null);
    const isCurrent = (tab: LinkTab) => tab.current ?? (tab.href === here || (tab.nested === true && pathname.startsWith(`${tab.href}/`)));
    const roving = useRovingTabStop(tabs.map(tab => tab.href), {
        preferred: tabs.find(isCurrent)?.href,
        orientation: variant === 'side' ? "both" : "horizontal"
    });

    // A row wider than the screen scrolls the current tab into the middle (only sideways: the page stays put)
    useEffect(() => {
        const nav = navRef.current;
        const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!nav || !current || nav.scrollWidth <= nav.clientWidth)
            return;
        nav.scrollLeft += current.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - current.offsetWidth) / 2;
    }, [here]);

    return (
        <nav
            ref={navRef}
            aria-label={t(label)}
            {...roving.containerProps}
            className={cn(
                'flex items-center',
                variant === 'line' && 'no-scrollbar gap-5 overflow-x-auto shadow-[inset_0_-1px_0_0_hsl(var(--border))]',
                variant === 'segmented' && 'w-fit gap-0.5 rounded-lg bg-muted p-[3px]',
                variant === 'side' && 'no-scrollbar gap-1 overflow-x-auto md:flex-col md:items-stretch md:overflow-visible',
                className
            )}>
            {tabs.map(tab => {
                const current = isCurrent(tab);
                const { query } = tab;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        {...roving.itemProps(tab.href)}
                        aria-current={current ? "page" : undefined}
                        // Nothing to load: the address changes during the click (Back and Forward follow it)
                        prefetch={query ? false : undefined}
                        onNavigate={query ? event => {
                            event.preventDefault();
                            setUrlSearchParams(query, { history: 'push' });
                        } : undefined}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                            variant === 'line' && 'h-10 border-b-2 border-transparent aria-[current=page]:border-foreground aria-[current=page]:text-foreground',
                            variant === 'segmented' && 'h-7 rounded-md px-2.5 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm',
                            variant === 'side' && 'h-8 rounded-md px-3 hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:text-foreground'
                        )}>
                        {t(tab.label)}
                        {tab.count !== undefined && <span className="font-normal tabular-nums text-muted-foreground">{tab.count}</span>}
                    </Link>
                );
            })}
        </nav>
    );
}
