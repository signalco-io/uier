import { createContext, useContext, useId, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Row } from '@signalco/ui-primitives/Row';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Disabled, Down, Info, MapPin, MyLocation, Undo, Warning } from '@signalco/ui-icons';
import { sharedSummary } from '../../checks/issueGroup';
import type { CheckState, IssueGroup, PageCheck, PageIssue } from '../../checks/types';
import { CommentIcon } from '../CommentIcon';
import { IconTooltip, useIconTooltip } from '../IconTooltip';
import { useMessages } from '../../i18n';

export { sharedSummary };

/** An issue's comment: on its way, or posted, now or before by anyone (with its words and what "Show" opens) */
export type PostedComment =
    | { status: 'sending' }
    | { status: 'posted'; commentId: string; page: boolean; number?: number; label: string };

type ChecksActions = {
    /** The comment the issue already has: the one its quick action posted, else an open thread of the same check on its element */
    reportOf: (issue: PageIssue) => PostedComment | undefined;
    /** The issue whose element is outlined on the page */
    highlighted?: string;
    comment: (issue: PageIssue) => void;
    highlight: (issue: PageIssue) => void;
    show: (posted: Extract<PostedComment, { status: 'posted' }>) => void;
    /** One comment for several issues of a check, not reported yet ("Comment on all"); `of`: how many its list has */
    commentAll?: (issues: PageIssue[], group: IssueGroup, of: number) => void;
    /** Whether the issue was marked "Not an issue" in this browser */
    isDismissed?: (issue: PageIssue) => boolean;
    /** Marks it "Not an issue" in this browser */
    dismiss?: (issue: PageIssue) => void;
    /** Counts it again */
    restore?: (issue: PageIssue) => void;
};

export const ChecksContext = createContext<ChecksActions>({
    reportOf: () => undefined, comment: () => { }, highlight: () => { }, show: () => { }
});

/** Issues listed before "Show all" */
const firstIssues = 5;

const actionClassName = 'text-muted-foreground hover:text-foreground pointer-coarse:min-h-11';
const iconActionClassName = 'text-muted-foreground hover:text-foreground pointer-coarse:size-11';

/**
 * A row that leaves its list on a click ("Not an issue", Restore) takes the focus with it: it goes to
 * the same action of the row now in its place, else to the other list's (the "Dismissed" fold, or a
 * restored row's action), within the check's or rule's row, which stays.
 */
function moveFocus(from: HTMLElement, attribute: 'data-uier-dismiss' | 'data-uier-restore') {
    const container = from.closest<HTMLElement>('[data-uier-check], [data-uier-rule]') ?? from.closest<HTMLElement>('[data-uier-issues]');
    if (!container) return;
    const index = [...container.querySelectorAll(`[${attribute}]`)].indexOf(from);
    window.setTimeout(() => {
        if (from.isConnected && container.contains(document.activeElement) || !container.isConnected) return;
        const same = container.querySelectorAll<HTMLElement>(`[${attribute}]`);
        (same[Math.min(index, same.length - 1)] ?? container.querySelector<HTMLElement>('summary[data-uier-dismissed], [data-uier-dismiss]'))?.focus();
    });
}

/** Highlight (an issue with an element), "Not an issue" and the comment quick action, or the comment it became */
export function IssueActions({ issue, describedBy, className }: { issue: PageIssue; describedBy?: string; className?: string }) {
    const { reportOf, highlighted, comment, highlight, show, dismiss } = useContext(ChecksContext);
    const t = useMessages();
    const state = reportOf(issue);
    return (
        <Row spacing={0.5} className={cx('flex-wrap', className)}>
            {/* An icon with its name in a tooltip, so an element's row keeps its actions on one line */}
            {issue.element && (
                <IconTooltip key="highlight" label={t.checks.highlight}>
                    <IconButton size="xs" variant="plain" aria-label={t.checks.highlight} aria-pressed={highlighted === issue.key} aria-describedby={describedBy}
                        className={cx(iconActionClassName, highlighted === issue.key && 'bg-accent text-foreground')}
                        onClick={() => highlight(issue)}>
                        <MyLocation size={14} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
            )}
            {/* A finding of the page as it was checked (not a live measurement), not reported: hidden in this browser */}
            {dismiss && !state && issue.path !== undefined && (
                <IconTooltip key="dismiss" label={t.checks.notAnIssue}>
                    <IconButton size="xs" variant="plain" aria-label={t.checks.notAnIssue} aria-describedby={describedBy} data-uier-dismiss=""
                        className={iconActionClassName}
                        onClick={event => {
                            moveFocus(event.currentTarget, 'data-uier-dismiss');
                            dismiss(issue);
                        }}>
                        <Disabled size={14} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
            )}
            {state?.status === 'posted' && (
                <span key="posted" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Check size={14} aria-hidden="true" className="text-[hsl(var(--brand-success))]" />
                    {t.checks.postedAs(state.label, state.number)}
                </span>
            )}
            {/* One button for Comment, Posting and Show (the same element by its key), so the focus stays on it */}
            <Button key="comment" size="xs" variant="plain" aria-describedby={describedBy} aria-disabled={state?.status === 'sending' || undefined}
                className={actionClassName}
                startDecorator={state?.status === 'posted' ? <MapPin size={14} aria-hidden="true" />
                    : <CommentIcon icon="add" size={14} variant="outlined" aria-hidden="true" />}
                onClick={() => {
                    if (state?.status === 'posted') show(state);
                    else if (!state) comment(issue);
                }}>
                {state?.status === 'posted' ? t.checks.show : state?.status === 'sending' ? t.checks.posting : t.checks.comment}
            </Button>
        </Row>
    );
}

/** An issue's words in its row: what is wrong (when its list's issues differ), and the element's short name */
function IssueText({ id, issue, showSummary }: { id: string; issue: PageIssue; showSummary: boolean }) {
    return (
        <div id={id} className="min-w-0 flex-1 basis-24 py-1">
            {/* A long line (axe-core's contrast details) shows two lines; the rest is in its title and read in full */}
            {(showSummary || !issue.label) && <p className="m-0 line-clamp-2 break-words text-xs text-foreground" title={issue.summary}>{issue.summary}</p>}
            {issue.label && <p className="m-0 truncate font-mono text-xs text-muted-foreground" title={issue.label}>{issue.label}</p>}
        </div>
    );
}

/** One element's issue on one row: what is wrong with it (when its list's issues differ), its short name, its actions */
function IssueItem({ issue, showSummary }: { issue: PageIssue; showSummary: boolean }) {
    const id = useId();
    return (
        <li className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg bg-muted py-1 pl-2.5 pr-1">
            <IssueText id={id} issue={issue} showSummary={showSummary} />
            <IssueActions issue={issue} describedBy={id} className="ml-auto" />
        </li>
    );
}

/** A dismissed issue's row in the fold: its words and Restore */
function DismissedItem({ issue }: { issue: PageIssue }) {
    const id = useId();
    const { restore } = useContext(ChecksContext);
    const t = useMessages();
    return (
        <li className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg border border-dashed py-1 pl-2.5 pr-1">
            <IssueText id={id} issue={issue} showSummary />
            <Button size="xs" variant="plain" aria-describedby={id} data-uier-restore="" className={cx('ml-auto', actionClassName)}
                startDecorator={<Undo size={14} aria-hidden="true" />}
                onClick={event => {
                    moveFocus(event.currentTarget, 'data-uier-restore');
                    restore?.(issue);
                }}>
                {t.checks.restore}
            </Button>
        </li>
    );
}

/** The issues marked "Not an issue" in this browser, folded under their list, each with Restore */
function DismissedList({ issues, label }: { issues: PageIssue[]; label: string }) {
    const t = useMessages();
    return (
        <details className="group/dismissed">
            <summary data-uier-dismissed="" className="-mx-1 flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                <Down size={14} aria-hidden="true" className="-rotate-90 transition-transform duration-150 ease-out group-open/dismissed:rotate-0 motion-reduce:transition-none" />
                {t.checks.dismissed} <span className="tabular-nums">{issues.length}</span>
            </summary>
            <p className="m-0 pb-1 text-xs text-muted-foreground">{t.checks.dismissedNote}</p>
            <ul aria-label={t.checks.dismissedList(label)} className="m-0 flex list-none flex-col gap-1 p-0">
                {issues.map(issue => <DismissedItem key={issue.key} issue={issue} />)}
            </ul>
        </details>
    );
}

/**
 * A check's or a rule's issues, the first few and then all of them; one comment for all of them not
 * reported yet (at least two, of one check, with an element); then the ones marked "Not an issue" in
 * this browser (`dismissed`, and any of `issues` the panel says are), folded. `group`: the first and
 * last lines of that one comment (else the check's kind and the list's label).
 */
export function IssueList({ issues, label, showSummary = true, group, dismissed = [] }: {
    issues: PageIssue[];
    label: string;
    showSummary?: boolean;
    group?: IssueGroup;
    dismissed?: PageIssue[];
}) {
    const { reportOf, show, commentAll, isDismissed } = useContext(ChecksContext);
    const t = useMessages();
    const id = useId();
    const [all, setAll] = useState(false);
    // The first issue of the comment this list posted for several, and how many
    const [grouped, setGrouped] = useState<{ key: string; count: number }>();
    const active = isDismissed ? issues.filter(issue => !isDismissed(issue)) : issues;
    const hidden = [...dismissed, ...issues.filter(issue => !active.includes(issue))];
    const shown = all ? active : active.slice(0, firstIssues);
    const first = active[0];
    const open = active.filter(issue => issue.element && issue.check.type === first?.check.type && issue.check.id === first.check.id && !reportOf(issue));
    const groupIssue = grouped && active.find(issue => issue.key === grouped.key);
    const groupState = groupIssue ? reportOf(groupIssue) : undefined;
    return (
        <div className="flex min-w-0 flex-col gap-1" data-uier-issues="">
            {active.length > 0 && (
                <ul aria-label={label} className="m-0 flex list-none flex-col gap-1 p-0">
                    {shown.map(issue => <IssueItem key={issue.key} issue={issue} showSummary={showSummary} />)}
                </ul>
            )}
            {(active.length > shown.length || (commentAll && (open.length > 1 || groupState))) && (
                <Row spacing={0.5} className="flex-wrap">
                    {active.length > shown.length && (
                        <Button size="xs" variant="plain" className={actionClassName} onClick={() => setAll(true)}>
                            {t.checks.showAll(active.length)}
                        </Button>
                    )}
                    {groupState?.status === 'posted' && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Check size={14} aria-hidden="true" className="text-[hsl(var(--brand-success))]" />
                            {t.checks.postedFor(groupState.label, grouped!.count, groupState.number)}
                        </span>
                    )}
                    {commentAll && (open.length > 1 || groupState) && (
                        // One button for Comment on all, Posting and Show, so the focus stays on it; described by its list's name
                        <Button size="xs" variant="plain" aria-disabled={groupState?.status === 'sending' || undefined} aria-describedby={id} data-uier-comment-all="" className={actionClassName}
                            startDecorator={groupState?.status === 'posted' ? <MapPin size={14} aria-hidden="true" />
                                : <CommentIcon icon="add" size={14} variant="outlined" aria-hidden="true" />}
                            onClick={() => {
                                if (groupState?.status === 'posted') show(groupState);
                                else if (!groupState) {
                                    setGrouped({ key: open[0]!.key, count: open.length });
                                    commentAll(open, group ?? { head: t.checks.group.head(t.checks.kinds[open[0]!.check.type], label) }, active.length);
                                }
                            }}>
                            {groupState?.status === 'posted' ? t.checks.show : groupState?.status === 'sending' ? t.checks.posting : t.checks.commentOnAll(open.length)}
                        </Button>
                    )}
                    <span id={id} hidden>{label}</span>
                </Row>
            )}
            {hidden.length > 0 && <DismissedList issues={hidden} label={label} />}
        </div>
    );
}

/** Each state's shape and colour: pass a green check, worth a look an amber warning, a note muted (not measured, not needed) */
export const checkStates: Record<CheckState, { icon: ChecksIcon; tone: string }> = {
    pass: { icon: Check, tone: 'text-[hsl(var(--brand-success))]' },
    warn: { icon: Warning, tone: 'text-[hsl(var(--brand-warning))]' },
    none: { icon: Info, tone: 'text-muted-foreground' }
};

/** A check's state: its shape, its colour and its word for screen readers */
export function CheckStateIcon({ state }: { state: CheckState }) {
    const { icon: Icon, tone } = checkStates[state];
    const word = useMessages().checks.states[state];
    return (
        <span className="mt-0.5 flex shrink-0">
            <Icon size={16} aria-hidden="true" className={tone} />
            <span className="sr-only">{word}: </span>
        </span>
    );
}

/**
 * Why a check passed or is worth a look, behind a small info button by its name: shown on hover, on
 * keyboard focus and on a tap, and read with the button (`aria-describedby`, `reasonId`)
 */
function CheckReason({ check, reasonId }: { check: PageCheck; reasonId: string }) {
    const t = useMessages();
    const { triggerProps, tooltip } = useIconTooltip(check.reason, undefined, { tap: true, prose: true });
    return <>
        <IconButton size="xs" variant="plain" aria-label={t.checks.aboutCheck(check.label)} aria-describedby={reasonId} data-uier-check-reason=""
            className="-my-1 size-6 shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:-my-3 pointer-coarse:size-11"
            {...triggerProps}>
            <Info size={14} aria-hidden="true" />
        </IconButton>
        {tooltip}
        <span id={reasonId} hidden>{check.reason}</span>
    </>;
}

/**
 * A check on one compact row: its state, name (with why it passed or is worth a look in a tooltip) and
 * measurement, what was found, then its issues (an issue about the page has only its action) and the ones marked
 * "Not an issue" in this browser
 */
export function CheckItem({ check, children }: { check: PageCheck; children?: ReactNode }) {
    const id = useId();
    const reasonId = useId();
    const { isDismissed } = useContext(ChecksContext);
    const filter = useContext(CheckFilterContext);
    const t = useMessages();
    if (filter && check.state !== filter) return null;
    const pageIssue = check.issues.length === 1 && !check.issues[0]!.element && !isDismissed?.(check.issues[0]!) ? check.issues[0] : undefined;
    return (
        <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2" data-uier-check={check.id} data-uier-check-state={check.state}>
            <div className="flex min-w-0 items-start gap-2">
                <CheckStateIcon state={check.state} />
                <div id={id} className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-0.5">
                            <p className="m-0 min-w-0 text-sm font-medium text-foreground">{check.label}</p>
                            <CheckReason check={check} reasonId={reasonId} />
                        </div>
                        {check.measure && <p className="m-0 shrink-0 text-sm tabular-nums text-foreground">{check.measure}</p>}
                    </div>
                    {check.value && <p className="m-0 break-words text-sm text-secondary-foreground">{check.value}</p>}
                </div>
            </div>
            {/* The buttons' icons line up with the text above them */}
            {pageIssue ? <IssueActions issue={pageIssue} describedBy={`${id} ${reasonId}`} className="ml-4" />
                : (check.issues.length > 0 || !!check.dismissed?.length) && (
                    <div className="pl-6">
                        {/* The check's reason already says what they share */}
                        <IssueList issues={check.issues} label={check.label} showSummary={!sharedSummary(check.issues)} dismissed={check.dismissed}
                            group={{ head: t.checks.group.checkHead(t.checks.kinds[(check.issues[0] ?? check.dismissed![0]!).check.type], check.label, check.reason), summarized: true }} />
                    </div>
                )}
            {children}
        </li>
    );
}

/** A group of rows under its heading (with a count, and a note on the right), on one card */
export function CheckSection({ title, count, note, children, ...rest }: Omit<ComponentProps<'section'>, 'title'> & {
    title: string;
    count?: number;
    note?: ReactNode;
}) {
    const id = useId();
    // Filtered, a section shows only its checks (no other rows), and none at all without one
    const filtered = useContext(CheckFilterContext) !== undefined;
    return (
        <section aria-labelledby={id} className={cx('flex min-w-0 flex-col gap-1.5', filtered && '[&:not(:has(>ul>li[data-uier-check]))]:hidden')} {...rest}>
            <div className="flex min-w-0 items-baseline justify-between gap-3 px-1">
                <h3 id={id} className="m-0 shrink-0 text-sm font-semibold text-foreground">
                    {title}{count !== undefined && <> <span className="font-normal tabular-nums text-muted-foreground">{count}</span></>}
                </h3>
                {note && <p className="m-0 min-w-0 text-right text-xs text-muted-foreground">{note}</p>}
            </div>
            <ul className={cx('m-0 flex list-none flex-col divide-y overflow-hidden rounded-xl border bg-card p-0', filtered && '[&>li:not([data-uier-check])]:hidden')}>{children}</ul>
        </section>
    );
}

/** An outlined icon: the kit's, or one drawn like it (`ChecksIcons.tsx`) */
export type ChecksIcon = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export type SummaryTile = {
    key: string;
    label: string;
    count: number;
    icon: ChecksIcon;
    /** The icon's colour, while there is something to count */
    tone: string;
};

/**
 * The panel's summary first: a tile for each kind of result with its count (coloured only when
 * it counts something), and a line under them. With `onSelect` each tile is a toggle that shows only
 * its results (`selected`, pressed); pressed again, or "Show all results", shows them all.
 */
export function ChecksSummary({ tiles, selected, onSelect, children }: {
    tiles: SummaryTile[];
    selected?: string;
    onSelect?: (key: string | undefined) => void;
    children?: ReactNode;
}) {
    const t = useMessages();
    const tilesRef = useRef<HTMLDivElement>(null);
    const many = tiles.length > 2;
    const tileClassName = cx('flex min-w-0 flex-col-reverse rounded-xl border bg-card py-2 text-left', many ? 'px-2.5' : 'px-3');
    const selectedTile = tiles.find(tile => tile.key === selected);
    const count = (Icon: ChecksIcon, value: number, tone: string) => (
        <>
            <Icon size={16} aria-hidden="true" className={value ? tone : 'text-muted-foreground'} />
            {value}
        </>
    );
    return (
        <div className="flex flex-col gap-2">
            {onSelect ? (
                <div ref={tilesRef} role="group" aria-label={t.checks.filterResults} className={cx('grid gap-2', many ? 'grid-cols-4' : 'grid-cols-2')}>
                    {tiles.map(({ key, label, count: value, icon, tone }) => {
                        const pressed = key === selected;
                        return (
                            // A toggle: its name, then its count; nothing to show at 0 unless it is the filter
                            <button key={key} type="button" data-uier-summary={key} aria-pressed={pressed}
                                disabled={!value && !pressed}
                                className={cx(tileClassName,
                                    'cursor-pointer transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-card',
                                    pressed && 'border-foreground bg-accent')}
                                onClick={() => onSelect(pressed ? undefined : key)}>
                                <span className="truncate text-xs text-muted-foreground">{label}</span>
                                <span data-uier-summary-count="" className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-foreground">
                                    {count(icon, value, tone)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <dl className={cx('m-0 grid gap-2', many ? 'grid-cols-4' : 'grid-cols-2')}>
                    {tiles.map(({ key, label, count: value, icon, tone }) => (
                        // The count above its name; read name first
                        <div key={key} data-uier-summary={key} className={tileClassName}>
                            <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                            <dd data-uier-summary-count="" className="m-0 flex items-center gap-1.5 text-lg font-semibold tabular-nums text-foreground">
                                {count(icon, value, tone)}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
            {onSelect && selectedTile && (
                <p className="m-0 flex flex-wrap items-center gap-x-2 px-1 text-xs text-muted-foreground" data-uier-summary-filter="">
                    {t.checks.filtered(selectedTile.label)}
                    <Button size="xs" variant="plain" className={actionClassName}
                        onClick={() => {
                            // The button leaves with the filter: the focus goes to the tile that was pressed
                            tilesRef.current?.querySelector<HTMLElement>(`[data-uier-summary="${selectedTile.key}"]`)?.focus();
                            onSelect(undefined);
                        }}>
                        {t.checks.clearFilter}
                    </Button>
                </p>
            )}
            {children}
        </div>
    );
}

/** While a summary tile filters an SEO panel: the state of the checks it shows */
export const CheckFilterContext = createContext<CheckState | undefined>(undefined);

/** A report of another page (after a client-side navigation) says so */
export function OtherPageNote({ path }: { path: string }) {
    const t = useMessages();
    return (
        <p className="m-0 rounded-xl border p-2.5 text-xs text-muted-foreground">
            {t.checks.otherPageBefore}<span className="font-mono">{path}</span>{t.checks.otherPageAfter}
        </p>
    );
}
