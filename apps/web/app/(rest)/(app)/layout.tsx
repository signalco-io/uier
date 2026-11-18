import { ClientProvider } from '@/src/components/providers/ClientProvider';
import type { PropsWithChildren } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The app's pages. Nothing here waits for the request: the language, tooltips and toaster start in each group's own
 * layout (`AppBoundary`), whose fallback is that group's frame, so a full load's first bytes draw the frame of the
 * page being opened (the sidebar layout, or the sign-in card) instead of a placeholder that fits neither.
 */
export default function AppLayout({ children }: PropsWithChildren) {
    return <ClientProvider>{children}</ClientProvider>;
}
