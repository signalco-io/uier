'use client';
import { useAppI18n } from '@/src/lib/i18n/client';

import { ArrowUpRightIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, MinusIcon, OctagonAlertIcon, TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import { KnownPageLinks } from '@/src/knownPages';
import { cn } from '@/src/lib/utils';
import { pageCheckChange } from '@/src/lib/pageChecks/insights';
import {
    accessibilityTotal,
    impactLabels,
    impacts,
    vitalNames,
    type Impact,
    type PageCheckRow
} from '@/src/lib/pageChecks/model';
import { VitalResult } from './VitalResult';

// The parts of a page's row in the Page checks view, shared by the table and the narrow cards. Each
// result is an icon beside its words, so colour is never the only signal (BRAND.md, "Accessibility
// impact": the priority colours, a shape each; a green check for a pass, an amber triangle to look at).

/** Set as the stroke, like `PriorityFlag`, so the icon keeps its colour wherever it sits */
const impactIcons: Record<Impact, { icon: LucideIcon; stroke: string }> = {
    critical: { icon: OctagonAlertIcon, stroke: 'stroke-[hsl(var(--destructive))]' },
    serious: { icon: TriangleAlertIcon, stroke: 'stroke-[hsl(var(--brand-warning))]' },
    moderate: { icon: CircleAlertIcon, stroke: 'stroke-[hsl(var(--foreground))]' },
    minor: { icon: InfoIcon, stroke: 'stroke-[hsl(var(--muted-foreground))]' }
};
export type ResultMark = { icon: LucideIcon; stroke: string };
export const warnIcon: ResultMark = { icon: TriangleAlertIcon, stroke: 'stroke-[hsl(var(--brand-warning))]' };
export const passIcon: ResultMark = { icon: CircleCheckIcon, stroke: 'stroke-[hsl(var(--brand-success))]' };
/** A note, neither a pass nor something to look at (the toolbar SEO panel's muted info) */
export const noteIcon: ResultMark = { icon: InfoIcon, stroke: 'stroke-[hsl(var(--muted-foreground))]' };

function Marked({ mark, children }: { mark: ResultMark; children: React.ReactNode }) {
    const Icon = mark.icon;
    return (
        <span className="inline-flex items-center gap-1.5">
            <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', mark.stroke)} />
            <span>{children}</span>
        </span>
    );
}

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;

/** The page's environment, where the project's addresses name it */
export type PageEnvironment = { origin: string; label: string };

/**
 * The page's address (mono: a machine wrote it), which opens it in review in a new tab, signed in;
 * an address no longer among the project's is only text. Under a level of a hierarchy (`base`, like
 * `/cms`) it shows the rest of the address (`/articles`), and the whole address stays its name.
 */
export function PageLink({ projectId, page, environments, base }: {
    projectId: string;
    page: PageCheckRow;
    environments: readonly PageEnvironment[];
    base?: string;
}) {
    const { t } = useAppI18n();
    const shown = page.sourcePath ?? page.path;
    const above = base && shown.startsWith(base) && shown.length > base.length ? base : '';
    const address = (
        <span className="truncate font-mono text-xs" title={above ? shown : undefined}>
            {above && <span className="sr-only">{above}</span>}{shown.slice(above.length)}
        </span>
    );
    if (!environments.some(item => item.origin === page.origin))
        return address;
    return (
        <a href={KnownPageLinks.projectReview(projectId, `${page.origin}${shown}`)} target="_blank" rel="noopener"
            className="-mx-1 inline-flex w-fit max-w-full min-w-0 items-center gap-1 rounded-md px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
            <span className="sr-only">{t("Open in review: ")}</span>
            {address}
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
    );
}

/** The page's address and its title under it (and its environment, when the project has several) */
export function PageCell({ projectId, page, environments }: { projectId: string; page: PageCheckRow; environments: readonly PageEnvironment[] }) {
    const { t } = useAppI18n();
    const environment = environments.find(item => item.origin === page.origin);
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <PageLink projectId={projectId} page={page} environments={environments} />
            <span className={cn('min-w-0 text-sm break-words whitespace-normal', !page.title && 'text-muted-foreground')}>{page.title ?? t("No title")}</span>
            {environments.length > 1 && <span className="truncate text-xs text-muted-foreground">{environment?.label ?? page.origin}</span>}
        </div>
    );
}

/** axe-core's issues by impact (only the impacts it found), or why there are none */
export function AccessibilityResult({ page }: { page: PageCheckRow }) {
    const { t } = useAppI18n();
    if (!page.accessibility) return muted(t("Not checked"));
    if (!accessibilityTotal(page.accessibility)) return <Marked mark={passIcon}>{t("None found")}</Marked>;
    return (
        <span className="flex flex-col gap-0.5">
            {impacts.filter(impact => page.accessibility![impact] > 0).map(impact => (
                <Marked key={impact} mark={impactIcons[impact]}>{t('{count} {impact}', { count: page.accessibility![impact], impact: t(impactLabels[impact]).toLocaleLowerCase() })}</Marked>
            ))}
        </span>
    );
}

/** The SEO checks worth a look, and how many passed */
export function SeoResult({ page }: { page: PageCheckRow }) {
    const { t } = useAppI18n();
    return (
        <span className="flex flex-col gap-0.5">
            {page.seo.warn > 0 ? <Marked mark={warnIcon}>{t("{count} to look at", { count: page.seo.warn })}</Marked> : <Marked mark={passIcon}>{t("None to look at")}</Marked>}
            {muted(t("{count} passed", { count: page.seo.pass }))}
        </span>
    );
}

/** Core Web Vitals measured in the member's browser, each against its target (its states on hover, focus or a tap) */
export function VitalsResult({ page }: { page: PageCheckRow }) {
    const { t } = useAppI18n();
    const measured = vitalNames.filter(name => page.vitals?.[name] !== undefined);
    if (!measured.length) return muted(t("Not measured"));
    return (
        <span className="flex flex-col gap-0.5">
            {measured.map(name => (
                <VitalResult key={name} name={name} value={page.vitals![name]!}
                    mark={(children, over) => <Marked mark={over ? warnIcon : passIcon}>{children}</Marked>} />
            ))}
        </span>
    );
}

const fewerIcon: ResultMark = { icon: TrendingDownIcon, stroke: 'stroke-[hsl(var(--brand-success))]' };
const moreIcon: ResultMark = { icon: TrendingUpIcon, stroke: 'stroke-[hsl(var(--brand-warning))]' };
const sameIcon: ResultMark = { icon: MinusIcon, stroke: 'stroke-[hsl(var(--muted-foreground))]' };

/**
 * What changed since the check before (uier #416): each count that rose or fell on its own line, its words
 * after a trend arrow, down in green for fewer (good), up in amber for more; a dash for no change. The words
 * say it all, so the arrows are `aria-hidden` and colour is never the only signal.
 */
export function ChangeResult({ page }: { page: PageCheckRow }) {
    const { t } = useAppI18n();
    const change = pageCheckChange(page);
    if (!change) return <span className="text-muted-foreground" data-change="first">{t('First check')}</span>;
    const issues = Math.abs(change.accessibility ?? 0);
    const parts = [
        change.accessibility ? {
            key: 'accessibility', fewer: change.accessibility < 0,
            text: change.accessibility < 0
                ? issues === 1 ? t('1 fewer issue') : t('{count} fewer issues', { count: issues })
                : issues === 1 ? t('1 more issue') : t('{count} more issues', { count: issues })
        } : undefined,
        change.seo ? {
            key: 'seo', fewer: change.seo < 0,
            text: change.seo < 0 ? t('{count} fewer to look at', { count: Math.abs(change.seo) }) : t('{count} more to look at', { count: change.seo })
        } : undefined
    ].filter(part => part !== undefined);
    if (!parts.length) return <span className="text-muted-foreground" data-change="same"><Marked mark={sameIcon}>{t('No change')}</Marked></span>;
    return (
        <span className="flex flex-col gap-0.5 text-muted-foreground">
            {parts.map(part => (
                <span key={part.key} data-change={part.fewer ? 'fewer' : 'more'}>
                    <Marked mark={part.fewer ? fewerIcon : moreIcon}>{part.text}</Marked>
                </span>
            ))}
        </span>
    );
}
