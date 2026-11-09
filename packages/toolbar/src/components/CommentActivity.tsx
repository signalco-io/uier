import { useId, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import type { CommentItem } from './@types/Comments';
import { CommentTime } from './CommentTime';

/** Small enough for pin popovers as well as the inbox. The server already filtered every entry. */
export function CommentActivity({ entries }: { entries: CommentItem['history'] }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    if (!entries?.length) return null;
    return <div className="min-w-0">
        <Button variant="plain" size="xs" aria-expanded={open} aria-controls={id}
            className="text-muted-foreground" onClick={() => setOpen(value => !value)}>Activity ({entries.length})</Button>
        <ol id={id} hidden={!open} aria-label="Thread activity" className="mt-2 max-h-48 space-y-3 overflow-y-auto text-xs text-muted-foreground">
            {open && entries.map(entry => <li key={entry.id} className="space-y-1 break-words">
                <p>{entry.description}</p>
                <span className="font-mono tabular-nums"><CommentTime date={new Date(entry.at)} /></span>
            </li>)}
        </ol>
    </div>;
}
