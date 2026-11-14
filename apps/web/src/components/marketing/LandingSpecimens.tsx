import type { ReactNode } from 'react';
import { AI, Close, Copy, ExpandDown, MoreHorizontal, Search } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { FlagIcon, GitPullRequestIcon } from 'lucide-react';
import { Pin } from '@uier/brand/Pin';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { BrowserMark, OsMark } from '@uier/toolbar/device-details';
import { IntegrationLogo } from '../app/integrations/IntegrationLogo';

// Static pictures of the review layer and the app for the landing page's feature tiles. The live
// review layer is the toolbar at the bottom of the window (BRAND.md, "Marketing and metadata"); these
// only illustrate what the tile's text says, so they are hidden from assistive technologies. The
// example content is an imaginary restaurant site, so none of it reads as a claim about uier.
// Each copies the shipped control it shows: the toolbar's thread header (CommentThreadHeader) and
// inbox (sidebar/CommentsSidebar), the app's board (CommentBoard, CommentRow), the device details
// (CommentDevice) and the integration logos. Recheck them when those change.

export const floating = 'shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:shadow-none';

/** The picture area at the top of a feature tile */
export function Specimen({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div aria-hidden="true" className={cx('relative flex h-60 justify-center overflow-hidden border-b bg-muted/50 px-6', className)}>
            {children}
        </div>
    );
}

export function Avatar({ initials, small, className }: { initials: string; small?: boolean; className?: string }) {
    return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold', small ? 'size-5 text-[9px]' : 'size-6 text-[10px]', className)}>{initials}</span>;
}

export type Stage = 'open' | 'in-progress' | 'ready' | 'done';

export const stageLabels: Record<Stage, string> = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done' };

/** Each status's dot (BRAND.md, "Status"): Open an ink ring, In progress sky, Ready to verify violet, Done green */
const stageDots: Record<Stage, string> = {
    open: 'border border-foreground',
    'in-progress': 'bg-[hsl(var(--brand-in-progress))]',
    ready: 'bg-[hsl(var(--brand-ready))]',
    done: 'bg-[hsl(var(--brand-success))]'
};

export function StatusDot({ stage }: { stage: Stage }) {
    return <span className={cx('size-1.5 shrink-0 rounded-full', stageDots[stage])} />;
}

/** A thread's status: a menu (with its chevron) for those who may change it, else a badge */
export function StatusBadge({ stage, menu }: { stage: Stage; menu?: boolean }) {
    return (
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium">
            <StatusDot stage={stage} />
            {stageLabels[stage]}
            {menu && <ExpandDown size={12} className="text-muted-foreground" />}
        </span>
    );
}

/** An assignee's avatar with the AI agent working for them stacked on its edge; `stacked` rings it apart from the one beside it */
export function AssigneeAvatar({ initials, agent, small, stacked }: { initials: string; agent?: boolean; small?: boolean; stacked?: boolean }) {
    return (
        <span className="relative inline-flex shrink-0">
            <Avatar initials={initials} small={small} className={stacked ? 'ring-2 ring-popover' : undefined} />
            {agent && (
                <span className={cx('absolute -bottom-1 -right-1 inline-flex items-center justify-center rounded-full border bg-background', small ? 'size-3' : 'size-3.5')}>
                    <AI size={small ? 8 : 9} />
                </span>
            )}
        </span>
    );
}

/** The top of a thread, on one line: status, number, priority and assignees, then Copy and Thread options */
export function ThreadHeader({ stage, number, priority, assignees }: { stage: Stage; number: number; priority?: string; assignees?: ReactNode }) {
    return (
        <div className="flex items-center gap-2 px-3.5 pt-3">
            <StatusBadge stage={stage} menu />
            <span className="font-mono text-xs text-muted-foreground">#{number}</span>
            {priority && <span className="inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs">{priority}</span>}
            <span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
                {assignees && <span className="mr-1 flex -space-x-1.5">{assignees}</span>}
                <span className="inline-flex size-6 items-center justify-center"><Copy size={14} /></span>
                <span className="inline-flex size-6 items-center justify-center"><MoreHorizontal size={14} /></span>
            </span>
        </div>
    );
}

/** A message in a thread: the avatar column, the name and time, then the text */
export function Message({ initials, name, time, children }: { initials: string; name: string; time: string; children: ReactNode }) {
    return (
        <div className="flex gap-2.5">
            <Avatar initials={initials} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium">{name}</span>
                    <span className="text-[11px] text-muted-foreground">{time}</span>
                </span>
                <span className="text-[13px] leading-5">{children}</span>
            </div>
        </div>
    );
}

/**
 * A comment on an element, one on a drawn area and one on selected words, with the open thread of the
 * first. Another part of the example site than the how-it-works stage, so the two do not repeat.
 */
export function PinnedSpecimen() {
    const hours = [['Monday to Friday', '12–23'], ['Saturday', '12–24'], ['Sunday', 'Closed']];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[620px] items-center justify-between gap-6">
                <div className="flex w-full max-w-[340px] flex-col">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Opening hours</span>
                    <div className="mt-3 flex gap-4">
                        <div className="flex min-w-0 flex-1 flex-col text-sm">
                            {hours.map(([day, time]) => (
                                <span key={day} className="relative flex justify-between gap-2 border-b py-1.5 tabular-nums">
                                    <span className="truncate">{day}</span>
                                    <span className="text-muted-foreground">{time}</span>
                                    {day === 'Sunday' && <Pin number={7} messages={2} size={26} className="absolute left-[46%] top-[55%]" />}
                                </span>
                            ))}
                        </div>
                        {/* A drawn area on the map: the dashed accent outline, its pin at the bottom-right corner (CommentAreaHighlight) */}
                        <div className="relative h-[100px] w-[92px] shrink-0 rounded-md bg-muted">
                            <span className="absolute inset-x-0 top-[38%] h-1.5 bg-background" />
                            <span className="absolute inset-y-0 left-[58%] w-1.5 bg-background" />
                            <span className="absolute left-[30%] top-[18%] size-2 rounded-full bg-foreground" />
                            <span className="absolute left-[14%] top-[10%] h-[42%] w-[44%] rounded-sm outline-2 outline-dashed outline-[hsl(var(--brand-accent))]" />
                            <Pin number={9} size={22} className="absolute left-[58%] top-[52%] -ml-1 -mt-1" />
                        </div>
                    </div>
                    <span className="mt-5 text-sm text-muted-foreground">
                        Book online or <span className="relative rounded-[3px] bg-[hsl(var(--brand-selection))] text-foreground">call us<Pin number={8} size={22} className="absolute left-full top-full -ml-1 -mt-1" /></span>.
                    </span>
                </div>
                <div className={cx('hidden w-60 shrink-0 flex-col gap-2.5 rounded-xl border bg-popover pb-3.5 text-popover-foreground sm:flex', floating)}>
                    <ThreadHeader stage="open" number={7} />
                    <div className="px-3.5">
                        <Message initials="MI" name="Mia" time="5 min ago">We open on Sundays since May. Can this say 12–22?</Message>
                    </div>
                </div>
            </div>
        </Specimen>
    );
}

/** The saved screenshot of a comment and the device details beside it, each browser and system with its mark */
export function ContextSpecimen() {
    const details: [string, ReactNode][] = [
        ['Page', <span key="page" className="font-mono">/menu</span>],
        ['Screen', <span key="screen" className="font-mono tabular-nums">Mobile · 390×844</span>],
        ['Browser', <span key="browser" className="flex items-center gap-1.5"><BrowserMark name="Safari" className="size-3.5" />Safari</span>],
        ['System', <span key="system" className="flex items-center gap-1.5"><OsMark name="iOS" className="size-3.5" />iOS</span>],
        ['Input', 'Touch']
    ];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[280px] flex-col overflow-hidden rounded-xl border bg-background">
                <div className="relative flex h-20 items-center justify-center border-b bg-muted/50">
                    <span className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Book a table</span>
                    <Pin number={5} size={20} className="absolute left-[60%] top-[52%]" />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-3.5 text-xs">
                    {details.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd>{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </Specimen>
    );
}

/** A thread with a mention, a reply with an image and two assignees, one with their agent */
export function ThreadSpecimen() {
    return (
        <Specimen className="items-start pt-6">
            <div className={cx('flex w-full max-w-[300px] flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                <ThreadHeader stage="in-progress" number={14} assignees={<><AssigneeAvatar initials="LE" agent stacked /><AssigneeAvatar initials="NO" stacked /></>} />
                <div className="flex flex-col gap-3 px-3.5 py-3">
                    <Message initials="MI" name="Mia" time="2 hr ago"><span className="font-medium">@Leo</span> the prices here are from last year.</Message>
                    <Message initials="LE" name="Leo" time="1 hr ago">
                        The new menu goes up on <strong className="font-semibold">Friday</strong>.
                        {/* An image attached to the reply */}
                        <span className="mt-2 flex h-14 w-24 flex-col gap-1 rounded-md border bg-muted/50 p-2">
                            <span className="h-1.5 w-3/4 rounded-full bg-muted-foreground/40" />
                            <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/25" />
                            <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/25" />
                        </span>
                    </Message>
                </div>
            </div>
        </Specimen>
    );
}

/** The ink inbox, docked beside the page: search, the page picker and filters, the status tabs, then threads */
export function InboxSpecimen() {
    const menu = [['Pasta of the day', '14'], ['Lasagne', '16'], ['Tiramisu', '7']];
    const chip = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5';
    return (
        <Specimen className="items-start pt-6">
            <div className="flex w-full max-w-[640px] justify-between gap-8">
                <div className="hidden min-w-0 max-w-[240px] flex-1 flex-col pt-1 sm:flex">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Menu</span>
                    <div className="mt-3 flex flex-col text-sm">
                        {menu.map(([dish, price]) => (
                            <span key={dish} className="relative flex justify-between border-b py-1.5 tabular-nums">
                                <span>{dish}</span>
                                <span className="text-muted-foreground">{price}</span>
                                {dish === 'Lasagne' && <Pin number={9} messages={2} size={24} className="absolute left-[58%] top-[50%]" />}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="dark flex w-full max-w-[320px] shrink-0 flex-col gap-2 rounded-2xl border bg-background p-3 text-foreground">
                    <div className="flex items-center justify-between pl-1">
                        <span className="text-sm font-semibold">Comments</span>
                        <Close size={16} className="text-muted-foreground" />
                    </div>
                    <span className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground"><Search size={14} />Search comments</span>
                    <div className="flex gap-1.5 text-xs">
                        <span className={cx(chip, 'min-w-0 flex-1 justify-between')}>This page<ExpandDown size={12} className="text-muted-foreground" /></span>
                        <span className={chip}>Unread <span className="tabular-nums text-[hsl(var(--brand-accent-text))]">2</span></span>
                        <span className={cx(chip, 'hidden min-[420px]:inline-flex')}>Assigned to me</span>
                    </div>
                    <div className="flex items-center gap-3 border-b text-xs font-medium">
                        <span className="-mb-px flex items-center gap-1 border-b-2 border-foreground pb-1.5">Active <span className="font-normal tabular-nums text-muted-foreground">3</span><ExpandDown size={12} className="text-muted-foreground" /></span>
                        <span className="pb-1.5 text-muted-foreground">Done <span className="font-normal tabular-nums">1</span></span>
                        <span className="pb-1.5 text-muted-foreground">All <span className="font-normal tabular-nums">4</span></span>
                    </div>
                    {[
                        { stage: 'open' as const, number: 9, text: 'The prices here are from last year.', meta: 'Mia · 2 hr ago', unread: true },
                        { stage: 'in-progress' as const, number: 6, text: 'Opening hours are cut off on mobile.', meta: 'Leo · yesterday' }
                    ].map(thread => (
                        <div key={thread.number} className="flex flex-col gap-1.5 rounded-xl border p-2.5">
                            <span className="flex items-center gap-2">
                                <StatusBadge stage={thread.stage} menu />
                                <span className="font-mono text-xs text-muted-foreground">#{thread.number}</span>
                                {thread.unread && <span className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />}
                            </span>
                            <span className="truncate text-[13px]">{thread.text}</span>
                            <span className="text-[11px] text-muted-foreground">{thread.meta}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Specimen>
    );
}

type BoardCard = { number: number; title: string; path: string; author: string; assignee?: string; agent?: boolean; priority?: 'high' | 'urgent'; pullRequest?: boolean };

/** One card of the app's board: the author, number and title, then the path, marks and the assignee */
function Card({ card }: { card: BoardCard }) {
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border bg-background p-2.5">
            <span className="flex items-start gap-1.5">
                <Avatar initials={card.author} small />
                <span className="line-clamp-2 min-w-0 text-xs leading-4"><span className="font-mono text-muted-foreground">#{card.number}</span> {card.title}</span>
            </span>
            <span className="flex items-center gap-1.5 pl-[26px] text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono">{card.path}</span>
                {card.pullRequest && <GitPullRequestIcon size={12} strokeWidth={1.75} className="shrink-0" />}
                {card.priority && <FlagIcon size={12} strokeWidth={1.75} className={cx('shrink-0', card.priority === 'urgent' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--brand-warning))]')} />}
                {card.assignee && <AssigneeAvatar initials={card.assignee} agent={card.agent} small />}
            </span>
        </div>
    );
}

/** The app's board: a column for each status with its count, cards in it */
export function BoardSpecimen() {
    const columns: { stage: Stage; count: number; cards: BoardCard[] }[] = [
        { stage: 'open', count: 5, cards: [
            { number: 18, title: 'The map does not open in the maps app.', path: '/contact', author: 'MI', priority: 'urgent' },
            { number: 17, title: 'Add the vegan dishes to the menu.', path: '/menu', author: 'NO' }
        ] },
        { stage: 'in-progress', count: 2, cards: [{ number: 14, title: 'The prices here are from last year.', path: '/menu', author: 'MI', assignee: 'LE', agent: true, priority: 'high', pullRequest: true }] },
        { stage: 'ready', count: 1, cards: [{ number: 12, title: 'The booking button hides behind the menu.', path: '/book', author: 'NO', assignee: 'LE', pullRequest: true }] },
        { stage: 'done', count: 9, cards: [
            { number: 7, title: 'Sunday says closed.', path: '/contact', author: 'MI', assignee: 'NO' },
            { number: 5, title: 'The gift card page is blank.', path: '/gift-cards', author: 'LE', assignee: 'LE' }
        ] }
    ];
    return (
        <Specimen className="items-start pt-6">
            <div className="grid w-full max-w-[720px] grid-cols-2 gap-2 sm:grid-cols-4">
                {columns.map((column, index) => (
                    <div key={column.stage} className={cx('flex min-w-0 flex-col gap-2 rounded-2xl border bg-muted/50 p-2', index > 1 && 'hidden sm:flex')}>
                        <span className="flex items-center gap-2 px-1.5 pt-0.5 text-xs font-medium">
                            <StatusDot stage={column.stage} />
                            <span className="truncate">{stageLabels[column.stage]}</span>
                            <span className="font-normal tabular-nums text-muted-foreground">{column.count}</span>
                        </span>
                        {column.cards.map(card => <Card key={card.number} card={card} />)}
                    </div>
                ))}
            </div>
        </Specimen>
    );
}

/** The services a project can send shared feedback to, with what each thread becomes there */
export function IntegrationsSpecimen() {
    const providers: [IntegrationProviderId, string, string][] = [
        ['github', 'GitHub', 'An issue for each thread'],
        ['linear', 'Linear', 'An issue for each thread'],
        ['notion', 'Notion', 'A page for each thread'],
        ['azure-devops', 'Azure DevOps', 'A work item for each thread'],
        ['slack', 'Slack', 'A message for each thread']
    ];
    return (
        <Specimen className="items-center">
            <div className="flex w-full max-w-[280px] flex-col divide-y overflow-hidden rounded-xl border bg-background">
                {providers.map(([id, name, detail]) => (
                    <span key={id} className="flex items-center gap-2.5 px-3 py-1.5">
                        <IntegrationLogo provider={id} className="size-6 rounded-md p-1" />
                        <span className="flex min-w-0 flex-col">
                            <span className="text-[13px] font-medium">{name}</span>
                            <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
                        </span>
                    </span>
                ))}
            </div>
        </Specimen>
    );
}
