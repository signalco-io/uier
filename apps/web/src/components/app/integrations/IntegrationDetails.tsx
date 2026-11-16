import type { ReactNode, Ref } from 'react';
import { cn } from '@/src/lib/utils';

/**
 * A connection at a glance: where shared feedback goes and when it last went there. One row per fact,
 * the term beside its value (stacked on a phone), with an optional action for the facts people change.
 * A list with a `ref` can take the focus (a form that closed above it moves the focus there); a list
 * without rows takes no room.
 */
export function IntegrationDetails({ children, className, ref }: { children: ReactNode; className?: string; ref?: Ref<HTMLDListElement> }) {
    return <dl ref={ref} tabIndex={ref ? -1 : undefined} data-integration-details
        className={cn('m-0 divide-y rounded-lg border text-sm outline-none empty:hidden', className)}>{children}</dl>;
}

export function IntegrationDetail({ term, children, action }: { term: ReactNode; children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex min-h-11 flex-col gap-x-4 gap-y-0.5 px-3 py-2 sm:flex-row sm:items-center">
            <dt className="shrink-0 text-muted-foreground sm:w-36">{term}</dt>
            <dd className="m-0 flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words">{children}</span>
                {action}
            </dd>
        </div>
    );
}
