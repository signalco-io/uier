import { ClientProvider } from '@/src/components/providers/ClientProvider';
import { Suspense, type PropsWithChildren } from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';
import { PageLoading } from '@/src/components/app/PageLoading';
import { getAppLanguage, getAppCatalog } from '@/src/lib/i18n/server';
import { AppI18nProvider } from '@/src/lib/i18n/client';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Request language and account data stay below the static layout's streaming boundary. */
async function AppLanguage({ children }: PropsWithChildren) {
    const [language, catalog] = await Promise.all([getAppLanguage(), getAppCatalog()]);
    return <AppI18nProvider language={language} catalog={catalog}>{children}</AppI18nProvider>;
}

export default function AppLayout({ children }: PropsWithChildren) {
    return (
        <ClientProvider>
            <Suspense fallback={<div aria-hidden="true"><PageLoading /></div>}>
                <AppLanguage>
                    <TooltipProvider delay={300}>
                        {children}
                        <Toaster position="bottom-right" />
                    </TooltipProvider>
                </AppLanguage>
            </Suspense>
        </ClientProvider>
    );
}
