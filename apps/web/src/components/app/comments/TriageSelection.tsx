'use client';

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, useTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { CircleCheckIcon, FlagIcon, ListChecksIcon, RotateCcwIcon, UserIcon, XIcon } from 'lucide-react';
import { priorities, priorityLabels } from '@uier/toolbar/triage';
import { Button } from '@/src/components/ui/button';
import { cn } from '@/src/lib/utils';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Separator } from '@/src/components/ui/separator';
import { Spinner } from '@/src/components/ui/spinner';
import { Toggle } from '@/src/components/ui/toggle';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { BulkTriageInput, TriageOperation } from '../../../lib/review/bulkTriageSchema';
import { triageCommentsAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import type { AssigneeOption } from './CommentCard';
import { PriorityFlag } from './PriorityFlag';
import { ownsKeys } from '../keyboard/keys';

const limit = 50;
const Selection = createContext<{
    ids: Set<string>;
    pending: boolean;
    /** Selecting: every row shows its selection box. At rest a box shows on hover or keyboard focus, never on a touch screen */
    active: boolean;
    /** `event`: the click, for Shift (a range from the last box) */
    toggle: (id: string, event?: Event) => void;
} | null>(null);

/** The row (list) or card (board) an element is in, by the comment's id */
function rowId(element: Element | null) {
    const row = element?.closest<HTMLElement>('[data-comment-id], [data-board-card]');
    return row?.dataset.commentId ?? row?.dataset.boardCard;
}

export function SelectComment({ comment, tabbable = true, className }: {
    comment: ProjectCommentView;
    /** In the Tab order; the inbox list keeps only its current row's controls there */
    tabbable?: boolean;
    className?: string;
}) {
    const selection = useContext(Selection);
    if (!selection || !comment.permissions.triage) return null;
    const checked = selection.ids.has(comment.id);
    return (
        // Above the link that covers the row. At rest the box takes no room (`sr-only`, still focusable, named and
        // clickable) and shows on hover or keyboard focus; a touch screen has no hover, so there it is left out until
        // Select (or a key) starts selecting
        <div className={cn('relative z-10 flex h-5 shrink-0 items-center', className,
            !selection.active && 'pointer-coarse:hidden [[data-comment-row]:not(:hover):not(:has(:focus-visible))_&]:sr-only')}>
            {/* Only set to take it out: an explicit `undefined` would replace Base UI's own tab index */}
            <Checkbox aria-label={`Select comment ${comment.number === undefined ? comment.id : `#${comment.number}`}`} {...!tabbable && { tabIndex: -1 }}
                checked={checked} disabled={selection.pending || (!checked && selection.ids.size >= limit)}
                // Shift extends a range: keep the click from selecting the page's text between the two boxes, but take the focus
                onMouseDown={event => { if (event.shiftKey) { event.preventDefault(); event.currentTarget.focus(); } }}
                onCheckedChange={(_, details) => selection.toggle(comment.id, details.event)}
                className={cn('pointer-coarse:after:-inset-3.5', !selection.active && 'opacity-0 transition-opacity duration-150 ease-out focus-visible:opacity-100 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 motion-reduce:transition-none')} />
        </div>
    );
}
/** `current`: the thread's assignee now; their agent stays only while they stay the assignee */
function patchFor(operation: TriageOperation, assignees: AssigneeOption[], current?: ProjectCommentView['assignee']): Partial<ProjectCommentView> {
    if (operation.kind === 'status') return { resolved: operation.resolved };
    if (operation.kind === 'priority') return { priority: operation.priority };
    const person = assignees.find(person => person.userId === operation.assigneeId);
    const agent = current?.id === operation.assigneeId ? current.agent : undefined;
    return { assignee: operation.assigneeId ? { id: operation.assigneeId, name: person?.name ?? 'Former member', avatarUrl: person?.avatarUrl, ...(agent ? { agent } : {}) } : undefined };
}
function snapshot(operation: TriageOperation, comments: ProjectCommentView[]): BulkTriageInput {
    if (operation.kind === 'priority') return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.priority, idempotencyKey: crypto.randomUUID() })) };
    if (operation.kind === 'assignment') return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.assignee?.id ?? null, idempotencyKey: crypto.randomUUID() })) };
    return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.resolved, revision: comment.revision, idempotencyKey: crypto.randomUUID() })) };
}

/**
 * Selecting threads for one action at a time. Quiet at rest: the count line has Select, and a row's box shows on
 * hover or keyboard focus. Once something is selected (or Select is on) every row shows its box and a floating bar
 * holds the actions, Select shown results and the outcome, over the bottom of the list instead of a row above it.
 * x selects the focused row, Shift-click a range, Ctrl or ⌘ + A the shown results, and Escape or Clear selection ends it.
 * On a touch screen a tap on a row selects it while selecting.
 *
 * Only the explicit, visible selection enters a batch. Polls and later filter changes never extend it.
 */
export function TriageSelection({ projectId, scope, shown, assignees, barClassName, summary, actions, children }: {
    projectId: string; scope: string; shown: ProjectCommentView[]; assignees: AssigneeOption[];
    /** Hides the count line and the selection bar while one thread takes the whole width */
    barClassName?: string;
    /** How many are shown, at the start of the count line */
    summary?: ReactNode;
    /** Right after the summary, beside the unread count it acts on (Mark all as read) */
    actions?: ReactNode;
    children: ReactNode;
}) {
    const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
    // Select is on (or a batch ran): the bar stays, with nothing selected too, until Clear selection or Escape
    const [explicit, setExplicit] = useState(false);
    const [pending, start] = useTransition();
    const [result, setResult] = useState('');
    const [retry, setRetry] = useState<{ scope: string; batch: BulkTriageInput } | null>(null);
    const [details, setDetails] = useState<{ id: string; label: string; outcome: string }[]>([]);
    if (selection.scope !== scope) { setSelection({ scope, ids: [] }); setRetry(null); setExplicit(false); }
    const [pendingCount, setPendingCount] = useState(0);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const resultRef = useRef<HTMLParagraphElement>(null);
    const regionRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const selectRef = useRef<HTMLButtonElement>(null);
    // The box last clicked, where Shift-click starts its range
    const anchor = useRef<string>(undefined);
    const update = useCommentUpdate();
    const eligible = shown.filter(comment => comment.permissions.triage);
    const visible = new Set(eligible.map(comment => comment.id));
    const ids = new Set(selection.scope === scope ? selection.ids.filter(id => visible.has(id)) : []);
    const selected = eligible.filter(comment => ids.has(comment.id));
    const availableAssignees = assignees.filter(person => selected.every(comment => comment.eligibleAssigneeIds.includes(person.userId)));
    const toggle = (id: string, event?: Event) => {
        const from = anchor.current;
        anchor.current = id;
        const order = eligible.map(comment => comment.id);
        const add = !ids.has(id);
        // Shift-click: every shown box between the last one clicked and this one takes this one's new state
        const range = event instanceof globalThis.MouseEvent && event.shiftKey && from && from !== id && visible.has(from)
            ? order.slice(Math.min(order.indexOf(from), order.indexOf(id)), Math.max(order.indexOf(from), order.indexOf(id)) + 1)
            : [id];
        setSelection({ scope, ids: add ? [...ids, ...range.filter(value => !ids.has(value))].slice(0, limit) : [...ids].filter(value => !range.includes(value)) });
    };
    const firstShown = eligible.slice(0, limit);
    const allChecked = firstShown.length > 0 && firstShown.every(comment => ids.has(comment.id));
    const active = explicit || ids.size > 0;
    const retryBatch = retry?.scope === scope ? { ...retry.batch, items: retry.batch.items.filter(item => visible.has(item.id)) } as BulkTriageInput : undefined;
    const outcome = Boolean(result) || details.length > 0 || Boolean(retryBatch?.items.length);
    const open = active || pending || outcome;
    /**
     * Ends selecting: nothing selected, no outcome, every row back at rest. The focus goes to Select when the bar had it.
     * A touch screen leaves the row boxes out at rest, so a focused one hands the focus to its row's link (Select without one).
     * With a fine pointer the focused box stays: a key press shows it (`:focus-visible`).
     */
    const end = () => {
        const focus = document.activeElement;
        if (focus instanceof HTMLElement && focus.dataset.slot === 'checkbox' && rowId(focus) && regionRef.current?.contains(focus)
            && window.matchMedia('(pointer: coarse)').matches) {
            const link = focus.closest('[data-comment-id], [data-board-card]')?.querySelector<HTMLElement>('a[href]');
            (link ?? selectRef.current)?.focus();
        }
        setSelection({ scope, ids: [] });
        setExplicit(false);
        setResult('');
        setDetails([]);
        setRetry(null);
        anchor.current = undefined;
        if (focus && barRef.current?.contains(focus)) selectRef.current?.focus();
    };
    const run = (batch: BulkTriageInput) => {
        const originalScope = scope;
        const originals = new Map(shown.map(comment => [comment.id, comment]));
        setPendingCount(batch.items.length);
        setRetry(null);
        // The bar stays for the outcome and the next action, with the threads that need attention still selected
        setExplicit(true);
        start(async () => {
            for (const item of batch.items) update({ id: item.id, patch: patchFor(batch, assignees, originals.get(item.id)?.assignee) });
            const rollback = (id: string) => {
                const original = originals.get(id);
                if (original) update({ id, patch: { priority: original.priority, resolved: original.resolved, inProgress: original.inProgress, assignee: original.assignee } });
            };
            try {
                const response = await triageCommentsAction(projectId, batch);
                if (!response?.ok) throw new Error(response?.error ?? 'Could not save this batch.');
                const { results, counts } = response.data;
                start(() => { for (const item of results) {
                    if (!item.saved) rollback(item.id);
                    else update({ id: item.id, patch: { ...patchFor({ kind: 'assignment', assigneeId: item.saved.assigneeId }, assignees, originals.get(item.id)?.assignee),
                        priority: item.saved.priority, resolved: item.saved.resolved, inProgress: item.saved.inProgress, revision: item.saved.revision } });
                } });
                const failed = results.filter(item => item.outcome !== 'success' && item.outcome !== 'noop').map(item => item.id);
                setDetails(results.filter(item => failed.includes(item.id)).map(item => ({ id: item.id,
                    label: originals.get(item.id)?.number === undefined ? item.id : `#${originals.get(item.id)!.number}`,
                    outcome: item.outcome === 'conflict' ? 'Stale' : item.outcome === 'unavailable' ? 'Unavailable' : 'Failed' })));
                setSelection(current => current.scope === originalScope ? { scope: originalScope, ids: failed } : current);
                const retryIds = new Set(results.filter(item => item.outcome === 'failure').map(item => item.id));
                if (retryIds.size && scopeRef.current === originalScope) setRetry({ scope: originalScope, batch: { ...batch, items: batch.items.filter(item => retryIds.has(item.id)) } as BulkTriageInput });
                setResult(`${counts.success} changed, ${counts.noop} unchanged, ${counts.conflict} stale, ${counts.unavailable} unavailable, ${counts.failure} failed.${counts.conflict ? ' Review stale threads before starting a new action.' : ''}`);
            } catch {
                start(() => { for (const item of batch.items) rollback(item.id); });
                setDetails([]);
                setSelection(current => current.scope === originalScope ? { scope: originalScope, ids: batch.items.map(item => item.id) } : current);
                if (scopeRef.current === originalScope) setRetry({ scope: originalScope, batch });
                setResult('The batch could not be confirmed. Retry with the same submission keys.');
            }
            if (scopeRef.current === originalScope) resultRef.current?.focus();
        });
    };
    const begin = (operation: TriageOperation) => run(snapshot(operation, selected));

    // x selects the focused row (or card), Ctrl or ⌘ + A the shown results from a row or the bar, Escape closes the
    // bar from the comments or the page. Never while typing or in a menu or dialog, nor a key the page already used.
    const keys = useEffectEvent((event: KeyboardEvent) => {
        const { target } = event;
        const region = regionRef.current;
        if (event.defaultPrevented || event.isComposing || !region || !(target instanceof Element) || ownsKeys(target)) return;
        const inRegion = region.contains(target);
        const onPage = target === document.body || target === document.documentElement;
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        if (event.key === 'Escape' && plain && open && !pending && (inRegion || onPage)) {
            event.preventDefault();
            end();
            return;
        }
        if (!inRegion || pending) return;
        const id = rowId(target);
        if (event.key.toLowerCase() === 'x' && plain && id && visible.has(id) && (ids.has(id) || ids.size < limit)) {
            event.preventDefault();
            toggle(id);
        } else if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && firstShown.length
            && (id || barRef.current?.contains(target))) {
            event.preventDefault();
            setSelection({ scope, ids: firstShown.map(comment => comment.id) });
        }
    });
    useEffect(() => {
        // Bubble phase on the window, after the page's own handlers (the inbox's arrow keys, a menu's Escape)
        const listener = (event: KeyboardEvent) => keys(event);
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, []);

    // The bar floats over the bottom of the comments; the thread beside the list keeps clear of it (`--selection-bar`)
    const [barHeight, setBarHeight] = useState(0);
    useEffect(() => {
        const bar = barRef.current;
        if (!open || !bar) return;
        const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
        observer.observe(bar);
        return () => observer.disconnect();
    }, [open]);

    /** On a touch screen, while selecting, a tap on a row (its link) selects it instead of opening it */
    const tapToSelect = (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as Element;
        const pointer = (event.nativeEvent as PointerEvent).pointerType;
        // `detail` 0: the keyboard (Enter on the link) still opens the thread
        if (!active || pending || event.detail === 0 || (pointer ? pointer !== 'touch' : !window.matchMedia('(pointer: coarse)').matches)) return;
        const id = target.closest('a') ? rowId(target) : undefined;
        if (!id || !visible.has(id) || (!ids.has(id) && ids.size >= limit)) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(id);
    };

    // On a narrow screen the actions keep their words and drop their icons
    const actionClassName = 'pointer-coarse:min-h-11 @max-xl/comments:[&_[data-icon]]:hidden';
    return <Selection.Provider value={{ ids, pending, active, toggle }}>
        <div ref={regionRef} className="contents"
            style={{ '--selection-bar': open ? `calc(${barHeight}px + 1rem)` : '0px' } as CSSProperties} onClickCapture={tapToSelect}>
            {/* The count line: how many are shown, Mark all as read and Select */}
            {/* No side padding: it lines up with the search and Filter row above, in both views */}
            <div className={cn('flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1', barClassName)}>
                <span role="status" className="text-sm text-muted-foreground tabular-nums">{summary}</span>
                {actions}
                <div className="ml-auto flex items-center gap-1">
                    {eligible.length > 0 && (
                        <Toggle ref={selectRef} size="sm" aria-label="Select comments" pressed={active} disabled={pending}
                            onPressedChange={pressed => { if (pressed) setExplicit(true); else end(); }} className="pointer-coarse:min-h-11">
                            <ListChecksIcon data-icon="inline-start" />Select
                        </Toggle>
                    )}
                </div>
            </div>
            {/* Floating over the end of the comments (after them on screen, `order-last`), next after Select in the focus order */}
            {open && (
                <div ref={barRef} role="group" aria-label="Selected feedback actions"
                    className={cn('sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 order-last flex max-w-full flex-col gap-1 self-center rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md @max-xl/comments:w-full',
                        'animate-in fade-in-0 slide-in-from-bottom-2 duration-150 ease-out motion-reduce:animate-none', barClassName)}>
                    {/* Above the actions, so they stay where they are when an outcome appears */}
                    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1', !outcome && 'sr-only')}>
                        {/* Stays mounted for announcements */}
                        <p ref={resultRef} role="status" tabIndex={-1} className="m-0 flex-1 text-sm text-muted-foreground outline-none">{result}</p>
                        {details.length > 0 && <ul aria-label="Threads needing attention" className="m-0 w-full list-inside list-disc text-sm text-muted-foreground">
                            {details.map(item => <li key={item.id}>{item.label}: {item.outcome}</li>)}
                        </ul>}
                        {retryBatch && retryBatch.items.length > 0 && <Button size="sm" variant="outline" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => run(retryBatch)}>Retry failed threads</Button>}
                        {!active && !pending && (
                            <Button size="icon-sm" variant="ghost" aria-label="Dismiss" className="-my-1 pointer-coarse:size-11" onClick={end}><XIcon /></Button>
                        )}
                    </div>
                    {(active || pending) && (
                        <div className="flex flex-wrap items-center gap-1 @xl/comments:flex-nowrap">
                            <Button size="icon-sm" variant="ghost" aria-label="Clear selection" className="pointer-coarse:size-11" disabled={pending} onClick={end}><XIcon /></Button>
                            <div className="flex min-h-8 items-center gap-2.5 pr-2 pl-1">
                                <Checkbox className="pointer-coarse:after:-inset-3.5" checked={allChecked} indeterminate={ids.size > 0 && !allChecked} disabled={pending || !eligible.length}
                                    aria-label={eligible.length > limit ? 'Select first 50 shown' : 'Select shown results'}
                                    onCheckedChange={() => { setExplicit(true); setSelection({ scope, ids: allChecked ? [] : firstShown.map(comment => comment.id) }); }} />
                                {pending
                                    ? <span role="status" className="flex items-center gap-2 text-sm whitespace-nowrap"><Spinner />Saving {pendingCount} threads</span>
                                    : <span role="status" className="text-sm whitespace-nowrap tabular-nums">{ids.size} selected</span>}
                            </div>
                            <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center @max-xl/comments:hidden" />
                            {/* On a narrow screen the actions take a line of their own */}
                            <div className="flex items-center gap-1 @max-xl/comments:w-full @max-xl/comments:justify-between">
                                <Select items={{ unassigned: 'Unassign', ...Object.fromEntries(availableAssignees.map(person => [person.userId, person.name])) }} value={null}
                                    onValueChange={value => value && begin({ kind: 'assignment', assigneeId: value === 'unassigned' ? null : value })}>
                                    <SelectTrigger size="sm" className={cn('border-transparent hover:bg-muted data-placeholder:text-foreground dark:bg-transparent', actionClassName)} aria-label="Assign selected" disabled={pending || !ids.size}>
                                        <UserIcon data-icon="inline-start" aria-hidden="true" /><SelectValue placeholder="Assign" />
                                    </SelectTrigger>
                                    <SelectContent side="top" alignItemWithTrigger={false}><SelectGroup><SelectItem className="pointer-coarse:min-h-11" value="unassigned">Unassign</SelectItem>{availableAssignees.map(person => <SelectItem className="pointer-coarse:min-h-11" key={person.userId} value={person.userId}>{person.name}</SelectItem>)}</SelectGroup></SelectContent>
                                </Select>
                                <Select items={priorityLabels} value={null} onValueChange={value => value && begin({ kind: 'priority', priority: value })}>
                                    <SelectTrigger size="sm" className={cn('border-transparent hover:bg-muted data-placeholder:text-foreground dark:bg-transparent', actionClassName)} aria-label="Prioritize selected" disabled={pending || !ids.size}>
                                        <FlagIcon data-icon="inline-start" aria-hidden="true" /><SelectValue placeholder="Priority" />
                                    </SelectTrigger>
                                    <SelectContent side="top" alignItemWithTrigger={false}><SelectGroup>{priorities.map(value => <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}><PriorityFlag priority={value} />{priorityLabels[value]}</SelectItem>)}</SelectGroup></SelectContent>
                                </Select>
                                <Button size="sm" variant="ghost" aria-label="Mark selected as done" className={actionClassName} disabled={pending || !ids.size} onClick={() => begin({ kind: 'status', resolved: true })}>
                                    <CircleCheckIcon data-icon="inline-start" />Done
                                </Button>
                                <Button size="sm" variant="ghost" aria-label="Reopen selected" className={actionClassName} disabled={pending || !ids.size} onClick={() => begin({ kind: 'status', resolved: false })}>
                                    <RotateCcwIcon data-icon="inline-start" />Reopen
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {children}
        </div>
    </Selection.Provider>;
}
