'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/** The server renders dates in UTC; the browser switches to the reader's time zone */
function useLocal() {
    return useSyncExternalStore(subscribe, () => true, () => false);
}

function parse(value: string | undefined) {
    if (!value)
        return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
}

function formatDateTime(date: Date, local: boolean) {
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: local ? undefined : 'UTC',
        timeZoneName: local ? undefined : 'short'
    }).format(date);
}

/** A date and time (mono: a machine wrote it) */
export function DateTime({ value }: { value: string | undefined }) {
    const local = useLocal();
    const date = parse(value);
    if (!date)
        return null;
    return <time dateTime={value} className="font-mono tabular-nums">{formatDateTime(date, local)}</time>;
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60]
];

const long = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
// Short units ("3 min ago", "2 hr ago", "2 wk ago"); "yesterday" stays a word, but not "last wk" or "last yr"
const short = new Intl.RelativeTimeFormat('en-GB', { numeric: 'always', style: 'short' });
const shortDay = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto', style: 'short' });

function relativeText(date: Date, now: number, compact: boolean) {
    const seconds = (date.valueOf() - now) / 1000;
    const match = units.find(([, size]) => Math.abs(seconds) >= size);
    if (!match)
        return 'just now';
    const format = !compact ? long : match[0] === 'day' ? shortDay : short;
    return format.format(Math.round(seconds / match[1]), match[0]);
}

/**
 * One clock for every relative time on the page: a single timer while any is shown, paused while the
 * tab is hidden and caught up when it is shown again. Each time reads its own text from it, so a tick
 * re-renders only the times whose words change ("just now" to "1 minute ago"), never the list around them.
 */
const tickMs = 10_000;
const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: number | undefined;

/** The clock's time; with nothing subscribed it isn't ticking, so the first render after a pause catches it up */
function currentNow() {
    if (!clockListeners.size && Date.now() - clockNow >= tickMs) clockNow = Date.now();
    return clockNow;
}

function tick() {
    clockNow = Date.now();
    for (const listener of clockListeners) listener();
}

function syncClock() {
    window.clearInterval(clockTimer);
    clockTimer = undefined;
    if (!clockListeners.size || document.visibilityState !== 'visible') return;
    tick();
    clockTimer = window.setInterval(tick, tickMs);
}

function subscribeClock(listener: () => void) {
    clockListeners.add(listener);
    if (clockListeners.size === 1) {
        document.addEventListener('visibilitychange', syncClock);
        syncClock();
    }
    return () => {
        clockListeners.delete(listener);
        if (!clockListeners.size) {
            document.removeEventListener('visibilitychange', syncClock);
            syncClock();
        }
    };
}

/**
 * How long ago or from now, in words ("yesterday", "in 6 days"), with the date and time on hover; it keeps up as time passes.
 * `short` abbreviates the units for compact rows and cards ("3 min ago"); sentences (a thread's messages, its activity) keep them whole.
 */
export function RelativeTime({ value, short: compact = false }: { value: string | undefined; short?: boolean }) {
    const local = useLocal();
    const date = parse(value);
    const text = useSyncExternalStore(subscribeClock,
        () => date && relativeText(date, currentNow(), compact),
        () => date && relativeText(date, Date.now(), compact));
    if (!date || !text)
        return null;
    // Relative to now, so the server's and the browser's text can differ by a unit at a boundary
    return <time dateTime={value} title={formatDateTime(date, local)} suppressHydrationWarning>{text}</time>;
}
