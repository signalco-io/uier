import { headers } from 'next/headers';
import { getAppLanguage, getAppCatalog } from '@/src/lib/i18n/server';
import { AppI18nProvider } from '@/src/lib/i18n/client';
import { ClientProvider } from '@/src/components/providers/ClientProvider';
import { PropsWithChildren } from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';

// The app (signed in or signing in) is not for search engines
export const metadata: Metadata = {
    robots: { index: false, follow: false }
};

/** The app's UI is shadcn/ui (src/components/ui): tooltips and toasts for every app page */
export default async function AppLayout({ children }: PropsWithChildren) {
    const [requestHeaders, language, catalog] = await Promise.all([headers(), getAppLanguage(), getAppCatalog()]);
    const nonce = requestHeaders.get('x-nonce') ?? undefined;
    return (
        <AppI18nProvider language={language} catalog={catalog}>
        <ClientProvider nonce={nonce}>
            <TooltipProvider delay={300}>
                {children}
                <Toaster position="bottom-right" />
            </TooltipProvider>
        </ClientProvider>
        </AppI18nProvider>
    );
}
