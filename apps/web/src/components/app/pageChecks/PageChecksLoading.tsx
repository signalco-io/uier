'use client';

import { useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Skeleton } from '@/src/components/ui/skeleton';
import { AcrossPagesHeading, PagesHeading } from './PageChecksHeadings';
import { pageChecksWereEmpty } from './pageChecksSeen';

const subscribeNothing = () => () => {};

const rows = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36'];

/**
 * A project's Page checks while they load (uier #344): as wide as the loaded page (`PageChecksView`, whose
 * `data-header-wide` gives the project header above the same width). Its two headings need no data, so they are the
 * loaded view's own (`PageChecksHeadings`: Across pages, and Pages with an outline for its count) and keep their
 * place when the page arrives; outlines stand only where data goes: Across pages' cards, Pages' filter and order,
 * and the table (the cards under 48rem). The root is the one status, "Loading page checks": what is drawn in it is
 * hidden from assistive technology, the headings too, so the announcement is that line and nothing else.
 */
export function PageChecksLoading() {
    const { t } = useAppI18n();
    const { projectId } = useParams<{ projectId: string }>();
    // A project this browser last saw without a checked page loads as that page's one box, with no headings to
    // take away again (`pageChecksSeen`); the server, which cannot know, draws the checked shape
    const empty = useSyncExternalStore(subscribeNothing, () => pageChecksWereEmpty(projectId), () => false);
    if (empty) {
        return (
            <div role="status" aria-label={t("Loading page checks")} data-page-width="wide" data-header-wide="list" data-page-checks-expected="empty"
                className="flex flex-col gap-6 page-wide">
                <span className="sr-only">{t("Loading page checks")}…</span>
                {/* `Empty` with its border: the icon's tile, the title and two lines */}
                <div aria-hidden="true" className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-12">
                    <Skeleton className="mb-2 size-10 animate-none rounded-lg" />
                    <Skeleton className="h-5 w-48 animate-none" />
                    <Skeleton className="h-4 w-80 max-w-full animate-none" />
                    <Skeleton className="h-4 w-64 max-w-full animate-none" />
                </div>
            </div>
        );
    }
    return (
        <div role="status" aria-label={t("Loading page checks")} data-page-width="wide" data-header-wide="list"
            className="flex flex-col gap-6 page-wide">
            <span className="sr-only">{t("Loading page checks")}…</span>
            <div aria-hidden="true" className="contents">
                <div className="flex flex-col gap-3">
                    <AcrossPagesHeading />
                    <div className="grid items-start gap-4 md:grid-cols-2">
                        <Skeleton className="h-40 animate-none rounded-xl" />
                        <Skeleton className="h-40 animate-none rounded-xl" />
                    </div>
                </div>
                <div className="@container/page-checks flex flex-col gap-3">
                    {/* The heading row as the loaded view lays it out, so Pages and the buttons' outlines are where theirs will be */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <PagesHeading><Skeleton className="inline-block h-4 w-5 animate-none align-middle" /></PagesHeading>
                        {/* Filter and Sort: icon buttons (uier #417) */}
                        <div className="flex shrink-0 items-center gap-1">
                            <Skeleton className="size-9 animate-none rounded-lg pointer-coarse:size-11" />
                            <Skeleton className="size-9 animate-none rounded-lg pointer-coarse:size-11" />
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
        </div>
    );
}
