/** `/blog/*` filters the section `/blog`: its own page and every page under it. Anything else is one page. */
export function pageFilterBase(filter: string) {
    return filter.endsWith('/*') ? filter.slice(0, -2) : undefined;
}

/** Whether a comment's page (a relative URL, which can carry its saved query) matches the page filter */
export function pageMatches(filter: string, path: string) {
    const base = pageFilterBase(filter);
    if (base === undefined)
        return path === filter;
    if (!base)
        return true;
    return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`);
}
