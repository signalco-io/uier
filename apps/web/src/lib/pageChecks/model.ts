// Page check summaries (apps/web/docs/page-checks.md): what the toolbar's background checks found on
// each page a project member reviewed, one small document per page. Pure: the app's view imports it too.

/** Pages a project keeps; a new page beyond it replaces the least recently checked one */
export const PAGE_CHECKS_MAX_PAGES = 200;
/** A page not checked again for this long is removed (Cosmos per-item TTL, counted from the last write) */
export const PAGE_CHECKS_TTL_SECONDS = 90 * 24 * 60 * 60;
/** The page's title and meta description are capped, in UTF-16 code units like the toolbar's cut */
export const PAGE_CHECK_TITLE_MAX = 200;
export const PAGE_CHECK_DESCRIPTION_MAX = 300;
/** Check states per summary */
export const PAGE_CHECK_MAX_CHECKS = 150;
/** Each count; far above what a page can have, so a larger one is a malformed request */
export const PAGE_CHECK_MAX_COUNT = 100_000;

export const impacts = ['critical', 'serious', 'moderate', 'minor'] as const;
export type Impact = typeof impacts[number];
export const impactLabels: Record<Impact, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

export type CheckState = 'pass' | 'warn' | 'none';
/** `seo:<check id>` or `accessibility:<rule or check id>`: lowercase letters, digits and hyphens, up to 64 */
export const checkKeyPattern = /^(?:seo|accessibility):[a-z0-9][a-z0-9-]{0,63}$/;

export type ImpactCounts = Record<Impact, number>;
export type SeoCounts = { warn: number; pass: number };
/** Core Web Vitals measured in the member's browser: milliseconds (LCP, INP) and the layout shift score (CLS) */
export type Vitals = { lcp?: number; cls?: number; inp?: number };
export type VitalName = keyof Vitals;
export const vitalNames: readonly VitalName[] = ['lcp', 'cls', 'inp'];

/**
 * The good targets the toolbar's SEO panel uses (packages/toolbar/src/checks/webVitals.ts), and what
 * a measure over its target means there (its `warnings`, packages/toolbar/src/i18n/en.ts). A measure has
 * two states: within its target (at most `good`) or over it; there is no other level.
 */
export const vitalTargets: Record<VitalName, { label: string; name: string; good: number; over: string; text: (value: number) => string }> = {
    lcp: { label: 'LCP', name: 'Largest Contentful Paint', good: 2500, over: 'The main content shows late.', text: value => `${(value / 1000).toFixed(1)} s` },
    cls: { label: 'CLS', name: 'Cumulative Layout Shift', good: 0.1, over: 'Content moves while the page is used.', text: value => value === 0 ? '0' : value.toFixed(2) },
    inp: { label: 'INP', name: 'Interaction to Next Paint', good: 200, over: 'The page responds slowly.', text: value => `${Math.round(value)} ms` }
};

/** What one check found: the counts the view compares with the check before */
export type PageCheckCounts = {
    /** axe-core's issues by impact; none when the audit did not run in the member's browser */
    accessibility?: ImpactCounts;
    seo: SeoCounts;
};

/** One page's row in the app's view: its summary without the check states, which the view does not list */
export type PageCheckRow = PageCheckCounts & {
    /** The document id: stable for the page in its environment */
    id: string;
    /** The site's origin the page was checked on (an environment) */
    origin: string;
    /** The canonical page key, as comments store it */
    path: string;
    /** The page with its trailing slash, for links, when it had one */
    sourcePath?: string;
    title?: string;
    description?: string;
    noindex: boolean;
    vitals?: Vitals;
    /** ISO time the summary was saved */
    checkedAt: string;
    /** The counts of the check before, when there was one */
    previous?: PageCheckCounts & { checkedAt: string };
};

/** One page's summary as it is stored, with each check's state by `seo:<id>` / `accessibility:<id>` */
export type PageCheckSummary = PageCheckRow & { checks: Record<string, CheckState> };

/** The row of a summary: what the view sends to the browser (the check states stay on the server) */
export function pageCheckRow({ checks: _checks, ...row }: PageCheckSummary): PageCheckRow {
    return row;
}

export const pageChecksPk = (projectId: string) => `page-checks:${projectId}` as const;

export function accessibilityTotal(counts: ImpactCounts | undefined) {
    return counts ? impacts.reduce((total, impact) => total + counts[impact], 0) : 0;
}

/** Whether a measured vital is over its good target */
export function vitalOverTarget(name: VitalName, value: number) {
    return value > vitalTargets[name].good;
}
