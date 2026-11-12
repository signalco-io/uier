'use client';
import { labelLaneKey } from '@/src/lib/app/projectCommentPaging';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState, useTransition } from 'react';
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
                for (const item of result.data.results) {
                    if (item.outcome === 'success' || item.outcome === 'noop') {
                        if (item.outcome === 'success') archived++;
                        // The loaded cards leave the column at once; the page's refresh brings the rest
                        updateComment({ id: item.id, patch: { archivedAt: item.saved?.archivedAt ?? new Date().toISOString() } });
                    } else failed = true;
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
                // As small as the sort beside it; 44 px to tap on a touch screen
                <Button variant="ghost" size="icon-xs" aria-label={name} data-archive-all={lane} disabled={pending} onClick={() => setConfirming(true)}
                    className="relative -my-1 ml-auto font-normal text-muted-foreground after:absolute after:-inset-2.5 hover:text-foreground pointer-fine:after:hidden" />
            )}>
                {pending ? <Spinner /> : <ArchiveIcon />}
            </TooltipTrigger>
            <TooltipContent side="bottom">{name}</TooltipContent>
        </Tooltip>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{count === 1 ? t("Archive 1 thread in {status}?", { status: label }) : t("Archive {count} threads in {status}?", { count, status: label })}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("Every thread in this column under the current filters moves to Archive, including the ones not loaded yet. You can restore each one from its thread.")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { setConfirming(false); run(); }}>{t("Archive all")}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>;
}
