import { accessibilityTotal, vitalNames, vitalOverTarget, type PageCheckRow } from './model';

// What the project's pages show together (the app's Page checks view), pure so the server render and
// the browser agree and the API tests can check it: the order that puts what needs attention first,
// the change since the check before, and what only shows across pages.

export const pageCheckOrders = ['attention', 'accessibility', 'seo', 'checked', 'page'] as const;
export type PageCheckOrder = typeof pageCheckOrders[number];
export const pageCheckOrderLabels: Record<PageCheckOrder, string> = {
    attention: 'Needs attention',
    accessibility: 'Accessibility issues',
    seo: 'SEO to look at',
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

/** A new array in the chosen order; ties by page, so the order is stable */
export function sortPageChecks(pages: readonly PageCheckRow[], order: PageCheckOrder): PageCheckRow[] {
    const compare = order === 'attention' ? attention : order === 'accessibility' ? accessibility : order === 'seo' ? seo
        : order === 'checked' ? (a: PageCheckRow, b: PageCheckRow) => a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0
            : () => 0;
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
