'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useEffectEvent, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToComments, type RealtimeTicket } from '@uier/toolbar/realtime';

/** Other sidebar projects can change without a notification for the project being read. */
const SHELL_SAFETY_MS = 5 * 60_000;

/** Refresh changed server-authorized snapshots in place; leave an unchanged idle shell alone. */
export function RealtimeComments({ projectId, revision, environment, author }: { projectId: string; revision: string; environment?: string; author?: string }) {
    const { t } = useAppI18n();
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const queued = useRef<'check' | 'refresh' | undefined>(undefined);
    const checking = useRef<AbortController | undefined>(undefined);
    const renderedRevision = useRef(revision);
    const lastShellRefresh = useRef(0);
    useEffect(() => {
        renderedRevision.current = revision;
        // An action or RSC response is a newer snapshot than an older in-flight check.
        checking.current?.abort(); checking.current = undefined;
    }, [revision]);
    const refresh = useEffectEvent(() => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        checking.current?.abort(); checking.current = undefined;
        lastShellRefresh.current = Date.now();
        startTransition(() => router.refresh());
    });
    const reconcile = useEffectEvent((force = false) => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        if (pending) {
            if (force || queued.current !== 'refresh') queued.current = force ? 'refresh' : 'check';
            return;
        }
        if (force || Date.now() - lastShellRefresh.current >= SHELL_SAFETY_MS) { refresh(); return; }
        if (checking.current) { queued.current ??= 'check'; return; }
        queued.current = undefined;
        const controller = new AbortController();
        checking.current = controller;
        const before = renderedRevision.current;
        // Environment and author are the only server scopes; local presentation filters do not
        // invalidate the snapshot. The server validates both again for the current member.
        const scope = new URLSearchParams();
        if (environment) scope.set('environment', environment);
        if (author) scope.set('author', author);
        void (async () => {
            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments/revision?${scope}`, {
                    cache: 'no-store', credentials: 'same-origin', signal: controller.signal
                });
                const data = response.ok ? await response.json() as { revision?: unknown } : null;
                if (controller.signal.aborted || checking.current !== controller || before !== renderedRevision.current) return;
                // Authorization loss and malformed/failed checks use the normal server page too.
                // The RSC response supplies the next baseline; never advance it from this check.
                if (!response.ok || typeof data?.revision !== 'string' || data.revision !== before) refresh();
            } catch {
                if (!controller.signal.aborted) refresh();
            } finally {
                if (checking.current === controller) checking.current = undefined;
                if (!controller.signal.aborted && queued.current) {
                    const force = queued.current === 'refresh'; queued.current = undefined; reconcile(force);
                }
            }
        })();
    });
    useEffect(() => {
        if (!pending && queued.current) {
            const force = queued.current === 'refresh'; queued.current = undefined; reconcile(force);
        }
    }, [pending]);
    useEffect(() => {
        let connected = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        lastShellRefresh.current = Date.now();
        const schedule = () => {
            clearTimeout(timer);
            if (document.visibilityState !== 'visible' || !navigator.onLine) return;
            timer = setTimeout(() => { reconcile(); schedule(); }, connected ? 60_000 : 30_000);
        };
        const unsubscribe = subscribeToComments({
            ticket: async () => {
                const response = await fetch(`/api/realtime/ticket?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(t("Realtime unavailable."));
                return response.json() as Promise<RealtimeTicket>;
            },
            // Real changes keep their immediate HTTP reconciliation. Ready, focus and safety
            // signals check for changes first, including edits missed while disconnected.
            changed: reason => reconcile(reason === 'change'),
            connected: value => {
                if (connected === value) return;
                connected = value;
                schedule();
            }
        });
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('online', schedule);
        window.addEventListener('offline', schedule);
        schedule();
        return () => {
            unsubscribe(); clearTimeout(timer); queued.current = undefined;
            checking.current?.abort(); checking.current = undefined;
            document.removeEventListener('visibilitychange', schedule);
            window.removeEventListener('online', schedule);
            window.removeEventListener('offline', schedule);
        };
    }, [projectId]);
    return null;
}
