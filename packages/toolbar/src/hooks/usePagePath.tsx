import { useEffect, useState } from 'react';

/**
 * Page path as the comments API stores it: no query string, no trailing slash (except "/").
 */
export function normalizePath(pathname: string) {
    const trimmed = pathname.replace(/\/+$/, '');
    return trimmed.length ? trimmed : '/';
}

function currentPath() {
    return normalizePath(window.location.pathname);
}

/**
 * Normalized path of the current page. Follows client-side navigation (history API), which
 * does not emit an event for `pushState`, so the path is also checked periodically.
 */
export function usePagePath() {
    const [path, setPath] = useState(currentPath);

    useEffect(() => {
        const update = () => setPath(currentPath());
        window.addEventListener('popstate', update);
        const interval = window.setInterval(update, 1000);
        return () => {
            window.removeEventListener('popstate', update);
            window.clearInterval(interval);
        };
    }, []);

    return path;
}
