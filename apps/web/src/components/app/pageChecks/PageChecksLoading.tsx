'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { Skeleton } from '@/src/components/ui/skeleton';

const rows = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36'];

/**
 * A project's Page checks while they load (uier #344): as wide as the loaded page (`PageChecksView`, whose
 * `data-header-wide` gives the project header above the same width), with Across pages' two cards, then Pages with
 * its filter and order, and the table (the cards under 48rem)
 */
export function PageChecksLoading() {
    const { t } = useAppI18n();
    return (
        <div role="status" aria-label={t("Loading page checks")} data-page-width="wide" data-header-wide="list"
            className="flex w-[min(var(--page-wide),96rem)] flex-col gap-6 mx-[calc((100%-min(var(--page-wide),96rem))/2)]">
            <span className="sr-only">{t("Loading page checks")}…</span>
            <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-32 animate-none" />
                <div className="grid items-start gap-4 md:grid-cols-2">
                    <Skeleton className="h-40 animate-none rounded-xl" />
                    <Skeleton className="h-40 animate-none rounded-xl" />
                </div>
            </div>
            <div className="@container/page-checks flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Skeleton className="h-6 w-24 animate-none" />
                    <div className="flex max-w-full flex-wrap gap-2">
                        <Skeleton className="h-8 w-56 max-w-full animate-none rounded-lg" />
                        <Skeleton className="h-8 w-48 max-w-full animate-none rounded-lg" />
                    </div>
                </div>
                <div className="hidden rounded-xl border @3xl/page-checks:block">
                    <div className="grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-4 border-b px-4 py-3">
                        {Array.from({ length: 5 }, (_, cell) => <Skeleton key={cell} className="h-4 w-20 animate-none" />)}
                    </div>
                    {rows.map((width, row) => (
                        <div key={row} className="grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] items-start gap-4 border-b px-4 py-3 last:border-b-0">
                            <span className="flex flex-col gap-1.5"><Skeleton className={`h-4 animate-none ${width}`} /><Skeleton className="h-3 w-24 animate-none" /></span>
                            {Array.from({ length: 4 }, (_, cell) => <Skeleton key={cell} className="h-4 w-16 animate-none" />)}
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-3 @3xl/page-checks:hidden">
                    {rows.slice(0, 3).map((width, row) => (
                        <div key={row} className="flex flex-col gap-3 rounded-xl border p-4">
                            <Skeleton className={`h-4 animate-none ${width}`} />
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                {Array.from({ length: 4 }, (_, cell) => <Skeleton key={cell} className="h-8 animate-none" />)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
