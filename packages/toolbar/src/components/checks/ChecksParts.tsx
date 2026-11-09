import { createContext, useContext, useId, useState, type ReactNode } from 'react';
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

/** Highlight (an issue with an element) and the comment quick action, or the comment it became */
export function IssueActions({ issue, describedBy, className }: { issue: PageIssue; describedBy?: string; className?: string }) {
    const { posted, highlighted, comment, highlight, show } = useContext(ChecksContext);
    const state = posted.get(issue.key);
    return (
        // The buttons' icons line up with the text above them
        <Row spacing={1} className={cx('flex-wrap', className ?? '-ml-2')}>
            {issue.element && (
                <Button key="highlight" size="xs" variant="plain" aria-pressed={highlighted === issue.key} aria-describedby={describedBy}
                    className={cx('text-muted-foreground hover:text-foreground', highlighted === issue.key && 'bg-accent text-foreground')}
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
                className="text-muted-foreground hover:text-foreground"
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

/** One element's issue: what is wrong, the element, its actions */
function IssueItem({ issue, showSummary }: { issue: PageIssue; showSummary: boolean }) {
    const id = useId();
    return (
        <li className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-2.5 py-2">
            <div id={id} className="min-w-0">
                {showSummary && <p className="m-0 break-words text-sm text-foreground">{issue.summary}</p>}
                {issue.label && <p className="m-0 truncate font-mono text-xs text-muted-foreground">{issue.label}</p>}
            </div>
            <IssueActions issue={issue} describedBy={id} />
        </li>
    );
}

/** A check's or a rule's issues, the first few and then all of them */
export function IssueList({ issues, label, showSummary = true }: { issues: PageIssue[]; label: string; showSummary?: boolean }) {
    const [all, setAll] = useState(false);
    const shown = all ? issues : issues.slice(0, firstIssues);
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <ul aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
                {shown.map(issue => <IssueItem key={issue.key} issue={issue} showSummary={showSummary} />)}
            </ul>
            {issues.length > shown.length && (
                <Button size="xs" variant="plain" className="self-start text-muted-foreground hover:text-foreground" onClick={() => setAll(true)}>
                    Show all {issues.length}
                </Button>
            )}
        </div>
    );
}

const stateWords: Record<CheckState, string> = { pass: 'Pass', warn: 'Warning', none: 'Note' };

/** Pass (green check), worth a look (amber warning) or a note (muted: not measured, not needed): shape, colour and the word for screen readers */
export function CheckStateIcon({ state }: { state: CheckState }) {
    const Icon = state === 'pass' ? Check : state === 'warn' ? Warning : Info;
    return (
        <span className="mt-0.5 flex shrink-0">
            <Icon size={16} aria-hidden="true" className={cx(state === 'pass' ? 'text-[hsl(var(--brand-success))]'
                : state === 'warn' ? 'text-[hsl(var(--brand-warning))]' : 'text-muted-foreground')} />
            <span className="sr-only">{stateWords[state]}: </span>
        </span>
    );
}

/** A check: its state, name, what was found and why it passed or is worth a look, then its issues */
export function CheckItem({ check, children }: { check: PageCheck; children?: ReactNode }) {
    const id = useId();
    // An issue about the page as a whole has only its action, under the check that explains it
    const pageIssue = check.issues.length === 1 && !check.issues[0]!.element ? check.issues[0] : undefined;
    return (
        <li className="flex min-w-0 flex-col gap-2 py-2.5" data-uier-check={check.id} data-uier-check-state={check.state}>
            <div className="flex min-w-0 items-start gap-2">
                <CheckStateIcon state={check.state} />
                <div id={id} className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-medium text-foreground">{check.label}</p>
                    {check.value && <p className="m-0 break-words text-sm text-foreground">{check.value}</p>}
                    <p className="m-0 text-xs text-muted-foreground">{check.reason}</p>
                </div>
            </div>
            {pageIssue ? <IssueActions issue={pageIssue} describedBy={id} className="ml-4" />
                : check.issues.length > 0 && <div className="pl-6"><IssueList issues={check.issues} label={check.label} /></div>}
            {children}
        </li>
    );
}

/** A group of checks under its heading */
export function CheckSection({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className="flex min-w-0 flex-col">
            <h3 id={id} className="m-0 text-sm font-semibold text-foreground">{title}</h3>
            {note && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{note}</p>}
            <ul className="m-0 flex list-none flex-col divide-y p-0">{children}</ul>
        </section>
    );
}
