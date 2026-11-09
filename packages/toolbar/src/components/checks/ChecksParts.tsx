import { createContext, useContext, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Info, MapPin, MyLocation, Warning } from '@signalco/ui-icons';
import type { CheckState, PageCheck, PageIssue } from '../../checks/types';
import { CommentIcon } from '../CommentIcon';

/** A quick action's comment: on its way, or posted (with what "Show" opens) */
export type PostedComment =
    | { status: 'sending' }
    | { status: 'posted'; commentId: string; page: boolean; number?: number; label: string };

type ChecksActions = {
    posted: ReadonlyMap<string, PostedComment>;
    /** The issue whose element is outlined on the page */
    highlighted?: string;
    comment: (issue: PageIssue) => void;
    highlight: (issue: PageIssue) => void;
    show: (posted: Extract<PostedComment, { status: 'posted' }>) => void;
};

export const ChecksContext = createContext<ChecksActions>({
    posted: new Map(), comment: () => { }, highlight: () => { }, show: () => { }
});

/** Issues listed before "Show all" */
const firstIssues = 5;

const actionClassName = 'text-muted-foreground hover:text-foreground pointer-coarse:min-h-11';

/** Highlight (an issue with an element) and the comment quick action, or the comment it became */
export function IssueActions({ issue, describedBy, className }: { issue: PageIssue; describedBy?: string; className?: string }) {
    const { posted, highlighted, comment, highlight, show } = useContext(ChecksContext);
    const state = posted.get(issue.key);
    return (
        <Row spacing={1} className={cx('flex-wrap', className)}>
            {issue.element && (
                <Button key="highlight" size="xs" variant="plain" aria-pressed={highlighted === issue.key} aria-describedby={describedBy}
                    className={cx(actionClassName, highlighted === issue.key && 'bg-accent text-foreground')}
                    startDecorator={<MyLocation size={14} aria-hidden="true" />}
                    onClick={() => highlight(issue)}>
                    Highlight
                </Button>
            )}
            {state?.status === 'posted' && (
                <span key="posted" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Check size={14} aria-hidden="true" className="text-[hsl(var(--brand-success))]" />
                    {state.label}{state.number !== undefined ? ` as #${state.number}` : ''}
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
                {state?.status === 'posted' ? 'Show' : state?.status === 'sending' ? 'Posting...' : 'Comment'}
            </Button>
        </Row>
    );
}

/**
 * The line every issue of a list shares, or nothing when they differ: said once (by the check's
 * reason, or under the rule's title) instead of on every element
 */
export function sharedSummary(issues: readonly PageIssue[]) {
    const first = issues[0]?.summary;
    return first !== undefined && issues.every(issue => issue.summary === first) ? first : undefined;
}

/** One element's issue on one row: what is wrong with it (when its list's issues differ), its short name, its actions */
function IssueItem({ issue, showSummary }: { issue: PageIssue; showSummary: boolean }) {
    const id = useId();
    return (
        <li className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg bg-muted py-1 pl-2.5 pr-1">
            <div id={id} className="min-w-0 flex-1 basis-28 py-1">
                {(showSummary || !issue.label) && <p className="m-0 break-words text-xs text-foreground">{issue.summary}</p>}
                {issue.label && <p className="m-0 truncate font-mono text-xs text-muted-foreground" title={issue.label}>{issue.label}</p>}
            </div>
            <IssueActions issue={issue} describedBy={id} className="ml-auto" />
        </li>
    );
}

/** A check's or a rule's issues, the first few and then all of them */
export function IssueList({ issues, label, showSummary = true }: { issues: PageIssue[]; label: string; showSummary?: boolean }) {
    const [all, setAll] = useState(false);
    const shown = all ? issues : issues.slice(0, firstIssues);
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <ul aria-label={label} className="m-0 flex list-none flex-col gap-1 p-0">
                {shown.map(issue => <IssueItem key={issue.key} issue={issue} showSummary={showSummary} />)}
            </ul>
            {issues.length > shown.length && (
                <Button size="xs" variant="plain" className={cx('self-start', actionClassName)} onClick={() => setAll(true)}>
                    Show all {issues.length}
                </Button>
            )}
        </div>
    );
}

/** Each state's shape and colour: pass a green check, worth a look an amber warning, a note muted (not measured, not needed) */
export const checkStates: Record<CheckState, { icon: typeof Check; tone: string; word: string }> = {
    pass: { icon: Check, tone: 'text-[hsl(var(--brand-success))]', word: 'Pass' },
    warn: { icon: Warning, tone: 'text-[hsl(var(--brand-warning))]', word: 'Warning' },
    none: { icon: Info, tone: 'text-muted-foreground', word: 'Note' }
};

/** A check's state: its shape, its colour and its word for screen readers */
export function CheckStateIcon({ state }: { state: CheckState }) {
    const { icon: Icon, tone, word } = checkStates[state];
    return (
        <span className="mt-0.5 flex shrink-0">
            <Icon size={16} aria-hidden="true" className={tone} />
            <span className="sr-only">{word}: </span>
        </span>
    );
}

/**
 * A check on one compact row: its state, name and measurement, what was found, why it passed or is
 * worth a look, then its issues (an issue about the page has only its action)
 */
export function CheckItem({ check, children }: { check: PageCheck; children?: ReactNode }) {
    const id = useId();
    const pageIssue = check.issues.length === 1 && !check.issues[0]!.element ? check.issues[0] : undefined;
    return (
        <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2" data-uier-check={check.id} data-uier-check-state={check.state}>
            <div className="flex min-w-0 items-start gap-2">
                <CheckStateIcon state={check.state} />
                <div id={id} className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline justify-between gap-3">
                        <p className="m-0 min-w-0 text-sm font-medium text-foreground">{check.label}</p>
                        {check.measure && <p className="m-0 shrink-0 text-sm tabular-nums text-foreground">{check.measure}</p>}
                    </div>
                    {check.value && <p className="m-0 break-words text-sm text-secondary-foreground">{check.value}</p>}
                    <p className="m-0 text-xs text-muted-foreground">{check.reason}</p>
                </div>
            </div>
            {/* The buttons' icons line up with the text above them */}
            {pageIssue ? <IssueActions issue={pageIssue} describedBy={id} className="ml-4" />
                : check.issues.length > 0 && (
                    <div className="pl-6">
                        {/* The check's reason already says what they share */}
                        <IssueList issues={check.issues} label={check.label} showSummary={!sharedSummary(check.issues)} />
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
    return (
        <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5" {...rest}>
            <div className="flex min-w-0 items-baseline justify-between gap-3 px-1">
                <h3 id={id} className="m-0 shrink-0 text-sm font-semibold text-foreground">
                    {title}{count !== undefined && <> <span className="font-normal tabular-nums text-muted-foreground">{count}</span></>}
                </h3>
                {note && <p className="m-0 min-w-0 text-right text-xs text-muted-foreground">{note}</p>}
            </div>
            <ul className="m-0 flex list-none flex-col divide-y overflow-hidden rounded-xl border bg-card p-0">{children}</ul>
        </section>
    );
}

export type SummaryTile = {
    key: string;
    label: string;
    count: number;
    icon: typeof Check;
    /** The icon's colour, while there is something to count */
    tone: string;
};

/**
 * The panel's summary first: a tile for each kind of result with its count (coloured only when
 * it counts something), and a line under them
 */
export function ChecksSummary({ tiles, children }: { tiles: SummaryTile[]; children?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <dl className={cx('m-0 grid gap-2', tiles.length > 2 ? 'grid-cols-4' : 'grid-cols-2')}>
                {tiles.map(({ key, label, count, icon: Icon, tone }) => (
                    // The count above its name; read name first
                    <div key={key} data-uier-summary={key} className={cx('flex min-w-0 flex-col-reverse rounded-xl border bg-card py-2', tiles.length > 2 ? 'px-2.5' : 'px-3')}>
                        <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                        <dd className="m-0 flex items-center gap-1.5 text-lg font-semibold tabular-nums text-foreground">
                            <Icon size={16} aria-hidden="true" className={count ? tone : 'text-muted-foreground'} />
                            {count}
                        </dd>
                    </div>
                ))}
            </dl>
            {children}
        </div>
    );
}

/** A report of another page (after a client-side navigation) says so */
export function OtherPageNote({ path }: { path: string }) {
    return (
        <p className="m-0 rounded-xl border p-2.5 text-xs text-muted-foreground">
            These results are for <span className="font-mono">{path}</span>. Check again for this page.
        </p>
    );
}
