import { ClientProvider } from '@/src/components/providers/ClientProvider';
import { Suspense, type PropsWithChildren } from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';
import { PageLoading } from '@/src/components/app/PageLoading';
import { AppLanguage } from '@/src/components/app/AppLanguage';

export const metadata: Metadata = { robots: { index: false, follow: false } };

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
