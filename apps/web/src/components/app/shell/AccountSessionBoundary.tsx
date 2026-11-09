'use client';

import { useEffect } from 'react';
import { accountChangedKey } from './accountSessions';

/** Reload other app tabs on selection/sign-out, and detect sign-ins made in another tab on focus. */
export function AccountSessionBoundary({ userId, reloadOnChange = false }: { userId: string | null; reloadOnChange?: boolean }) {
    useEffect(() => {
        let cancelled = false;
        let checking = false;
        const check = async () => {
            if (checking || document.visibilityState === 'hidden') return;
            checking = true;
            try {
                const response = await fetch('/api/account/sessions', { cache: 'no-store' });
                if (response.ok && ((await response.json()) as { userId: string | null }).userId !== userId && !cancelled) {
                    if (reloadOnChange) window.location.reload();
                    else window.location.replace('/app');
                }
            } catch { /* Offline tabs recheck when focus or connectivity returns. */ }
            finally { checking = false; }
        };
        const stored = (event: StorageEvent) => { if (event.key === accountChangedKey) void check(); };
        void check();
        window.addEventListener('storage', stored);
        window.addEventListener('focus', check);
        window.addEventListener('pageshow', check);
        window.addEventListener('online', check);
        document.addEventListener('visibilitychange', check);
        return () => {
            cancelled = true;
            window.removeEventListener('storage', stored);
            window.removeEventListener('focus', check);
            window.removeEventListener('pageshow', check);
            window.removeEventListener('online', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, [userId, reloadOnChange]);
    return null;
}
