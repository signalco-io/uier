import { Suspense, type PropsWithChildren, type ReactNode } from 'react';
import { Toaster } from '@/src/components/ui/sonner';
import { TooltipProvider } from '@/src/components/ui/tooltip';
import { AppLanguage } from './AppLanguage';

/**
 * Where a group of app pages starts to depend on the request: the app's language (the account's, else the
 * browser's), with the tooltips and the toaster that speak it. `fallback` is the group's own frame, which is all a
 * full load can draw before the request is read (the static shell): the sidebar frame for the signed-in pages, the
 * logo and card for the sign-in pages. Each group's layout owns its boundary, so its frame is in its pages' static
 * shell; one boundary above them all could only draw something that fits none (docs/design/loading-states #1).
 */
export function AppBoundary({ fallback, children }: PropsWithChildren<{ fallback: ReactNode }>) {
    return (
        <Suspense fallback={fallback}>
            <AppLanguage>
                <TooltipProvider delay={300}>
                    {children}
                    <Toaster position="bottom-right" />
                </TooltipProvider>
            </AppLanguage>
        </Suspense>
    );
}
