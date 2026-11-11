'use client';

import { DevReviewToolbarScript } from '../toolbar/DevReviewToolbarScript';
import { PropsWithChildren, Suspense, useEffect } from 'react';
import { ThemeProvider } from 'next-themes';

/** CSP and COOP belong to the document; Next client navigation cannot replace them. */
function DocumentPolicyBoundary() {
    useEffect(() => {
        const appPath = (path: string) => path === '/app' || path.startsWith('/app/');
        const navigate = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
            const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self'))
                return;
            const target = new URL(link.href);
            if (target.origin !== location.origin || appPath(target.pathname) === appPath(location.pathname))
                return;
            event.preventDefault();
            location.assign(target.href);
        };
        document.addEventListener('click', navigate, true);
        return () => document.removeEventListener('click', navigate, true);
    }, []);
    return null;
}

export function ClientProvider({children}: PropsWithChildren) {
    return (
        <ThemeProvider attribute="class" scriptProps={{ type: 'application/json' }}>
            <DocumentPolicyBoundary />
            {children}
            {process.env.NODE_ENV === 'development' && <Suspense><DevReviewToolbarScript /></Suspense>}
        </ThemeProvider>
    );
}
