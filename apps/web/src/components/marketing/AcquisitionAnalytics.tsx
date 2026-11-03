'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type PropsWithChildren } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@vercel/analytics';
import { brand } from '@uier/brand';
import { allowsAnalytics, analyticsUrl, channels, incomingAttribution, sources, stages, type Attribution, type AcquisitionEvent } from '@/src/lib/acquisition/types';

const names = { sign_in: 'Acquisition sign-in', first_project: 'Acquisition first project', first_review: 'Acquisition first review' };

export function analyticsAllowed() {
    return allowsAnalytics(navigator as Navigator & { globalPrivacyControl?: boolean });
}

function production() {
    return process.env.UIER_DEPLOYMENT_ENV === 'production' && location.origin === brand.url && analyticsAllowed();
}

const AttributionContext = createContext<(() => Attribution) | null>(null);

/** Capture only bounded labels in memory. The app and public site each keep their document context. */
export function AcquisitionProvider({ children }: PropsWithChildren) {
    const arrival = useRef<Attribution | null>(null);
    const getAttribution = useCallback(() => arrival.current ??= incomingAttribution(location.href, document.referrer), []);
    useEffect(() => { if (production()) getAttribution(); }, [getAttribution]);
    return <AttributionContext.Provider value={getAttribution}>{children}</AttributionContext.Provider>;
}

export function useAcquisitionAttribution() {
    const getAttribution = useContext(AttributionContext);
    if (!getAttribution) throw new Error('AcquisitionProvider is required');
    return getAttribution;
}

export function acquisitionEnabled() { return production(); }

export function redactAnalyticsEvent<T extends { url: string }>(event: T): T | null {
    if (!analyticsAllowed()) return null;
    try { return { ...event, url: analyticsUrl(event.url) }; } catch { return null; }
}

/** Count a public document visit without persisting a visitor id or browser storage. */
export function AcquisitionVisitAnalytics() {
    const pathname = usePathname();
    const getAttribution = useAcquisitionAttribution();
    const tracked = useRef(false);
    useEffect(() => {
        if (!production() || tracked.current || pathname === '/app' || pathname.startsWith('/app/') || pathname === '/notifications') return;
        const visit = getAttribution();
        track('Acquisition visit', { channel: visit.channel, source: visit.source });
        tracked.current = true;
    }, [getAttribution, pathname]);
    return null;
}

/** Server-verified milestones are delivered on app navigation/focus, without another polling loop. */
export function AcquisitionActivationAnalytics({ enabled }: { enabled: boolean }) {
    const pathname = usePathname();
    const getAttribution = useAcquisitionAttribution();
    const sending = useRef(false);
    const complete = useRef(false);
    useEffect(() => {
        if (!enabled || !production()) return;
        const sync = async () => {
            if (sending.current || complete.current || document.visibilityState === 'hidden') return;
            sending.current = true;
            try {
                const visit = getAttribution();
                const response = await fetch('/api/acquisition', {
                    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(visit)
                });
                if (!response.ok) return;
                const value = await response.json() as { enabled: boolean; events: AcquisitionEvent[] };
                for (const event of value.events) {
                    if (stages.includes(event.stage) && channels.includes(event.channel) && sources.includes(event.source))
                        track(names[event.stage], { channel: event.channel, source: event.source });
                }
                complete.current = !value.enabled;
            } catch { /* Measurements do not interrupt the app. */ }
            finally { sending.current = false; }
        };
        void sync();
        window.addEventListener('focus', sync);
        return () => window.removeEventListener('focus', sync);
    }, [enabled, getAttribution, pathname]);
    return null;
}
