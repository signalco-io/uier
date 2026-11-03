import { Check, ExpandDown, Search } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { Specimen } from './LandingSpecimens';

// A static picture of a project's feedback in the app, for /features/feedback-triage: the search
// and priority filter, the selection and its actions, and three threads. The labels match
// TriageSelection and CommentFilters; the example content is the landing's imaginary restaurant
// site. It only illustrates the page's text, so it is hidden from assistive technologies.

const threads = [
    { number: 14, count: 2, text: 'Pay now does nothing on mobile.', path: '/order', priority: 'Urgent', selected: true },
    { number: 12, count: 1, text: 'The delivery fee is missing from the total.', path: '/order', priority: 'High', selected: true },
    { number: 9, count: 3, text: 'The checkout button is hard to see.', path: '/order/checkout', priority: 'Normal', selected: false }
];

function Box({ checked, mixed }: { checked?: boolean; mixed?: boolean }) {
    return (
        <span className={cx('inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border', (checked || mixed) && 'border-foreground bg-foreground text-background')}>
            {checked && <Check size={12} strokeWidth={2.5} />}
            {mixed && <span className="h-0.5 w-2 rounded-full bg-current" />}
        </span>
    );
}

function Control({ children, className }: { children: string; className?: string }) {
    return (
        <span className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium', className)}>
            {children}
            <ExpandDown size={12} strokeWidth={1.75} className="text-muted-foreground" />
        </span>
    );
}

export function TriageSpecimen() {
    return (
        <Specimen className="h-auto items-start rounded-2xl border px-4 py-8 sm:px-8">
            <div className="flex w-full max-w-[720px] flex-col gap-3 rounded-xl border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-[13px]">
                        <Search size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
                        order
                    </span>
                    <Control>All priorities</Control>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <Box mixed />
                    <span className="font-medium">Select shown results</span>
                    <span className="tabular-nums text-muted-foreground">2 selected</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5">
                    <Control>Assign selected</Control>
                    <Control>Set priority</Control>
                    <span className="hidden h-8 items-center rounded-lg border px-2.5 text-xs font-medium sm:inline-flex">Mark selected as done</span>
                    <span className="hidden h-8 items-center rounded-lg border px-2.5 text-xs font-medium md:inline-flex">Reopen selected</span>
                </div>
                <div className="flex flex-col">
                    {threads.map(thread => (
                        <div key={thread.number} className="flex items-center gap-3 border-t py-2.5">
                            <Box checked={thread.selected} />
                            <Pin number={thread.number} messages={thread.count} size={22} className="shrink-0" />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-[13px]">{thread.text}</span>
                                <span className="truncate font-mono text-[11px] text-muted-foreground">#{thread.number} · {thread.path}</span>
                            </span>
                            <span className={cx('inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium', thread.priority === 'Normal' && 'text-muted-foreground')}>{thread.priority}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Specimen>
    );
}
