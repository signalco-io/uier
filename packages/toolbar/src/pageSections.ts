/**
 * The sections of a site's pages, for the location filters of the app (`LocationFilter`) and the toolbar's inbox
 * (`LocationPicker`): a section is a parent path with several pages (`/blog` for `/blog/a` and `/blog/b`), and it
 * holds its own page and every page under it. Pure, no DOM: `@uier/toolbar/page-sections`.
 */

/** A page (a relative URL, which can carry its saved query or hash) with its number of comments */
export type SectionPage = { path: string; count: number };

export type PageSection<T extends SectionPage = SectionPage> = {
    /** The section's path, without a trailing slash: `/blog` */
    base: string;
    /** Its pages: its own and every page under it */
    pages: T[];
    /** Their comments */
    count: number;
};

/** Whether a page is in the section `base` (its own page or one under it) */
export function inSection(base: string, path: string) {
    if (!base) return true;
    return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`);
}

/** The section `base` of these pages */
export function pageSection<T extends SectionPage>(base: string, pages: T[]): PageSection<T> {
    const matches = pages.filter(page => inSection(base, page.path));
    return { base, pages: matches, count: matches.reduce((sum, page) => sum + page.count, 0) };
}

/**
 * The sections a location filter lists, by path: every parent path with at least two pages, those that
 * contain the search (5 without one, 10 with), and the typed path (`/docs`) when it starts with `/` and is not one
 * of them yet, so every page under it can be chosen.
 */
export function pageSections<T extends SectionPage>(pages: T[], search: string): { sections: PageSection<T>[]; typed?: PageSection<T> } {
    const query = search.trim().toLowerCase();
    const parents = new Set<string>();
    for (const { path } of pages) {
        const segments = path.split(/[?#]/)[0]!.split('/').filter(Boolean);
        for (let index = 1; index < segments.length; index++)
            parents.add(`/${segments.slice(0, index).join('/')}`);
    }
    const sections = [...parents]
        .map(base => pageSection(base, pages))
        .filter(section => section.pages.length > 1 && (!query || section.base.toLowerCase().includes(query)))
        .sort((a, b) => a.base.localeCompare(b.base))
        .slice(0, query ? 10 : 5);
    const path = search.trim().replace(/\/+$/, '');
    const typed = path.startsWith('/') && path.length > 1 && !sections.some(section => section.base === path) ? pageSection(path, pages) : undefined;
    return { sections, typed };
}
