'use client';

import { NotificationsContainer } from '@uier/ui-notifications';
import { useTheme } from 'next-themes';

/** Public pages use the UI kit's notifications container; the app has its own Sonner toaster. */
export function PublicNotifications() {
    const { resolvedTheme } = useTheme();
    return <NotificationsContainer theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />;
}
