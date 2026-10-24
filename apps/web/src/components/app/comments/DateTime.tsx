'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * A date and time (mono: a machine wrote it). The server renders it in UTC; the browser switches
 * to the reader's time zone.
 */
export function DateTime({ value }: { value: string | undefined }) {
    const local = useSyncExternalStore(subscribe, () => true, () => false);
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.valueOf()))
        return null;

    const text = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: local ? undefined : 'UTC',
        timeZoneName: local ? undefined : 'short'
    }).format(date);
    return <time dateTime={value} className="font-mono tabular-nums">{text}</time>;
}
