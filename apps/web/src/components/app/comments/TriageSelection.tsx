'use client';

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from 'react';
import { priorities, priorityLabels } from '@uier/toolbar/triage';
import { Button } from '@/src/components/ui/button';
import { cn } from '@/src/lib/utils';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { BulkTriageInput, TriageOperation } from '../../../lib/review/bulkTriageSchema';
import { triageCommentsAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import type { AssigneeOption } from './CommentCard';
import { PriorityFlag } from './PriorityFlag';

const limit = 50;
const Selection = createContext<{ ids: Set<string>; pending: boolean; toggle: (id: string) => void } | null>(null);
export function SelectComment({ comment, tabbable = true }: {
    comment: ProjectCommentView;
    /** In the Tab order; the inbox list keeps only its current row's controls there */
    tabbable?: boolean;
}) {
    const selection = useContext(Selection);
    if (!selection || !comment.permissions.triage) return null;
    // Only set to take it out: an explicit `undefined` would replace Base UI's own tab index
    return <Checkbox aria-label={`Select comment ${comment.number === undefined ? comment.id : `#${comment.number}`}`} {...!tabbable && { tabIndex: -1 }}
        checked={selection.ids.has(comment.id)} disabled={selection.pending || (!selection.ids.has(comment.id) && selection.ids.size >= limit)}
        onCheckedChange={() => selection.toggle(comment.id)} className="pointer-coarse:after:-inset-3.5" />;
}
function patchFor(operation: TriageOperation, assignees: AssigneeOption[]): Partial<ProjectCommentView> {
    if (operation.kind === 'status') return { resolved: operation.resolved };
    if (operation.kind === 'priority') return { priority: operation.priority };
    const person = assignees.find(person => person.userId === operation.assigneeId);
    return { assignee: operation.assigneeId ? { id: operation.assigneeId, name: person?.name ?? 'Former member', avatarUrl: person?.avatarUrl } : undefined };
}
function snapshot(operation: TriageOperation, comments: ProjectCommentView[]): BulkTriageInput {
    if (operation.kind === 'priority') return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.priority, idempotencyKey: crypto.randomUUID() })) };
    if (operation.kind === 'assignment') return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.assignee?.id ?? null, idempotencyKey: crypto.randomUUID() })) };
    return { ...operation, items: comments.map(comment => ({ id: comment.id, expected: comment.resolved, revision: comment.revision, idempotencyKey: crypto.randomUUID() })) };
}

/** Only the explicit, visible selection enters a batch. Polls and later filter changes never extend it. */
export function TriageSelection({ projectId, scope, shown, assignees, barClassName, summary, actions, children }: {
    projectId: string; scope: string; shown: ProjectCommentView[]; assignees: AssigneeOption[];
    /** Hides the selection bar while one thread takes the whole width */
    barClassName?: string;
    /** How many are shown, beside Select shown results; the selection's count replaces it */
    summary?: ReactNode;
    /** At the end of the line while nothing is selected (Mark all as read) */
    actions?: ReactNode;
    children: ReactNode;
}) {
    const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
    const [pending, start] = useTransition();
    const [result, setResult] = useState('');
    const [retry, setRetry] = useState<{ scope: string; batch: BulkTriageInput } | null>(null);
    const [details, setDetails] = useState<{ id: string; label: string; outcome: string }[]>([]);
    if (selection.scope !== scope) { setSelection({ scope, ids: [] }); setRetry(null); }
    const [pendingCount, setPendingCount] = useState(0);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const resultRef = useRef<HTMLParagraphElement>(null);
    const allRef = useRef<HTMLButtonElement>(null);
    const update = useCommentUpdate();
    const eligible = shown.filter(comment => comment.permissions.triage);
    const visible = new Set(eligible.map(comment => comment.id));
    const ids = new Set(selection.scope === scope ? selection.ids.filter(id => visible.has(id)) : []);
    const selected = eligible.filter(comment => ids.has(comment.id));
    const availableAssignees = assignees.filter(person => selected.every(comment => comment.eligibleAssigneeIds.includes(person.userId)));
    const toggle = (id: string) => setSelection({ scope, ids: ids.has(id) ? [...ids].filter(value => value !== id) : [...ids, id].slice(0, limit) });
    const run = (batch: BulkTriageInput) => {
        const originalScope = scope;
        const originals = new Map(shown.map(comment => [comment.id, comment]));
        setPendingCount(batch.items.length);
        setRetry(null);
        start(async () => {
            for (const item of batch.items) update({ id: item.id, patch: patchFor(batch, assignees) });
            const rollback = (id: string) => {
                const original = originals.get(id);
                if (original) update({ id, patch: { priority: original.priority, resolved: original.resolved, assignee: original.assignee } });
            };
            try {
                const response = await triageCommentsAction(projectId, batch);
                if (!response?.ok) throw new Error(response?.error ?? 'Could not save this batch.');
                const { results, counts } = response.data;
                start(() => { for (const item of results) {
                    if (!item.saved) rollback(item.id);
                    else update({ id: item.id, patch: { ...patchFor({ kind: 'assignment', assigneeId: item.saved.assigneeId }, assignees),
                        priority: item.saved.priority, resolved: item.saved.resolved, revision: item.saved.revision } });
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
    const retryBatch = retry?.scope === scope ? { ...retry.batch, items: retry.batch.items.filter(item => visible.has(item.id)) } as BulkTriageInput : undefined;
    const firstShown = eligible.slice(0, limit);
    const allChecked = firstShown.length > 0 && firstShown.every(comment => ids.has(comment.id));
    return <Selection.Provider value={{ ids, pending, toggle }}>
        <div className={cn('flex flex-col gap-2', barClassName)}>
            {/* One line: select all, the count (or the selection's), Mark all as read (or Clear selection) */}
            <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3">
                {eligible.length > 0 && (
                    <Checkbox className="pointer-coarse:after:-inset-3.5" ref={allRef} id="select-shown-feedback" checked={allChecked} indeterminate={ids.size > 0 && !allChecked} disabled={pending}
                        aria-label={eligible.length > limit ? 'Select first 50 shown' : 'Select shown results'}
                        onCheckedChange={() => setSelection({ scope, ids: allChecked ? [] : firstShown.map(comment => comment.id) })} />
                )}
                <span role="status" className="text-sm text-muted-foreground tabular-nums">{ids.size > 0 ? `${ids.size} selected` : summary}</span>
                <div className="ml-auto flex items-center">
                    {ids.size > 0
                        ? <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => { setSelection({ scope, ids: [] }); allRef.current?.focus(); }}>Clear selection</Button>
                        : actions}
                </div>
            </div>
            {(ids.size > 0 || pending) && <div role="group" aria-label="Selected feedback actions" className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                {pending && <span role="status" className="flex items-center gap-2 text-sm"><Spinner />Saving {pendingCount} threads</span>}
                <Select items={{ unassigned: 'Unassign', ...Object.fromEntries(availableAssignees.map(person => [person.userId, person.name])) }} value={null}
                    onValueChange={value => value && begin({ kind: 'assignment', assigneeId: value === 'unassigned' ? null : value })}>
                    <SelectTrigger className="pointer-coarse:min-h-11" aria-label="Assign selected" disabled={pending || !ids.size}><SelectValue placeholder="Assign selected" /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem className="pointer-coarse:min-h-11" value="unassigned">Unassign</SelectItem>{availableAssignees.map(person => <SelectItem className="pointer-coarse:min-h-11" key={person.userId} value={person.userId}>{person.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Select items={priorityLabels} value={null} onValueChange={value => value && begin({ kind: 'priority', priority: value })}>
                    <SelectTrigger className="pointer-coarse:min-h-11" aria-label="Prioritize selected" disabled={pending || !ids.size}><SelectValue placeholder="Set priority" /></SelectTrigger>
                    <SelectContent><SelectGroup>{priorities.map(value => <SelectItem className="pointer-coarse:min-h-11" key={value} value={value}><PriorityFlag priority={value} />{priorityLabels[value]}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Button variant="outline" className="pointer-coarse:min-h-11" disabled={pending || !ids.size} onClick={() => begin({ kind: 'status', resolved: true })}>Mark selected as done</Button>
                <Button variant="outline" className="pointer-coarse:min-h-11" disabled={pending || !ids.size} onClick={() => begin({ kind: 'status', resolved: false })}>Reopen selected</Button>
            </div>}
            {/* Stays mounted for announcements; out of the layout (no extra gap under the line) until there is a result */}
            <p ref={resultRef} role="status" tabIndex={-1} className={cn('m-0 text-sm text-muted-foreground outline-none', !result && 'sr-only')}>{result}</p>
            {details.length > 0 && <ul aria-label="Threads needing attention" className="m-0 list-inside list-disc text-sm text-muted-foreground">
                {details.map(item => <li key={item.id}>{item.label}: {item.outcome}</li>)}
            </ul>}
            {retryBatch && retryBatch.items.length > 0 && <Button variant="outline" className="self-start pointer-coarse:min-h-11" disabled={pending} onClick={() => run(retryBatch)}>Retry failed threads</Button>}
        </div>
        {children}
    </Selection.Provider>;
}
