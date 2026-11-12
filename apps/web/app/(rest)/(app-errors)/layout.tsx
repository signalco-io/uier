import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { ClientProvider } from '@/src/components/providers/ClientProvider';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Error entries must reach notFound before any request-language boundary can stream. */
export default function AppErrorLayout({ children }: PropsWithChildren) {
    return <ClientProvider><TooltipProvider delay={300}>
        {children}
        <Toaster position="bottom-right" />
    </TooltipProvider></ClientProvider>;
}
