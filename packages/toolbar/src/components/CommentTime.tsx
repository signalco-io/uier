import { useEffect, useState } from 'react';
import { useMessages, useToolbarLanguage } from '../i18n';

// The first minute reads "just now" instead of counting seconds (the app's relative times do the same)
const justNowSeconds = 60;

const minute = 60;
const hour = minute * 60;
const day = hour * 24;
const week = day * 7;
const month = day * 30;
const year = day * 365;

/** The unit and count of an age in seconds, as the UI kit's Timeago rounded them ("5 minutes", "2 weeks") */
function relativeParts(seconds: number): [number, Intl.RelativeTimeFormatUnit] {
    if (seconds < minute) return [Math.round(seconds), 'second'];
    if (seconds < hour) return [Math.round(seconds / minute), 'minute'];
    if (seconds < day) return [Math.round(seconds / hour), 'hour'];
    if (seconds < week) return [Math.round(seconds / day), 'day'];
    if (seconds < month) return [Math.round(seconds / week), 'week'];
    if (seconds < year) return [Math.round(seconds / month), 'month'];
    return [Math.round(seconds / year), 'year'];
}

/** How long until the text can change: every minute in the first hour, then every hour, then every week */
function refreshDelay(seconds: number) {
    return (seconds < hour ? minute : seconds < day ? hour : week) * 1000;
}

/** Relative time of a thread item ("just now", "5 minutes ago", "vor 5 Minuten"), in the toolbar's language */
export function CommentTime({ date }: { date: Date }) {
    const t = useMessages();
    const language = useToolbarLanguage();
    const [now, setNow] = useState(() => Date.now());
    const age = Math.max(now - date.valueOf(), 0) / 1000;
    // Also covers a server clock that is slightly ahead of this device
    const justNow = now - date.valueOf() < justNowSeconds * 1000;

    useEffect(() => {
        const timeout = window.setTimeout(
            () => setNow(Date.now()),
            justNow ? Math.max(date.valueOf() + justNowSeconds * 1000 - Date.now(), 0) + 50 : refreshDelay(age));
        return () => window.clearTimeout(timeout);
    }, [date, justNow, age]);

    if (justNow) return <time dateTime={date.toISOString()}>{t.common.justNow}</time>;
    const [count, unit] = relativeParts(age);
    return (
        <time dateTime={date.toISOString()} title={date.toLocaleString(language)}>
            {new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(-count, unit)}
        </time>
    );
}
