import { Toaster } from 'sonner';

/**
 * The id keeps this container its own channel: it shows only toasts sent to it (`toasterId`), never
 * the app's `toast()` calls, which the app's own toaster shows (apps/web/src/components/ui/sonner.tsx).
 * A page with both containers, like /brand/components, would otherwise show each toast twice.
 */
export const notificationsToasterId = 'uier-ui-notifications';

export function NotificationsContainer({ theme }: { theme?: 'light' | 'dark' }) {
    return <Toaster id={notificationsToasterId} theme={theme} />
}
