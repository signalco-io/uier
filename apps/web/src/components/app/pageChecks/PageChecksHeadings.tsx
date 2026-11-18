'use client';

import type { ReactNode } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';

/**
 * Page checks' two section headings, `h2` under the project's `h1`. The loaded view (`AcrossPages`, `PageChecksView`)
 * and its skeleton (`PageChecksLoading`) draw the same component, so the words, the element and the classes cannot
 * drift and a heading keeps its place when the page arrives. The loaded view's sections are named by them (`id`).
 */
const sectionHeading = 'm-0 text-base font-semibold tracking-[-0.01em]';

export function AcrossPagesHeading({ id }: { id?: string }) {
    const { t } = useAppI18n();
    return <h2 id={id} className={sectionHeading}>{t("Across pages")}</h2>;
}

/** Pages and how many (`children`): the count, or what stands in for it while the pages load */
export function PagesHeading({ id, children }: { id?: string; children: ReactNode }) {
    const { t } = useAppI18n();
    return (
        <h2 id={id} className={cn(sectionHeading, 'mr-auto')}>
            {t("Pages ")}<span className="font-normal text-muted-foreground tabular-nums">{children}</span>
        </h2>
    );
}
