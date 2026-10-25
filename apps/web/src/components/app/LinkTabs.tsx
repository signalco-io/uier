'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/src/lib/utils';

export type LinkTab = {
    href: string;
    label: string;
    count?: number;
    /** Current when this matches the page (defaults to comparing the href, see `match`) */
    current?: boolean;
};

/**
 * Tabs that are links (a page or a filter kept in the URL), styled like shadcn's tabs:
 * `line` under a page header, `segmented` for a filter. The current tab has `aria-current`.
 */
export function LinkTabs({ tabs, label, variant = 'line', match = 'url', className }: {
    tabs: LinkTab[];
    label: string;
    variant?: 'line' | 'segmented';
    /** `path`: a tab stays current whatever the query (a page's own filters) */
    match?: 'url' | 'path';
    className?: string;
}) {
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const here = match === 'path' ? pathname : `${pathname}${search ? `?${search}` : ''}`;

    return (
        <nav
            aria-label={label}
            className={cn(
                'flex items-center',
                variant === 'line' ? 'no-scrollbar gap-5 overflow-x-auto shadow-[inset_0_-1px_0_0_hsl(var(--border))]' : 'w-fit gap-0.5 rounded-lg bg-muted p-[3px]',
                className
            )}>
            {tabs.map(tab => {
                const current = tab.current ?? tab.href === here;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                            variant === 'line'
                                ? 'h-10 border-b-2 border-transparent aria-[current=page]:border-foreground aria-[current=page]:text-foreground'
                                : 'h-7 rounded-md px-2.5 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm'
                        )}>
                        {tab.label}
                        {tab.count !== undefined && <span className="font-normal tabular-nums text-muted-foreground">{tab.count}</span>}
                    </Link>
                );
            })}
        </nav>
    );
}
