import { useSyncExternalStore } from 'react';
import { getToolbarHost } from '../mount';
import { elementLabel, foundLine, isToolbarNode, pageAnchorElement } from './pageElements';
import type { PageCheck, PageIssue } from './types';

// Core Web Vitals of the reviewed page, measured in this browser with the Performance Timeline:
// buffered entries reach back to the page's load, and observing from the review layer's start
// adds every interaction after it. The toolbar's own elements and interactions are left out.

export type VitalName = 'LCP' | 'CLS' | 'INP';
export type Vital = {
    /** Whether this browser reports the entries the metric needs */
    supported: boolean;
    /** Milliseconds (LCP, INP) or the layout shift score (CLS); none yet without entries */
    value?: number;
    /** The element it is about: the largest paint, the largest shift's, the slowest interaction's */
    element?: Element;
    /** INP only: interactions happened, all of them faster than this browser reports (`value` is then empty) */
    allFast?: boolean;
};
export type WebVitals = Record<VitalName, Vital>;

type LayoutShift = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] };
type LargestPaint = PerformanceEntry & { element?: Element | null };
type EventTiming = PerformanceEntry & { interactionId?: number; target?: Node | null };

const supportedTypes = () => typeof PerformanceObserver === 'function' ? PerformanceObserver.supportedEntryTypes ?? [] : [];

const notMeasured: WebVitals = { LCP: { supported: false }, CLS: { supported: false }, INP: { supported: false } };
let vitals = notMeasured;
const listeners = new Set<() => void>();
/** What stops the observers and listeners, while measuring */
let stops: (() => void)[] | undefined;

function update(name: VitalName, value: Partial<Vital>) {
    vitals = { ...vitals, [name]: { ...vitals[name], ...value } };
    for (const listener of listeners) listener();
}

const asElement = (node: Node | null | undefined) => node instanceof Element ? node : node?.parentElement ?? undefined;

/** A prerendered page counts from its activation, not from the prerender */
function activationStart() {
    const navigation = performance.getEntriesByType?.('navigation')[0] as (PerformanceEntry & { activationStart?: number }) | undefined;
    return navigation?.activationStart ?? 0;
}

function observe(type: string, callback: (entries: PerformanceEntry[]) => void, options: Record<string, unknown> = {}) {
    try {
        const observer = new PerformanceObserver(list => callback(list.getEntries()));
        observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
        stops?.push(() => observer.disconnect());
    } catch { /* Not reported in this browser. */ }
}

function observeLargestPaint() {
    update('LCP', { supported: true });
    observe('largest-contentful-paint', entries => {
        for (const entry of entries as LargestPaint[]) {
            // A candidate in the review layer is not the page's
            if (isToolbarNode(entry.element)) continue;
            update('LCP', { value: Math.max(entry.startTime - activationStart(), 0), element: entry.element ?? undefined });
        }
    });
}

function observeLayoutShifts() {
    update('CLS', { supported: true, value: 0 });
    // The largest session window: shifts less than a second apart, for at most five seconds
    let session: LayoutShift[] = [];
    let sessionValue = 0;
    let largest = 0;
    observe('layout-shift', entries => {
        for (const entry of entries as LayoutShift[]) {
            if (entry.hadRecentInput || (entry.sources?.length && entry.sources.every(source => isToolbarNode(source.node)))) continue;
            const first = session[0];
            const last = session.at(-1);
            if (first && last && entry.startTime - last.startTime < 1000 && entry.startTime - first.startTime < 5000) {
                session.push(entry);
                sessionValue += entry.value;
            } else {
                session = [entry];
                sessionValue = entry.value;
            }
            if (sessionValue > largest) {
                largest = sessionValue;
                const biggest = session.reduce((top, shift) => shift.value > top.value ? shift : top);
                const source = biggest.sources?.map(item => asElement(item.node)).find(element => element?.isConnected && !isToolbarNode(element));
                update('CLS', { value: largest, element: source });
            }
        }
    });
}

/**
 * The review layer's own interactions, by their events' time stamps (an entry's `startTime`): the
 * entry's target is the toolbar's host, or none when the press removed its button. Presses and keys
 * that end on the toolbar are counted, so they are not the page's interactions either. `onInteraction`
 * runs after every press or key, also the fast ones the browser reports no entry for.
 */
function watchToolbarEvents(onInteraction: () => void) {
    const times: number[] = [];
    let interactions = 0;
    const onEvent = (event: Event) => {
        const ended = event.type === 'pointerup' || event.type === 'keyup';
        // After the browser counted it (`performance.interactionCount`)
        if (ended) window.setTimeout(onInteraction, 100);
        const host = getToolbarHost();
        if (!event.composedPath().some(node => node === host || (node instanceof Element && node.hasAttribute('data-uier-thread')))) return;
        times.push(event.timeStamp);
        if (times.length > 200) times.shift();
        if (ended) interactions++;
    };
    const types = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup'];
    for (const type of types) window.addEventListener(type, onEvent, { capture: true, passive: true });
    stops?.push(() => { for (const type of types) window.removeEventListener(type, onEvent, { capture: true }); });
    return { has: (time: number) => times.includes(time), count: () => interactions };
}

function observeInteractions() {
    update('INP', { supported: true });
    const toolbarEvents = watchToolbarEvents(() => record([]));
    const toolbarInteractions = new Set<number>();
    // The longest event of each interaction (an interaction is a press or a key, with several events)
    const interactions = new Map<number, { duration: number; target?: Element }>();
    function record(entries: PerformanceEntry[]) {
        // A press's late recount after measuring stopped
        if (!stops) return;
        for (const entry of entries as EventTiming[]) {
            if (!entry.interactionId || toolbarInteractions.has(entry.interactionId)) continue;
            if (isToolbarNode(entry.target) || toolbarEvents.has(entry.startTime)) {
                toolbarInteractions.add(entry.interactionId);
                interactions.delete(entry.interactionId);
                continue;
            }
            const known = interactions.get(entry.interactionId);
            if (!known || entry.duration > known.duration) {
                interactions.set(entry.interactionId, { duration: entry.duration, target: asElement(entry.target) ?? known?.target });
            }
        }
        // One slower interaction is left out for every 50, like the metric's 98th percentile
        const counted = (performance as Performance & { interactionCount?: number }).interactionCount;
        const total = Math.max(interactions.size, counted === undefined ? 0 : counted - toolbarEvents.count());
        const sorted = [...interactions.values()].sort((a, b) => b.duration - a.duration);
        const chosen = sorted[Math.min(Math.floor(total / 50), sorted.length - 1)];
        update('INP', chosen ? { value: chosen.duration, element: chosen.target?.isConnected ? chosen.target : undefined, allFast: false }
            : { value: undefined, element: undefined, allFast: total > 0 });
    }
    // 16 ms is the shortest event the browser reports; buffered ones from before are 104 ms and longer
    observe('event', record, { durationThreshold: 16 });
    observe('first-input', record);
}

/**
 * Starts measuring (once at a time) and returns what stops it, when the review layer leaves the page.
 * Measuring again reads the buffered entries again.
 */
export function startWebVitals() {
    if (stops) return () => { };
    stops = [];
    const types = supportedTypes();
    if (types.includes('largest-contentful-paint')) observeLargestPaint();
    if (types.includes('layout-shift')) observeLayoutShifts();
    if (types.includes('event')) observeInteractions();
    return () => {
        for (const stop of stops ?? []) stop();
        stops = undefined;
        vitals = notMeasured;
    };
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The measurements so far, updated as the page is used */
export function useWebVitals(): WebVitals {
    return useSyncExternalStore(subscribe, () => vitals);
}

/** The targets, and the reviewed page's measurement in words: "2.1 s", "0.04", "180 ms" */
export const vitalTargets: Record<VitalName, { name: string; good: number; text: (value: number) => string }> = {
    LCP: { name: 'Largest Contentful Paint', good: 2500, text: value => `${(value / 1000).toFixed(1)} s` },
    CLS: { name: 'Cumulative Layout Shift', good: 0.1, text: value => value === 0 ? '0' : value.toFixed(2) },
    INP: { name: 'Interaction to Next Paint', good: 200, text: value => `${Math.round(value)} ms` }
};

const vitalWarnings: Record<VitalName, string> = {
    LCP: 'The main content shows late.',
    CLS: 'Content moves while the page is used.',
    INP: 'The page responds slowly.'
};

/** A measurement as a check of the SEO panel, with a comment for one over its target */
export function vitalCheck(name: VitalName, vital: Vital): PageCheck {
    const target = vitalTargets[name];
    const label = `${target.name} (${name})`;
    const base = { id: `vital-${name}`, label, issues: [] as PageIssue[] };
    if (!vital.supported) return { ...base, state: 'none', reason: 'Not measured in this browser.' };
    if (vital.value === undefined) {
        return vital.allFast
            ? { ...base, state: 'pass', reason: 'Every interaction so far took under 104 ms.' }
            : { ...base, state: 'none', reason: name === 'INP' ? 'No interactions yet. Use the page, then look again.' : 'Not measured yet.' };
    }
    const value = target.text(vital.value);
    const good = target.text(target.good);
    if (vital.value <= target.good) return { ...base, state: 'pass', measure: value, reason: `Within the ${good} target.` };
    const element = pageAnchorElement(vital.element);
    return {
        ...base, state: 'warn', measure: value, reason: `Over the ${good} target. ${vitalWarnings[name]}`,
        issues: [{
            key: `vital:${name}`,
            summary: `${target.name} is ${value}.`,
            comment: `Core Web Vitals: ${target.name} (${name}) is ${value} in this browser. The target is ${good} or less. ${vitalWarnings[name]}${foundLine('Element', element && elementLabel(element))}`,
            check: { type: 'web-vitals', id: name.toLowerCase() },
            element,
            label: element && elementLabel(element)
        }]
    };
}
