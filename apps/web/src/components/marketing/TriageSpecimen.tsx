import { CheckIcon, ChevronDownIcon, CircleCheckIcon, FlagIcon, KanbanIcon, ListFilterIcon, ListIcon, RotateCcwIcon, SearchIcon, UserIcon, XIcon } from 'lucide-react';
import { cx } from '@signalco/ui-primitives/cx';
import { Avatar, floating, Specimen, StatusDot, stageLabels, type Stage } from './LandingSpecimens';

// A static picture of a project's feedback in the app, for /features/feedback-triage: the search, the
// filter in effect beside Filter and List/Board, the status tabs, three rows with two selected and the
// floating bar with the selection's actions. The labels and layout match CommentFilters, CommentRow and
// TriageSelection (no Select button: a row's box, x or a long press starts selecting); the example
// content is the landing's imaginary restaurant site. It only illustrates the page's text, so it is
// hidden from assistive technologies.

type Row = { number: number; title: string; path: string; author: string; age: string; stage: Stage; priority?: 'urgent' | 'high'; assignee?: string; selected?: boolean; unread?: boolean };

const rows: Row[] = [
    { number: 14, title: 'Pay now does nothing on mobile.', path: '/order', author: 'MI', age: '2 hr ago', stage: 'open', priority: 'urgent', selected: true, unread: true },
    { number: 12, title: 'The delivery fee is missing from the total.', path: '/order', author: 'NO', age: 'yesterday', stage: 'in-progress', priority: 'high', assignee: 'LE', selected: true },
    { number: 9, title: 'The checkout button is hard to see.', path: '/order/checkout', author: 'MI', age: '3 days ago', stage: 'open' }
];

const icon = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

function Box({ checked, mixed }: { checked?: boolean; mixed?: boolean }) {
    return (
        <span className={cx('inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground', (checked || mixed) && 'border-foreground bg-foreground text-background')}>
            {checked && <CheckIcon size={12} strokeWidth={2.5} />}
            {mixed && <span className="h-0.5 w-2 rounded-full bg-current" />}
        </span>
    );
}

/** One row of the list: the unread dot and the author, number, title and age; under it the box, the page, the marks, the status and the assignee */
function ThreadRow({ row }: { row: Row }) {
    return (
        <div className={cx('grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-lg px-3 py-2.5', row.selected && 'bg-muted/60')}>
            <span className="flex h-5 items-center gap-2">
                <span className={cx('size-2 shrink-0 rounded-full', row.unread ? 'bg-[hsl(var(--brand-accent))]' : 'bg-transparent')} />
                <Avatar initials={row.author} small />
            </span>
            <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px]"><span className="font-mono text-xs text-muted-foreground">#{row.number}</span> {row.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{row.age}</span>
            </span>
            <span className="flex h-5 items-center gap-2">
                <span className="w-2 shrink-0" />
                <span className="flex w-5 justify-center"><Box checked={row.selected} /></span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono">{row.path}</span>
                {row.priority && <FlagIcon {...icon} className={cx('shrink-0', row.priority === 'urgent' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--brand-warning))]')} />}
                <span className="hidden items-center gap-1 whitespace-nowrap text-foreground sm:inline-flex"><StatusDot stage={row.stage} />{stageLabels[row.stage]}</span>
                {row.assignee ? <Avatar initials={row.assignee} small /> : <span className="size-5 shrink-0" />}
            </span>
        </div>
    );
}

export function TriageSpecimen() {
    const segment = 'inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5';
    const action = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium';
    return (
        <Specimen className="h-auto items-start rounded-2xl border px-4 py-8 sm:px-8">
            <div className="flex w-full max-w-[720px] flex-col gap-3 rounded-xl border bg-background p-4">
                {/* Search on the left; the filter in effect, Filter and List/Board on the right */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-lg border px-2.5 text-[13px]">
                        <SearchIcon {...icon} className="shrink-0 text-muted-foreground" />
                        order
                    </span>
                    <span className="hidden h-8 items-center gap-1.5 rounded-lg border px-2.5 sm:inline-flex">
                        <span className="text-muted-foreground">Environment:</span> Production
                        <XIcon {...icon} className="text-muted-foreground" />
                    </span>
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-medium">
                        <ListFilterIcon {...icon} />
                        Filter
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 tabular-nums">1</span>
                    </span>
                    <span className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]">
                        <span className="inline-flex size-[26px] items-center justify-center rounded-md bg-background shadow-sm"><ListIcon {...icon} /></span>
                        <span className="inline-flex size-[26px] items-center justify-center text-muted-foreground"><KanbanIcon {...icon} /></span>
                    </span>
                </div>
                <span className="inline-flex w-max gap-0.5 rounded-lg bg-muted p-[3px] text-xs font-medium">
                    <span className={cx(segment, 'bg-background shadow-sm')}>Active <span className="font-normal tabular-nums text-muted-foreground">3</span><ChevronDownIcon {...icon} className="text-muted-foreground" /></span>
                    <span className={cx(segment, 'text-muted-foreground')}>Done <span className="font-normal tabular-nums">0</span></span>
                    <span className={cx(segment, 'text-muted-foreground')}>All <span className="font-normal tabular-nums">3</span></span>
                </span>
                <div className="flex flex-col">
                    {rows.map(row => <ThreadRow key={row.number} row={row} />)}
                </div>
                {/* The bar floats over the end of the list while threads are selected */}
                <div className={cx('flex flex-wrap items-center gap-1 self-center rounded-xl border bg-popover p-1.5 text-xs', floating)}>
                    <span className="inline-flex size-8 items-center justify-center text-muted-foreground"><XIcon {...icon} /></span>
                    <span className="flex items-center gap-2.5 pl-1 pr-2"><Box mixed /><span className="tabular-nums">2 selected</span></span>
                    <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
                    <span className={action}><UserIcon {...icon} />Assign<ChevronDownIcon {...icon} className="text-muted-foreground" /></span>
                    <span className={action}><FlagIcon {...icon} />Priority<ChevronDownIcon {...icon} className="text-muted-foreground" /></span>
                    <span className={cx(action, 'hidden sm:inline-flex')}><CircleCheckIcon {...icon} />Done</span>
                    <span className={cx(action, 'hidden sm:inline-flex')}><RotateCcwIcon {...icon} />Reopen</span>
                </div>
            </div>
        </Specimen>
    );
}
