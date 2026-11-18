// Whether this browser last saw a project's Page checks without a checked page. The shell beside a loading page
// knows nothing about its page checks, so the page's own skeleton would draw headings, cards and a table for a
// project that then shows one empty box (docs/design/loading-states #9). A hint, never a source of truth: the first
// visit and a blocked storage load as if pages were checked.

const key = (projectId: string) => `uier:page-checks-empty:${projectId}`;

export function rememberPageChecks(projectId: string, empty: boolean) {
    try {
        if (empty) window.localStorage.setItem(key(projectId), '1');
        else window.localStorage.removeItem(key(projectId));
    } catch { /* Only the next loading state's shape depends on it. */ }
}

export function pageChecksWereEmpty(projectId: string) {
    try { return window.localStorage.getItem(key(projectId)) === '1'; } catch { return false; }
}
