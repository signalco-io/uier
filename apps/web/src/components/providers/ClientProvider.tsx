'use client';

import { Analytics } from '@vercel/analytics/react';
import { attributionLink } from '@/src/lib/acquisition/types';
import { DevReviewToolbarScript } from '../toolbar/DevReviewToolbarScript';
import { PropsWithChildren, useEffect } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationsContainer } from '@signalco/ui-notifications';
import { AcquisitionProvider, AcquisitionVisitAnalytics, acquisitionEnabled, useAcquisitionAttribution, redactAnalyticsEvent } from '../marketing/AcquisitionAnalytics';

const queryClient = new QueryClient();

function ThemedNotificationsContainer() {
    const { resolvedTheme } = useTheme();
    return <NotificationsContainer theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />;
}

/** CSP and COOP belong to the document; Next client navigation cannot replace them. */
function DocumentPolicyBoundary() {
    const getAttribution = useAcquisitionAttribution();
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
            location.assign(!appPath(location.pathname) && acquisitionEnabled()
                ? attributionLink(target, getAttribution()).href : target.href);
        };
        document.addEventListener('click', navigate, true);
        return () => document.removeEventListener('click', navigate, true);
    }, [getAttribution]);
    return null;
}

export function ClientProvider({children, nonce}: PropsWithChildren<{ nonce?: string }>) {
    return (
        <ThemeProvider attribute="class" nonce={nonce}>
            <QueryClientProvider client={queryClient}>
                <AcquisitionProvider>
                    <ReactQueryDevtools initialIsOpen={false} />
                    <ThemedNotificationsContainer />
                    <DocumentPolicyBoundary />
                    {children}
                    <AcquisitionVisitAnalytics />
                    <Analytics beforeSend={redactAnalyticsEvent} />
                    {process.env.NODE_ENV === 'development' && <DevReviewToolbarScript />}
                </AcquisitionProvider>
            </QueryClientProvider>
        </ThemeProvider>
    );
}
