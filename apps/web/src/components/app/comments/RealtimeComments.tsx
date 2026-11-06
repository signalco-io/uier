'use client';

import { useEffect, useEffectEvent, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToComments, type RealtimeTicket } from '@uier/toolbar/realtime';

/** Refresh server-authorized snapshots in place, preserving composers and optimistic actions. */
export function RealtimeComments({ projectId }: { projectId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const queued = useRef(false);
    const reconcile = useEffectEvent(() => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        if (pending) { queued.current = true; return; }
        queued.current = false;
        startTransition(() => router.refresh());
    });
    useEffect(() => { if (!pending && queued.current) reconcile(); }, [pending]);
    useEffect(() => {
        let connected = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            clearTimeout(timer);
            if (document.visibilityState !== 'visible' || !navigator.onLine) return;
            timer = setTimeout(() => { reconcile(); schedule(); }, connected ? 60_000 : 30_000);
        };
        const unsubscribe = subscribeToComments({
            ticket: async () => {
                const response = await fetch(`/api/realtime/ticket?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Realtime unavailable.');
                return response.json() as Promise<RealtimeTicket>;
            },
            changed: () => reconcile(),
            connected: value => {
                if (connected === value) return;
                connected = value;
                schedule();
            }
        });
        // Keep a safety read for per-reviewer cursors, which live outside comment documents.
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('online', schedule);
        window.addEventListener('offline', schedule);
        schedule();
        return () => {
            unsubscribe(); clearTimeout(timer); queued.current = false;
            document.removeEventListener('visibilitychange', schedule);
            window.removeEventListener('online', schedule);
            window.removeEventListener('offline', schedule);
        };
    }, [projectId]);
    return null;
}
