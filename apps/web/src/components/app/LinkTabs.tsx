'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/src/lib/utils';
import { NavigationPending } from './NavigationPending';

export type LinkTab = {
    href: string;
    label: string;
    count?: number;
    /** Current when this matches the page (defaults to comparing the href, see `match`) */
    current?: boolean;
    /** Also current on the pages below its href (a settings section's own pages) */
    nested?: boolean;
};

/**
 * Tabs that are links (a page or a filter kept in the URL), styled like shadcn's tabs:
 * `line` under a page header, `segmented` for a filter, `side` for the sections of a page (a column
 * beside them on wide screens, a row above them on small ones). The current tab has `aria-current`; a tab
 * whose page is loading shows a spinner at its end (the right edge of a `side` link on wide screens).
 */
export function LinkTabs({ tabs, label, variant = 'line', match = 'url', className }: {
    tabs: LinkTab[];
    label: string;
    variant?: 'line' | 'segmented' | 'side';
    /** `path`: a tab stays current whatever the query (a page's own filters) */
    match?: 'url' | 'path';
    className?: string;
}) {
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const here = match === 'path' ? pathname : `${pathname}${search ? `?${search}` : ''}`;
    const navRef = useRef<HTMLElement>(null);

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
            aria-label={label}
            className={cn(
                'flex items-center',
                variant === 'line' && 'no-scrollbar gap-5 overflow-x-auto shadow-[inset_0_-1px_0_0_hsl(var(--border))]',
                variant === 'segmented' && 'w-fit gap-0.5 rounded-lg bg-muted p-[3px]',
                variant === 'side' && 'no-scrollbar gap-1 overflow-x-auto md:flex-col md:items-stretch md:overflow-visible',
                className
            )}>
            {tabs.map(tab => {
                const current = tab.current ?? (tab.href === here || (tab.nested === true && pathname.startsWith(`${tab.href}/`)));
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                            variant === 'line' && 'h-10 border-b-2 border-transparent aria-[current=page]:border-foreground aria-[current=page]:text-foreground',
                            variant === 'segmented' && 'h-7 rounded-md px-2.5 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm',
                            variant === 'side' && 'h-8 rounded-md px-3 hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:text-foreground'
                        )}>
                        {tab.label}
                        {tab.count !== undefined && <span className="font-normal tabular-nums text-muted-foreground">{tab.count}</span>}
                        {/* Last, so the label and count stay together; at the right edge of a section link that fills its column */}
                        <NavigationPending className="ml-auto" />
                    </Link>
                );
            })}
        </nav>
    );
}
