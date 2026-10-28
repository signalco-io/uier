import { z } from 'zod';
import type { DbComment } from '../db/schema';
import { apiErrors } from './http';
import { MAX_LIST_COMMENTS } from './limits';
import { markThreadRead } from './readState';
import { isValidId } from './validation';

export const bulkReadSchema = z.object({ threads: z.array(z.object({
    id: z.string().refine(isValidId, 'Invalid comment id.'),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
})).min(1).max(MAX_LIST_COMMENTS).refine(threads => new Set(threads.map(thread => thread.id)).size === threads.length, 'Duplicate comment id.') });

// 200 maximum-length ids plus safe integer cursors exceed the ordinary 16 KiB body limit.
export const MAX_BULK_READ_BYTES = 48 * 1024;
export type ReadThreadInput = z.infer<typeof bulkReadSchema>['threads'][number];

/** Validate the whole batch before writing. Missing, hidden and failed writes all stay unacknowledged. */
export async function markThreadsRead(input: unknown, reviewerId: string | undefined,
    loadVisible: (id: string) => Promise<DbComment | null>) {
    if (!reviewerId) throw apiErrors.forbidden('A reviewer identity is required.');
    const parsed = bulkReadSchema.safeParse(input);
    if (!parsed.success) throw apiErrors.invalidRequest('Invalid read batch.');
    const reads: { id: string; activity: Awaited<ReturnType<typeof markThreadRead>> }[] = [];
    let next = 0;
    // Each cursor may make eight etag attempts. Keep storage concurrency bounded.
    await Promise.all(Array.from({ length: Math.min(4, parsed.data.threads.length) }, async () => {
        for (;;) {
            const thread = parsed.data.threads[next++];
            if (!thread) return;
            try {
                const comment = await loadVisible(thread.id);
                if (comment) reads.push({ id: thread.id, activity: await markThreadRead(comment, reviewerId, thread.sequence) });
            } catch {
                // Return only successful activity receipts. Do not disclose visibility or failure reasons.
            }
        }
    }));
    return { reads };
}
