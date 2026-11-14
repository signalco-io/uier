'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { CheckCheckIcon } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import type { ReadThreadInput } from '../../../lib/comments/bulkRead';
import { markCommentsReadAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

/** Inputs are the rendered, filtered snapshot, including its activity cursors. */
export function MarkAllRead({ projectId, threads, shownOnly = false }: { projectId: string; threads: ReadThreadInput[]; shownOnly?: boolean }) {
    const { t } = useAppI18n();
    const [pending, startTransition] = useTransition();
    const updateComment = useCommentUpdate();
    const run = (snapshot: ReadThreadInput[]) => startTransition(async () => {
        const confirmations = new Map(snapshot.map(thread => [thread.id, updateComment({ id: thread.id, readSequence: thread.sequence })]));
        let written = 0;
        const failed: ReadThreadInput[] = [];
        for (let offset = 0; offset < snapshot.length; offset += 200) {
            const batch = snapshot.slice(offset, offset + 200);
            try {
                const result = await markCommentsReadAction(projectId, batch);
                if (!result?.ok) {
                    failed.push(...snapshot.slice(offset));
                    break;
                }
                const saved = new Set(result.data.reads.map(read => read.id));
                for (const id of saved) confirmations.get(id)?.();
                written += saved.size;
                failed.push(...batch.filter(thread => !saved.has(thread.id)));
            } catch {
                failed.push(...snapshot.slice(offset));
                break;
            }
        }
        if (written) toast.success(written === 1 ? t("1 thread marked as read.") : t("{count} threads marked as read.", { count: written }));
        if (failed.length) toast.error(t("Some threads could not be marked as read."), {
            action: { label: t("Retry"), onClick: () => run(failed) }
        });
    });

    if (!threads.length) return null;
    // Beside the unread count: a small filled button with the unread accent on its icon, so it reads as that count's action
    return <Button size="xs" variant="secondary" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => run(threads)}>
        <CheckCheckIcon data-icon="inline-start" aria-hidden="true" className="text-[hsl(var(--brand-accent-text))]" />
        {pending ? t("Marking as read…") : t(shownOnly ? "Mark shown as read" : "Mark all as read")}
    </Button>;
}
