import type { ReactNode } from 'react';

/**
 * A titled list of a workspace tab (people, invitations): its name, how many it holds and what it lists. The tab's
 * loading state draws the same heading without `count` (and without `id`, which the loaded section keeps to itself).
 */
export function ListSection({ id, title, count, description, children }: {
    id?: string;
    title: string;
    count?: number;
    description: string;
    children: ReactNode;
}) {
    const titleId = id ? `${id}-title` : undefined;
    return (
        <section aria-labelledby={titleId} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
                <h2 id={titleId} className="m-0 flex items-center gap-2 text-base leading-6 font-semibold tracking-[-0.01em]">
                    {title}
                    {count !== undefined && <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
                </h2>
                <p className="m-0 text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
        </section>
    );
}
