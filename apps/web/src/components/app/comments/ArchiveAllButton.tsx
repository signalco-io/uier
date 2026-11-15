'use client';
import { labelLaneKey } from '@/src/lib/app/projectCommentPaging';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useId, useRef, useState, useTransition } from 'react';
import { ArchiveIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle
} from '@/src/components/ui/alert-dialog';
import { boardColumnThreadsAction, triageCommentsAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

/** The bulk action's batch size (`MAX_TRIAGE_THREADS` in `bulkTriageSchema.ts`, which the browser cannot import) */
const batchSize = 50;

/** What Archive all needs to find a column's threads: the project and the board's filters (the page's query) */
export type ArchiveAllScope = { projectId: string; group?: string; params: Record<string, string> };

/**
 * Archive all, a small icon button in a board column's header, left of its sort (uier #357). After a confirmation it
 * archives every thread in the column under the board's filters, the ones not loaded yet too: the server lists them
 * (`boardColumnThreadsAction`) and they are archived 50 at a time through the same bulk action as the selection bar.
 * Each thread can be restored from its own menu.
 */
export function ArchiveAllButton({ scope, lane, label, count }: { scope: ArchiveAllScope; lane: string; label: string; count: number }) {
    const { t } = useAppI18n();
    const [confirming, setConfirming] = useState(false);
    // The tooltip's trigger keeps its own ref: the button is found by this
    const buttonId = useId();
    const confirmed = useRef(false);
    // A frame at a time until the dialog has gone and the page is no longer inert (this button and its dialog may have
    // gone already with the column's cards); never from where the focus went since
    const focusSort = (sort: HTMLElement | null | undefined, frames = 30): void => void requestAnimationFrame(() => {
        const focus = document.activeElement;
        if (!sort?.isConnected) return;
        if (sort.closest('[inert]') || focus?.closest('[role="alertdialog"]')) {
            if (frames > 0) focusSort(sort, frames - 1);
            return;
        }
        if (!focus || focus === document.body || focus.matches(`[data-archive-all-button="${CSS.escape(buttonId)}"]`)) sort.focus({ preventScroll: true });
    });
    const [pending, start] = useTransition();
    const updateComment = useCommentUpdate();
    const run = () => start(async () => {
        let archived = 0, failed = false;
        try {
            const listed = await boardColumnThreadsAction(scope.projectId, scope.params, scope.group ? labelLaneKey(lane, scope.group) : lane);
            if (!listed?.ok) throw new Error(listed?.error);
            for (let offset = 0; offset < listed.data.length; offset += batchSize) {
                const ids = listed.data.slice(offset, offset + batchSize);
                const result = await triageCommentsAction(scope.projectId, { kind: 'archive', items: ids.map(id => ({ id, idempotencyKey: crypto.randomUUID() })) });
                if (!result?.ok) { failed = true; break; }
                // The loaded cards leave the column at once (one after another, `useLeavingCards`) and stay out of it until the
                // page's refresh shows them archived: each change is confirmed with its saved sequence (optimistic-status.md)
                start(() => {
                    for (const item of result.data.results) {
                        if (item.outcome === 'success' || item.outcome === 'noop') {
                            const confirm = updateComment({ id: item.id, patch: { archivedAt: item.saved?.archivedAt ?? new Date().toISOString() } });
                            if (item.saved) confirm({ commentSequence: item.saved.commentSequence });
                        }
                    }
                });
                for (const item of result.data.results) {
                    if (item.outcome === 'success') archived++;
                    else if (item.outcome !== 'noop') failed = true;
                }
            }
        } catch { failed = true; }
        if (archived) toast.success(archived === 1 ? t("1 thread archived.") : t("{count} threads archived.", { count: archived }));
        if (failed) toast.error(t("Some threads could not be archived."), { action: { label: t("Retry"), onClick: run } });
    });
    const name = t("Archive all in {status}", { status: label });
    return <>
        <Tooltip>
            <TooltipTrigger render={(
                // As small as the sort beside it; 44 px to tap on a touch screen. Disabled only while it saves: its spinner
                // keeps full strength, like the column's progress spinner beside it (uier #441)
                <Button variant="ghost" size="icon-xs" aria-label={name} data-archive-all={lane} data-archive-all-button={buttonId} disabled={pending} onClick={() => { confirmed.current = false; setConfirming(true); }}
                    className="relative -my-1 ml-0 font-normal text-muted-foreground after:absolute after:-inset-2.5 hover:text-foreground disabled:opacity-100 pointer-fine:after:hidden" />
            )}>
                {pending ? <Spinner /> : <ArchiveIcon />}
            </TooltipTrigger>
            <TooltipContent side="bottom">{name}</TooltipContent>
        </Tooltip>
        {/* Archived, the column empties and this button goes (it is disabled meanwhile): the focus goes to the column's sort
            beside it (uier #444), once the dialog has gone and the page is no longer inert; Cancel returns it here */}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent finalFocus={() => !confirmed.current}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{count === 1 ? t("Archive 1 thread in {status}?", { status: label }) : t("Archive {count} threads in {status}?", { count, status: label })}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("Every thread in this column under the current filters moves to Archive, including the ones not loaded yet. You can restore each one from its thread.")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        const sort = document.querySelector(`[data-archive-all-button="${CSS.escape(buttonId)}"]`)?.parentElement?.querySelector<HTMLElement>('[data-board-sort]');
                        confirmed.current = true;
                        setConfirming(false);
                        run();
                        focusSort(sort);
                    }}>{t("Archive all")}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>;
}
