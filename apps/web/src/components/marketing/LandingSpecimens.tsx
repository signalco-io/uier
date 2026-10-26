import type { ReactNode } from 'react';
import { Copy, Globe, Search } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';

// Static pictures of the review layer and the app for the landing page's feature tiles. The live
// review layer is the toolbar at the bottom of the window (BRAND.md, "Marketing and metadata"); these
// only illustrate what the tile's text says, so they are hidden from assistive technologies. The
// example content is an imaginary restaurant site, so none of it reads as a claim about uier.

const floating = 'shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:shadow-none';

/** The picture area at the top of a feature tile */
export function Specimen({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div aria-hidden="true" className={cx('relative flex h-60 justify-center overflow-hidden border-b bg-muted/50 px-6', className)}>
            {children}
        </div>
    );
}

function Avatar({ initials }: { initials: string }) {
    return <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials}</span>;
}

/** "Open" with the status dot, as threads show it (ink = open) */
function OpenStatus() {
    return (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
            <span className="size-1.5 rounded-full bg-foreground" />
            Open
        </span>
    );
}

/**
 * A comment on an element (the outlined row) and one on selected words, with the open thread of
 * the first. Another part of the example site than the how-it-works stage, so the two do not repeat.
 */
export function PinnedSpecimen() {
    const hours = [['Monday to Friday', '12–23'], ['Saturday', '12–24'], ['Sunday', 'Closed']];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[600px] items-center justify-between gap-8">
                <div className="flex w-full max-w-[260px] flex-col">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Opening hours</span>
                    <div className="mt-3 flex flex-col text-sm">
                        {hours.map(([day, time]) => (
                            // Point mode outlines the element under the pointer: 2px dashed accent at 2px offset
                            <span
                                key={day}
                                className={cx('relative flex justify-between border-b py-1.5 tabular-nums', day === 'Sunday' && 'rounded-sm border-transparent outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]')}>
                                <span>{day}</span>
                                <span className="text-muted-foreground">{time}</span>
                                {day === 'Sunday' && <Pin count={2} size={26} className="absolute left-[64%] top-[55%]" />}
                            </span>
                        ))}
                    </div>
                    <span className="mt-5 text-sm text-muted-foreground">
                        Book online or <span className="relative rounded-[3px] bg-[hsl(var(--brand-selection))] text-foreground">call us<Pin count={1} size={22} className="absolute left-full top-full -ml-1 -mt-1" /></span>.
                    </span>
                </div>
                <div className={cx('hidden w-56 shrink-0 flex-col gap-2.5 rounded-xl border bg-popover p-3.5 text-popover-foreground sm:flex', floating)}>
                    <div className="flex items-center gap-2">
                        <Avatar initials="MI" />
                        <span className="text-[13px] font-medium">Mia</span>
                        <span className="font-mono text-[11px] text-muted-foreground">5m</span>
                    </div>
                    <span className="text-[13px] leading-5">We open on Sundays since May. Can this say 12–22?</span>
                </div>
            </div>
        </Specimen>
    );
}

/** The saved screenshot of a comment and the device details beside it */
export function ContextSpecimen() {
    const details = [
        ['Page', '/menu'],
        ['Device', 'Mobile · 390×844'],
        ['Browser', 'Safari'],
        ['System', 'iOS']
    ];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[280px] flex-col overflow-hidden rounded-xl border bg-background">
                <div className="relative flex h-24 items-center justify-center border-b bg-muted/50">
                    <span className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Book a table</span>
                    <Pin count={1} size={20} className="absolute left-[60%] top-[52%]" />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-3.5 text-xs">
                    {details.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="font-mono tabular-nums">{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </Specimen>
    );
}

/** A thread with a mention and an assignee */
export function ThreadSpecimen() {
    return (
        <Specimen className="items-center">
            <div className={cx('flex w-full max-w-[280px] flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                <div className="flex items-center gap-2 px-3.5 pt-3">
                    <OpenStatus />
                    <span className="font-mono text-xs text-muted-foreground">#14</span>
                </div>
                <div className="flex flex-col gap-2 px-3.5 py-3">
                    <div className="flex items-center gap-2">
                        <Avatar initials="MI" />
                        <span className="text-[13px] font-medium">Mia</span>
                        <span className="font-mono text-[11px] text-muted-foreground">2h</span>
                    </div>
                    <span className="text-[13px] leading-5"><span className="font-medium">@Leo</span> the prices here are from last year. Can you update them?</span>
                </div>
                <div className="flex items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
                    <Avatar initials="LE" />
                    Assigned to Leo
                </div>
            </div>
        </Specimen>
    );
}

/** The inbox sidebar: always ink, like every part of the review layer (BRAND.md, "The review layer") */
export function InboxSpecimen() {
    const groups = [
        {
            label: 'This page',
            threads: [{ count: 2, text: 'The prices here are from last year.', meta: '/menu · 2h', unread: true }]
        },
        {
            label: 'Other pages',
            threads: [
                { count: 1, text: 'Opening hours are cut off on mobile.', meta: '/contact · 1d', unread: true },
                { count: 3, text: 'Can the map open in the maps app?', meta: '/contact · 3d', done: true }
            ]
        }
    ];
    return (
        <Specimen className="items-start pt-8">
            <div className="dark w-full max-w-[520px] rounded-2xl border bg-background p-2 text-foreground">
                <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                        Comments
                        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1.5 text-[11px] font-semibold tabular-nums text-[hsl(var(--brand-accent-foreground))]">2</span>
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                        <span className="flex rounded-md bg-muted p-0.5 text-xs">
                            <span className="rounded-[5px] bg-accent px-2 py-0.5 text-foreground">Open</span>
                            <span className="px-2 py-0.5">Done</span>
                            <span className="px-2 py-0.5">All</span>
                        </span>
                        <Search size={16} strokeWidth={1.75} />
                    </span>
                </div>
                {groups.map(group => (
                    <div key={group.label} className="flex flex-col">
                        <span className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label}</span>
                        {group.threads.map(thread => (
                            <div key={thread.text} className="flex items-center gap-3 rounded-xl px-2 py-2">
                                <Pin count={thread.count} size={24} className="shrink-0" />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[13px]">{thread.text}</span>
                                    <span className="font-mono text-[11px] text-muted-foreground">{thread.meta}</span>
                                </span>
                                {thread.done
                                    ? <span className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]" />
                                    : thread.unread && <span className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-accent))]" />}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </Specimen>
    );
}

/** A thread copied as an issue (the Markdown of the feedback context packet, shortened) */
export function HandoffSpecimen() {
    const lines: [string, boolean][] = [
        ['# The prices here are from last year.', true],
        ['## Page and anchor', true],
        ['/menu · Selected text', false],
        ['## Original browser context', true],
        ['Device: Mobile', false],
        ['Viewport: 390×844 CSS px', false],
        ['Browser: Safari', false]
    ];
    return (
        <Specimen className="items-start pt-8">
            <div className="flex w-full max-w-[300px] flex-col rounded-xl border bg-background">
                <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Issue Markdown</span>
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium">
                        <Copy size={12} strokeWidth={1.75} />
                        Copy issue
                    </span>
                </div>
                <div className="flex flex-col gap-1 p-3.5 font-mono text-[11px] leading-4">
                    {lines.map(([line, heading]) => (
                        <span key={line} className={cx('truncate', heading ? 'text-foreground' : 'text-muted-foreground')}>{line}</span>
                    ))}
                </div>
            </div>
        </Specimen>
    );
}

/** A project's addresses with their environment labels, as the feedback filter lists them */
export function EnvironmentsSpecimen() {
    const environments = [
        { label: 'Production', origin: 'example.com', open: 12 },
        { label: 'Staging', origin: 'staging.example.com', open: 5 },
        { label: 'Preview', origin: 'pr-42.example.dev', open: 1 }
    ];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[280px] flex-col gap-0.5 rounded-xl border bg-background p-1.5">
                {environments.map((environment, index) => (
                    <div key={environment.label} className={cx('flex items-center gap-2.5 rounded-md px-2.5 py-2', index === 1 && 'bg-muted')}>
                        <Globe size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[13px] font-medium">{environment.label}</span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground">{environment.origin}</span>
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">{environment.open} open</span>
                    </div>
                ))}
            </div>
        </Specimen>
    );
}
