import { PropsWithChildren } from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';

// The app (signed in or signing in) is not for search engines
export const metadata: Metadata = {
    robots: { index: false, follow: false }
};

/** The app's UI is shadcn/ui (src/components/ui): tooltips and toasts for every app page */
export default function AppLayout({ children }: PropsWithChildren) {
    return (
        <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="bottom-right" />
        </TooltipProvider>
    );
}
