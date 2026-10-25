import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { pagePath, pageStatePolicy, type PageStatePolicy } from '../pageState';

/**
 * Page path as the comments API stores it: no query string, no trailing slash (except "/"). One
 * leading slash: the API refuses paths that start with "//" (a browser reads them as another site).
 */
export function normalizePath(pathname: string) {
    const trimmed = pathname.replace(/^\/{2,}/, '/').replace(/\/+$/, '');
    return trimmed.length ? trimmed : '/';
}

/** Notify synchronously for SPA transitions, preserving method receivers and later router wrappers. */
function subscribe(listener: () => void) {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const push = function(this: History, ...args: Parameters<History['pushState']>) { const result = originalPush.apply(this, args); listener(); return result; };
    const replace = function(this: History, ...args: Parameters<History['replaceState']>) { const result = originalReplace.apply(this, args); listener(); return result; };
    try { history.pushState = push; history.replaceState = replace; } catch { /* Frozen host APIs use the fallback below. */ }
    window.addEventListener('popstate', listener);
    window.addEventListener('hashchange', listener);
    const interval = window.setInterval(listener, 1000);
    return () => {
        try {
            if (history.pushState === push) history.pushState = originalPush;
            if (history.replaceState === replace) history.replaceState = originalReplace;
        } catch { /* The host may have frozen its APIs after mounting. */ }
        window.removeEventListener('popstate', listener);
        window.removeEventListener('hashchange', listener);
        window.clearInterval(interval);
    };
}

export function usePagePath(value?: PageStatePolicy) {
    const policy = useMemo(() => pageStatePolicy(value), [value]);
    const snapshot = useCallback(() => pagePath(`${location.pathname}${location.search}${location.hash}`, policy), [policy]);
    return useSyncExternalStore(subscribe, snapshot, () => '/');
}
