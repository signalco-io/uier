import { useEffect, useState } from 'react';
import { Timeago } from '@signalco/ui/Timeago';

// Anything newer reads "just now" instead of "0 seconds ago"
const justNowSeconds = 10;

/** Relative time of a thread item ("just now", "5 minutes ago") */
export function CommentTime({ date }: { date: Date }) {
    const [now, setNow] = useState(() => Date.now());
    // Also covers a server clock that is slightly ahead of this device
    const justNow = now - date.valueOf() < justNowSeconds * 1000;

    useEffect(() => {
        if (!justNow) {
            return;
        }
        const timeout = window.setTimeout(
            () => setNow(Date.now()),
            Math.max(date.valueOf() + justNowSeconds * 1000 - Date.now(), 0) + 50);
        return () => window.clearTimeout(timeout);
    }, [date, justNow]);

    return justNow
        ? <time dateTime={date.toISOString()}>just now</time>
        : <Timeago date={date} />;
}
