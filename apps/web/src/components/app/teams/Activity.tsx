import Link from 'next/link';
import type { DbAccessEvent } from '@/src/lib/app/model';
import { DateTime } from '../comments/DateTime';

export function AccessActivity({
    events,
    names,
    next
}: {
    events: DbAccessEvent[];
    names: Map<string, string>;
    next?: string;
}) {
    return (
        <div className="flex flex-col gap-4">
            <p className="m-0 text-sm text-muted-foreground">
                Access history is kept for 180 days. Only workspace admins can see it.
            </p>
            {events.length ? (
                <ol className="m-0 list-none divide-y rounded-xl border p-0">
                    {events.map((event) => (
                        <li key={event.id} className="flex flex-col gap-2 p-4 text-sm">
                            <p className="m-0">
                                <span className="font-medium">{names.get(event.actorId) ?? event.actorId}</span> ·{' '}
                                {event.action} · <DateTime value={event.at} />
                            </p>
                            <p className="m-0 break-all text-xs text-muted-foreground">{event.targetIds.join(', ')}</p>
                            <details>
                                <summary className="cursor-pointer">Grant change</summary>
                                <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                                    {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
                                </pre>
                            </details>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">No access changes yet.</p>
            )}
            {next && <Link href={next}>Next activity page</Link>}
        </div>
    );
}
