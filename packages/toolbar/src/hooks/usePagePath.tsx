import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { pagePath, pageStatePolicy, type PageStatePolicy } from '../pageState';
import { stopProposalSession } from '../proposalSession';

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
    const changed = () => { stopProposalSession(); listener(); };
    const wrap = (original: History['pushState']) => function(this: History, ...args: Parameters<History['pushState']>) {
        const before = location.href;
        const result = original.apply(this, args);
        if (before !== location.href) stopProposalSession();
        listener();
        return result;
    };
    const push = wrap(originalPush);
    const replace = wrap(originalReplace);
    try { history.pushState = push; history.replaceState = replace; } catch { /* Frozen host APIs use the fallback below. */ }
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    const interval = window.setInterval(listener, 1000);
    return () => {
        try {
            if (history.pushState === push) history.pushState = originalPush;
            if (history.replaceState === replace) history.replaceState = originalReplace;
        } catch { /* The host may have frozen its APIs after mounting. */ }
        window.removeEventListener('popstate', changed);
        window.removeEventListener('hashchange', changed);
        window.clearInterval(interval);
    };
}

export function usePagePath(value?: PageStatePolicy) {
    const policy = useMemo(() => pageStatePolicy(value), [value]);
    const snapshot = useCallback(() => pagePath(`${location.pathname}${location.search}${location.hash}`, policy), [policy]);
    return useSyncExternalStore(subscribe, snapshot, () => '/');
}
