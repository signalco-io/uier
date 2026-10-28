'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import type { ReadThreadInput } from '../../../lib/comments/bulkRead';
import { markCommentsReadAction } from './actions';

/** Inputs are the rendered, filtered snapshot, including its activity cursors. */
export function MarkAllRead({ projectId, threads }: { projectId: string; threads: ReadThreadInput[] }) {
    const [pending, startTransition] = useTransition();
    const router = useRouter();
    const run = (snapshot: ReadThreadInput[]) => startTransition(async () => {
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
                written += saved.size;
                failed.push(...batch.filter(thread => !saved.has(thread.id)));
            } catch {
                failed.push(...snapshot.slice(offset));
                break;
            }
        }
        router.refresh();
        if (written) toast.success(`${written} ${written === 1 ? 'thread' : 'threads'} marked as read.`);
        if (failed.length) toast.error('Some threads could not be marked as read.', {
            action: { label: 'Retry', onClick: () => run(failed) }
        });
    });

    if (!threads.length) return null;
    return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(threads)}>
        {pending ? 'Marking as read…' : 'Mark all as read'}
    </Button>;
}
