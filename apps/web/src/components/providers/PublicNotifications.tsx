'use client';

import { NotificationsContainer } from '@signalco/ui-notifications';
import { useTheme } from 'next-themes';

/** Public pages use signalco notifications; the app has its own Sonner toaster. */
export function PublicNotifications() {
    const { resolvedTheme } = useTheme();
    return <NotificationsContainer theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />;
}
