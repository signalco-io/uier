import type { DbProject } from '../app/model';
import { forgetScreenshot } from '../comments/service';
import { cleanupRemovedRecordings } from '../recordings/service';
import { getCommentsStore } from '../repo/commentsStore';
import { deleteProjectThread, projectPartition } from '../review/comments';

/** Continue in bounded batches while the retired asset has a durable storage cleanup record. */
export async function retireDeletedProofThreads(project: DbProject, assetId: string) {
    const comments = getCommentsStore();
    const domain = projectPartition(project.id);
    const limit = 25;
    const rows = await comments.listPage(domain, { proof: { asset: assetId }, limit: limit + 1 });
    const completed = await Promise.all(rows.slice(0, limit).map(async row => {
        const stored = await comments.get(domain, row.id);
        if (!stored || stored.comment.assetTarget?.assetId !== assetId) return true;
        const removed = await deleteProjectThread(comments, project, stored.comment, stored.etag);
        if (removed === 'ok') {
            await forgetScreenshot(comments, domain, row.id, Boolean(stored.comment.screenshot), null,
                stored.comment.thread.items.filter(item => item.screenshot).map(item => item.id));
            await cleanupRemovedRecordings(stored.comment, null, comments);
        }
        return removed !== 'conflict';
    }));
    return rows.length <= limit && completed.every(Boolean);
}
