'use client';

import { Close, ExpandDown, Search } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { StatusBadge, type Stage } from '../LandingSpecimens';
import { appear, fade, FeatureCover, type CoverCaption } from './FeatureCover';

// /features/inbox: the toolbar's inbox docked beside the example site. It starts on this page's threads,
// the location picker opens and All pages is chosen (the other pages' threads come in, with their
// paths), then the unread line filters to the unread threads. Its parts are the inbox's
// (packages/toolbar components/sidebar: the title row with search and Close, LocationPicker split into
// environments and pages with their counts, Assigned to me and the unread line, the Active, Done and
// All tabs, the cards); recheck with packages/toolbar/docs/inbox.md.

const phases = [
    { name: 'idle', ms: 1300 },
    { name: 'open', ms: 1400 },
    { name: 'all', ms: 2000 },
    { name: 'unread', ms: 2000 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'The inbox lists the threads on this page.', phases: ['idle'] },
    { text: 'Pick another page, all pages or an environment such as staging.', phases: ['open', 'all'] },
    { text: 'See what is unread, or what is assigned to you.', phases: ['unread', 'leave', 'reset'] }
];

type Thread = { number: number; stage: Stage; text: string; path: string; unread?: boolean };

const threads: Thread[] = [
    { number: 9, stage: 'open', text: 'The prices here are from last year.', path: '/menu', unread: true },
    { number: 18, stage: 'open', text: 'The map does not open in the maps app.', path: '/contact', unread: true },
    { number: 12, stage: 'ready', text: 'The booking button hides behind the menu.', path: '/book' },
    { number: 6, stage: 'in-progress', text: 'Opening hours are cut off on mobile.', path: '/menu' }
];

export function InboxCover() {
    return (
        <FeatureCover
            name="inbox"
            phases={phases}
            captions={captions}
            stillPhase="all"
            stillCaption="The inbox with the threads of every page on the site, each with its page."
            className="h-[500px] min-h-[500px] md:h-[480px] md:min-h-[480px]">
            {phase => <Scene phase={phase} />}
        </FeatureCover>
    );
}

function Scene({ phase }: { phase: Phase }) {
    const is = (...names: Phase[]) => names.includes(phase);
    const allPages = is('all', 'unread', 'leave');
    const unreadOnly = is('unread', 'leave');
    const shown = (thread: Thread) => (allPages || thread.path === '/menu') && (!unreadOnly || !!thread.unread);
    const active = threads.filter(shown).length;
    const chip = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5';
    const menu = [['Pasta of the day', '14'], ['Lasagne', '16'], ['Tiramisu', '7']];

    return (
        <div className="relative mx-auto flex h-full max-w-[800px] items-start justify-center gap-10 px-4 pt-6 md:justify-between md:px-10 md:pt-8">
            {/* The example page under the inbox: this page's pins */}
            <div className="hidden min-w-0 max-w-[280px] flex-1 flex-col pt-4 md:flex">
                <span className="text-sm font-semibold">Trattoria</span>
                <span className="mt-8 text-[26px] font-semibold tracking-[-0.03em]">Menu</span>
                <div className="mt-4 flex flex-col text-sm">
                    {menu.map(([dish, price]) => (
                        <span key={dish} className="relative flex justify-between border-b py-2 tabular-nums">
                            <span>{dish}</span>
                            <span className="text-muted-foreground">{price}</span>
                            {dish === 'Pasta of the day' && <Pin number={9} size={24} className="absolute left-[62%] top-[50%]" />}
                            {dish === 'Tiramisu' && <Pin number={6} messages={2} size={24} className="absolute left-[40%] top-[50%]" />}
                        </span>
                    ))}
                </div>
            </div>

            {/* The inbox, ink like the rest of the review layer */}
            <div className="dark relative flex w-full max-w-[340px] shrink-0 flex-col gap-2 rounded-2xl border bg-background p-3 text-foreground">
                <div className="flex items-center justify-between pl-1">
                    <span className="flex items-center gap-1 text-sm font-semibold">Comments<ExpandDown size={12} className="text-muted-foreground" /></span>
                    <span className="flex items-center gap-1 text-muted-foreground"><Search size={16} /><Close size={16} /></span>
                </div>
                {/* The location picker: this page by default, then the choice */}
                <span className={cx(chip, 'w-full justify-between text-xs transition-colors duration-[120ms] ease-out', is('open') && 'bg-accent')}>
                    <span className="grid">
                        <span className={cx('col-start-1 row-start-1', appear(!allPages))}>This page <span className="text-muted-foreground">/menu</span></span>
                        <span className={cx('col-start-1 row-start-1', appear(allPages))}>All pages</span>
                    </span>
                    <ExpandDown size={12} className="text-muted-foreground" />
                </span>
                <div className="flex gap-1.5 text-xs">
                    <span className={chip}>Assigned to me</span>
                    <span className={cx(chip, 'transition-colors duration-[120ms] ease-out', unreadOnly && 'border-foreground/40 bg-accent')}>
                        <span className="tabular-nums text-[hsl(var(--brand-accent-text))]">2</span> unread
                    </span>
                </div>
                <div className="flex items-center gap-3 border-b text-xs font-medium">
                    <span className="-mb-px flex items-center gap-1 border-b-2 border-foreground pb-1.5">Active <span className="font-normal tabular-nums text-muted-foreground">{active}</span><ExpandDown size={12} className="text-muted-foreground" /></span>
                    <span className="pb-1.5 text-muted-foreground">Done</span>
                    <span className="pb-1.5 text-muted-foreground">All</span>
                </div>
                <div className="flex flex-col">
                    {threads.map(thread => (
                        // A card that comes or goes opens or closes its room, so the others slide to their places
                        <div key={thread.number} className={cx('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', shown(thread) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                            <div className="min-h-0 overflow-hidden">
                                <div className={cx('pb-2', fade(shown(thread)))}>
                                    <div className="flex flex-col gap-1.5 rounded-xl border p-2.5">
                                        <span className="flex items-center gap-2">
                                            <StatusBadge stage={thread.stage} menu />
                                            <span className="font-mono text-xs text-muted-foreground">#{thread.number}</span>
                                            {thread.unread && <span className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />}
                                            {/* This page's cards end with Show on page; the others with their page */}
                                            <span className={cx('ml-auto shrink-0 text-[11px] text-muted-foreground', thread.path !== '/menu' && 'font-mono')}>{thread.path === '/menu' ? 'Show on page' : thread.path}</span>
                                        </span>
                                        <span className="truncate text-[13px]">{thread.text}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* The location picker's popover: environments and this page or all on the left, the other pages on the right */}
                <div className={cx('absolute inset-x-3 top-[88px] z-10 grid grid-cols-2 gap-2 rounded-xl border bg-background p-1.5 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.16)]', fade(is('open')))}>
                    <div className="flex flex-col gap-0.5 border-r pr-1.5">
                        <PickerItem label="All environments" />
                        <PickerItem label="Staging" />
                        <span className="my-1 h-px bg-border" />
                        <PickerItem label="This page" count={2} />
                        <PickerItem label="All pages" count={4} highlighted />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className="px-2 py-1 text-muted-foreground">Other pages</span>
                        <PickerItem label="/contact" count={1} mono />
                        <PickerItem label="/book" count={1} mono />
                    </div>
                </div>
            </div>
        </div>
    );
}

function PickerItem({ label, count, mono, highlighted }: { label: string; count?: number; mono?: boolean; highlighted?: boolean }) {
    return (
        <span className={cx('flex h-7 items-center justify-between gap-2 rounded-md px-2', highlighted && 'bg-accent')}>
            <span className={cx('truncate', mono && 'font-mono')}>{label}</span>
            {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
        </span>
    );
}
