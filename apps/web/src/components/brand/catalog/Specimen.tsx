'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { cx } from '@uier/ui-primitives/cx';
import { catalogEntry, sourceUrl, stateAnchor } from './catalog';

// A catalog entry and its states. Comments from the review toolbar anchor to these elements: the
// entry by its id, each state by its `data-anchor` (`ui-button/disabled`), so a comment stays on
// the same state when states are added or reordered. Keep a state's label once it has comments.

const EntryContext = createContext<string | null>(null);

/** One component: its name, source and a grid of its states */
export function Specimen({ id, columns = 3, children }: { id: string; columns?: 1 | 2 | 3; children: ReactNode }) {
    const entry = catalogEntry(id);
    return (
        <article id={id} aria-labelledby={`${id}-name`} className="min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border">
            <header className="flex flex-col gap-1 border-b px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 id={`${id}-name`} className="text-base font-semibold">{entry.name}</h3>
                    <a href={sourceUrl(entry.source)} className="font-mono text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                        {entry.source}
                    </a>
                </div>
                {entry.note && <p className="max-w-[720px] text-sm leading-relaxed text-muted-foreground">{entry.note}</p>}
            </header>
            <EntryContext value={id}>
                <div className={cx(
                    '-mb-px -mr-px grid grid-cols-1 [&>*]:border-b [&>*]:border-r',
                    columns >= 2 && 'md:grid-cols-2',
                    columns === 3 && 'xl:grid-cols-3'
                )}>
                    {children}
                </div>
            </EntryContext>
        </article>
    );
}

/** One state of the entry around it, with its label under it */
export function State({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    const entryId = useContext(EntryContext);
    if (!entryId) throw new Error(`State "${label}" is outside a Specimen`);
    return (
        <figure data-anchor={stateAnchor(entryId, label)} className="m-0 flex min-w-0 flex-col gap-4 p-5">
            <div className={cx('flex min-h-10 flex-1 flex-wrap content-start items-center gap-3', className)}>{children}</div>
            <figcaption className="font-mono text-[11px] text-muted-foreground">{label}</figcaption>
        </figure>
    );
}
