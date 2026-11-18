'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';

// What a page draws where its data goes while it loads (docs/design/loading-states). A page's frame, headings, tabs
// and controls that need no data are real UI in its shell; these outlines stand only for the data, in its shape:
// rows for a list, a titled card for a settings section, card outlines for a grid.
//
// Motion: a shell that a navigation shows at once is still (`Bar`). A placeholder inside a loaded page pulses
// (`Skeleton` with `motion-reduce:animate-none`), so a person can tell "arriving" from "empty".

/**
 * A placeholder bar or block; give it its size (and `rounded-full` for a circle). Still, for a shell; with `pulse`
 * for what loads inside a page that is already there (still again under reduced motion).
 */
export function Bar({ className, pulse = false, ...props }: ComponentProps<'div'> & { pulse?: boolean }) {
    return <Skeleton aria-hidden="true" className={cn(pulse ? 'motion-reduce:animate-none' : 'animate-none', className)} {...props} />;
}

/**
 * The one status of a loading region: `label` is announced once (and names the region for tests); everything in it is
 * hidden from assistive technology. `label` is a source phrase, translated here.
 */
export function Loading({ label, children, className, ...props }: { label: string; children: ReactNode } & Omit<ComponentProps<'div'>, 'role' | 'aria-label'>) {
    const { t } = useAppI18n();
    return (
        <div role="status" aria-label={t(label)} className={className} {...props}>
            <span className="sr-only">{t(label)}…</span>
            <div aria-hidden="true" className="contents">{children}</div>
        </div>
    );
}

/**
 * `PageHeader`'s geometry for a title that is data (a team's or a person's name): the 34 px title line, the 20 px
 * description line and, with `media`, the 56 px tile beside both (a project's favicon; `round` for a person's avatar).
 * A fixed title is not an outline: render `PageHeader`.
 */
export function HeaderOutline({ media = false, description = true, className }: { media?: boolean | 'round'; description?: boolean; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('flex min-w-0 items-center gap-4 pb-6', className)}>
            {media && <Bar className={cn('size-14 shrink-0', media === 'round' ? 'rounded-full' : 'rounded-xl')} />}
            <div className="flex min-w-0 flex-col gap-1">
                <span className="flex h-[34px] items-center"><Bar className="h-[26px] w-56 max-w-full" /></span>
                {description && <span className="flex h-5 items-center"><Bar className="h-4 w-36" /></span>}
            </div>
        </div>
    );
}

/** A label over a control, as `Field` lays them out */
function FieldOutline({ wide = false }: { wide?: boolean }) {
    return (
        <div className="flex flex-col gap-2">
            <Bar className="h-4 w-28" />
            <Bar className={cn('h-9 rounded-lg', wide ? 'w-full' : 'w-full max-w-md')} />
        </div>
    );
}

/** Fields of a form, then its button where `submit` */
export function FormOutline({ fields = 3, submit = true, className }: { fields?: number; submit?: boolean; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('flex flex-col gap-6', className)}>
            {Array.from({ length: fields }, (_, field) => <FieldOutline key={field} wide />)}
            {submit && <Bar className="h-9 w-28 self-start rounded-lg" />}
        </div>
    );
}

/**
 * A settings section while it loads: `Section`'s card with its real `title` (a fixed, already translated heading; a
 * bar without one), a line of description, `fields` rows and, with `footer`, the band its Save sits in.
 */
export function SectionOutline({ title, description = true, fields = 2, footer = true, pulse = false, children, className }: {
    title?: ReactNode;
    description?: boolean;
    fields?: number;
    footer?: boolean;
    /** The section loads inside a page that is already there: its own bars pulse (pass it on to `children`'s too) */
    pulse?: boolean;
    /** In place of the field rows, for a section that is not a form (a list, a grid of numbers) */
    children?: ReactNode;
    className?: string;
}) {
    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle>
                    {title
                        ? <h2 className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
                        : <span aria-hidden="true" className="flex h-6 items-center"><Bar pulse={pulse} className="h-4 w-40" /></span>}
                </CardTitle>
                {description && <span aria-hidden="true" className="flex h-5 items-center"><Bar pulse={pulse} className="h-3.5 w-72 max-w-full" /></span>}
            </CardHeader>
            <CardContent aria-hidden="true" className="flex flex-col gap-6">
                {children ?? Array.from({ length: fields }, (_, field) => <FieldOutline key={field} />)}
            </CardContent>
            {footer && <CardFooter aria-hidden="true" className="justify-end border-t"><Bar className="h-9 w-16 rounded-lg" /></CardFooter>}
        </Card>
    );
}

const rowWidths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36', 'w-52'];

/**
 * Rows of a list in one bordered box (people, teams, activity): an avatar where `avatar`, a name and a second line,
 * and something at the row's end where `trailing`
 */
export function ListOutline({ rows = 5, avatar = true, trailing = true, className }: { rows?: number; avatar?: boolean; trailing?: boolean; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('flex flex-col divide-y rounded-xl border', className)}>
            {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3">
                    {avatar && <Bar className="size-8 shrink-0 rounded-full" />}
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Bar className={cn('h-4 max-w-full', rowWidths[row % rowWidths.length])} />
                        <Bar className="h-3 w-24" />
                    </span>
                    {trailing && <Bar className="h-4 w-16 shrink-0" />}
                </div>
            ))}
        </div>
    );
}

/** A table: a header row and `rows` rows of `columns` cells, the first column the widest */
export function TableOutline({ columns = 4, rows = 5, className }: { columns?: number; rows?: number; className?: string }) {
    const template = { gridTemplateColumns: `minmax(0, 2fr) repeat(${columns - 1}, minmax(0, 1fr))` };
    return (
        <div aria-hidden="true" className={cn('rounded-xl border', className)}>
            <div style={template} className="grid gap-4 border-b px-4 py-3">
                {Array.from({ length: columns }, (_, cell) => <Bar key={cell} className="h-4 w-20 max-w-full" />)}
            </div>
            {Array.from({ length: rows }, (_, row) => (
                <div key={row} style={template} className="grid items-center gap-4 border-b px-4 py-3 last:border-b-0">
                    <Bar className={cn('h-4 max-w-full', rowWidths[row % rowWidths.length])} />
                    {Array.from({ length: columns - 1 }, (_, cell) => <Bar key={cell} className="h-4 w-16 max-w-full" />)}
                </div>
            ))}
        </div>
    );
}

/** Cards in as many 18rem columns as the width holds (up to three), like the projects list */
export function CardGridOutline({ cards = 3, className }: { cards?: number; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-4', className)}>
            {Array.from({ length: cards }, (_, card) => (
                <div key={card} className="flex items-start gap-3 rounded-xl border p-4">
                    <Bar className="size-10 shrink-0 rounded-lg" />
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                        <Bar className={cn('h-4 max-w-full', rowWidths[card % rowWidths.length])} />
                        <Bar className="h-3 w-32 max-w-full" />
                    </span>
                </div>
            ))}
        </div>
    );
}

/** Numbers with their labels in a bordered grid (usage): two columns, three from `sm`; `pulse` inside a loaded page */
export function StatGridOutline({ cells = 6, pulse = false, className }: { cells?: number; pulse?: boolean; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3', className)}>
            {Array.from({ length: cells }, (_, cell) => (
                <div key={cell} className="-mr-px -mb-px flex flex-col gap-2 border-r border-b p-4">
                    <Bar pulse={pulse} className="h-4 w-24 max-w-full" />
                    <Bar pulse={pulse} className="h-7 w-12" />
                </div>
            ))}
        </div>
    );
}
