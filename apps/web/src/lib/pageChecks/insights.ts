import { accessibilityTotal, vitalNames, vitalOverTarget, vitalTargets, type PageCheckRow } from './model';

// What the project's pages show together (the app's Page checks view), pure so the server render and
// the browser agree and the API tests can check it: the order that puts what needs attention first,
// the change since the check before, and what only shows across pages.

/**
 * The orders of the view's list (`?sort=`): what needs most attention, the most issues of any kind (worst
 * offenders), the most fixed or new since the check before (uier #417), one check's results, the last checked or
 * the address. All from the summaries the view already has.
 */
export const pageCheckOrders = ['attention', 'issues', 'fixed', 'new', 'accessibility', 'seo', 'vitals', 'checked', 'page'] as const;
export type PageCheckOrder = typeof pageCheckOrders[number];
export const pageCheckOrderLabels: Record<PageCheckOrder, string> = {
    attention: 'Needs attention',
    issues: 'Most issues',
    fixed: 'Most fixed',
    new: 'Most new issues',
    accessibility: 'Accessibility issues',
    seo: 'SEO to look at',
    vitals: 'Core Web Vitals over target',
    checked: 'Last checked',
    page: 'Page'
};

export function isPageCheckOrder(value: unknown): value is PageCheckOrder {
    return typeof value === 'string' && (pageCheckOrders as readonly string[]).includes(value);
}

/** Core Web Vitals over their target */
export function vitalsOverTarget(page: Pick<PageCheckRow, 'vitals'>) {
    return vitalNames.filter(name => page.vitals?.[name] !== undefined && vitalOverTarget(name, page.vitals[name]!)).length;
}

/**
 * The pages the view lists (`?show=`, uier #221): every page, the ones with something to look at (in
 * any check, or in one), passing every category, or still missing a category's results.
 */
export const pageCheckFilters = ['all', 'attention', 'accessibility', 'seo', 'vitals', 'passing', 'incomplete'] as const;
export type PageCheckFilter = typeof pageCheckFilters[number];
export const pageCheckFilterLabels: Record<PageCheckFilter, string> = {
    all: 'All pages',
    attention: 'Needs attention',
    accessibility: 'Accessibility issues',
    seo: 'SEO to look at',
    vitals: 'Core Web Vitals over target',
    passing: 'Passes all checks',
    incomplete: 'Incomplete checks'
};

export function isPageCheckFilter(value: unknown): value is PageCheckFilter {
    return typeof value === 'string' && (pageCheckFilters as readonly string[]).includes(value);
}

const needs: Record<Exclude<PageCheckFilter, 'all' | 'attention' | 'passing' | 'incomplete'>, (page: PageCheckRow) => boolean> = {
    accessibility: page => accessibilityTotal(page.accessibility) > 0,
    seo: page => page.seo.warn > 0,
    vitals: page => vitalsOverTarget(page) > 0
};
const needsAttention = (page: PageCheckRow) => Object.values(needs).some(check => check(page));

const complete = (page: PageCheckRow) => page.accessibility !== undefined
    && page.seo.pass + page.seo.warn > 0
    && vitalNames.every(name => page.vitals?.[name] !== undefined);

/** Whether the page is among the ones a filter shows */
export function pageCheckShown(page: PageCheckRow, filter: PageCheckFilter) {
    return filter === 'all' ? true : filter === 'attention' ? needsAttention(page) : filter === 'passing' ? complete(page) && !needsAttention(page)
        : filter === 'incomplete' ? !complete(page) : needs[filter](page);
}

/** The pages a filter shows, in the order they come */
export function filterPageChecks(pages: readonly PageCheckRow[], filter: PageCheckFilter): PageCheckRow[] {
    return pages.filter(page => pageCheckShown(page, filter));
}

const byPage = (a: PageCheckRow, b: PageCheckRow) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0;

/** Descending by each number in turn */
function descending(values: (page: PageCheckRow) => number[]) {
    return (a: PageCheckRow, b: PageCheckRow) => {
        const left = values(a);
        const right = values(b);
        for (let index = 0; index < left.length; index++)
            if (left[index] !== right[index]) return right[index]! - left[index]!;
        return 0;
    };
}

const attention = descending(page => [
    page.accessibility?.critical ?? 0,
    page.accessibility?.serious ?? 0,
    accessibilityTotal(page.accessibility),
    page.seo.warn,
    vitalsOverTarget(page)
]);
const accessibility = descending(page => [accessibilityTotal(page.accessibility), page.accessibility?.critical ?? 0, page.accessibility?.serious ?? 0]);
const seo = descending(page => [page.seo.warn]);
/**
 * Everything to look at, each once: accessibility issues and SEO checks to look at, which already count the Core Web
 * Vitals over target (the toolbar's SEO summary includes them); ties by attention
 */
const issues = descending(page => [accessibilityTotal(page.accessibility) + page.seo.warn]);
/** Vitals over target, then the furthest over (or nearest to) its target */
const vitals = descending(page => [vitalsOverTarget(page),
    Math.max(-1, ...vitalNames.filter(name => page.vitals?.[name] !== undefined).map(name => page.vitals![name]! / vitalTargets[name].good))]);
/** Most fixed (or most new) since the check before, then the fewest new (or fixed); a first check last */
const fixed = descending(page => { const change = pageCheckChangeTotals(page); return change ? [change.fewer, -change.more] : [-1, 0]; });
const added = descending(page => { const change = pageCheckChangeTotals(page); return change ? [change.more, -change.fewer] : [-1, 0]; });
const checked = (a: PageCheckRow, b: PageCheckRow) => a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0;

const compares: Record<PageCheckOrder, (a: PageCheckRow, b: PageCheckRow) => number> = {
    attention, accessibility, seo, vitals, checked,
    issues: (a, b) => issues(a, b) || attention(a, b),
    fixed: (a, b) => fixed(a, b) || attention(a, b),
    new: (a, b) => added(a, b) || attention(a, b),
    page: () => 0
};

/** A new array in the chosen order; ties by page, so the order is stable */
export function sortPageChecks(pages: readonly PageCheckRow[], order: PageCheckOrder): PageCheckRow[] {
    const compare = compares[order];
    return [...pages].sort((a, b) => compare(a, b) || byPage(a, b));
}

/**
 * The change since the check before, as counts more (positive) or fewer (negative); nothing for a
 * page checked once. Accessibility compares only when both checks have the audit.
 */
export function pageCheckChange(page: PageCheckRow): { accessibility?: number; seo: number } | undefined {
    const previous = page.previous;
    if (!previous) return undefined;
    return {
        ...(page.accessibility && previous.accessibility ? { accessibility: accessibilityTotal(page.accessibility) - accessibilityTotal(previous.accessibility) } : {}),
        seo: page.seo.warn - previous.seo.warn
    };
}

/**
 * The accessibility issues and SEO checks to look at that went away (`fewer`) and came (`more`) since the check
 * before, summed over the two; nothing for a page checked once
 */
export function pageCheckChangeTotals(page: PageCheckRow): { fewer: number; more: number } | undefined {
    const change = pageCheckChange(page);
    if (!change) return undefined;
    const deltas = [change.accessibility ?? 0, change.seo];
    return {
        fewer: deltas.reduce((total, delta) => total + Math.max(0, -delta), 0),
        more: deltas.reduce((total, delta) => total + Math.max(0, delta), 0)
    };
}

/** Two texts are the same title or description when they read the same: case and spacing aside */
const sameText = (text: string) => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');

export type SharedText = { text: string; pages: PageCheckRow[] };

/** Indexable pages of one environment that share a text, largest groups first */
function shared(pages: readonly PageCheckRow[], text: (page: PageCheckRow) => string | undefined): SharedText[] {
    const groups = new Map<string, SharedText>();
    for (const page of pages) {
        const value = text(page);
        if (!value || page.noindex) continue;
        const key = `${page.origin}\n${sameText(value)}`;
        const group = groups.get(key);
        if (group) group.pages.push(page);
        else groups.set(key, { text: value, pages: [page] });
    }
    return [...groups.values()].filter(group => group.pages.length > 1)
        .map(group => ({ ...group, pages: group.pages.sort(byPage) }))
        .sort((a, b) => b.pages.length - a.pages.length || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

export type PageCheckInsights = {
    /** Indexable pages of one environment with the same title */
    sharedTitles: SharedText[];
    /** Indexable pages of one environment with the same meta description */
    sharedDescriptions: SharedText[];
    /** Indexable pages without a meta description */
    withoutDescription: PageCheckRow[];
    /** Pages that ask search engines not to index them */
    noindex: PageCheckRow[];
};

export function pageCheckInsights(pages: readonly PageCheckRow[]): PageCheckInsights {
    return {
        sharedTitles: shared(pages, page => page.title),
        sharedDescriptions: shared(pages, page => page.description),
        withoutDescription: pages.filter(page => !page.noindex && !page.description).sort(byPage),
        noindex: pages.filter(page => page.noindex).sort(byPage)
    };
}
