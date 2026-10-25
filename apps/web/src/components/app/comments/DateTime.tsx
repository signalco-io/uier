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

/** How long ago or from now, in words ("yesterday", "in 6 days"), with the date and time on hover */
export function RelativeTime({ value }: { value: string | undefined }) {
    const local = useLocal();
    const date = parse(value);
    if (!date)
        return null;

    const seconds = (date.valueOf() - Date.now()) / 1000;
    const match = units.find(([, size]) => Math.abs(seconds) >= size);
    const text = match
        ? new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' }).format(Math.round(seconds / match[1]), match[0])
        : 'just now';
    // Relative to now, so the server's and the browser's text can differ by a unit at a boundary
    return <time dateTime={value} title={formatDateTime(date, local)} suppressHydrationWarning>{text}</time>;
}
