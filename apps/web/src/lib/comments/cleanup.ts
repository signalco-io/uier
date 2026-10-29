import { brand } from '@uier/brand';
import type { AppDoc } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { PUBLIC_PROJECT_ID, PUBLIC_WORKSPACE_ID } from './publicProjectPolicy';

const publicPartition = `project:${PUBLIC_PROJECT_ID}`;
type Cleanup = AppDoc & { type: 'thread-cleanup'; domain: string; threadId: string; records: boolean; complete?: boolean };

/** The migration receipt proves that this particular legacy copy is no longer authoritative. */
async function removeLegacyCopy(domain: string, id: string, comments: CommentsStore, app: AppStore) {
    if (domain !== publicPartition || !await app.get(`workspace:${PUBLIC_WORKSPACE_ID}`, 'public-feedback-migration-v1')) return;
    const legacy = await comments.get(brand.domain, id);
    if (legacy && await comments.delete(brand.domain, id, legacy.etag) === 'conflict')
        throw new Error('Legacy feedback changed during cleanup');
    await comments.deleteScreenshot(brand.domain, id);
}

async function performCleanup(job: Cleanup, comments: CommentsStore, app: AppStore) {
    // A queued job can be retried after a crash. Never remove records belonging to a live thread.
    const live = job.records && Boolean(await comments.get(job.domain, job.threadId));
    if (job.records && !live) {
        for (const type of ['notification-subscription', 'notification-delivery', 'review-read']) {
            if (type !== 'review-read' && !job.domain.startsWith('project:')) continue;
            const where: Record<string, string> = type === 'review-read'
                ? { domain: job.domain, id: job.threadId }
                : { projectId: job.domain.slice('project:'.length), threadId: job.threadId };
            for (const doc of await app.query({ type, ...(type === 'review-read' ? {} : { pk: `notifications:${job.domain.slice('project:'.length)}` }), where })) await app.delete(doc.pk, doc.id);
        }
    }
    await removeLegacyCopy(job.domain, job.threadId, comments, app);
    // Pending cleanup never expires. Keep a completed intent for a day to catch in-flight writes,
    // without extending that day on each successful scheduled run.
    if (!live) {
        const current = await app.get<Cleanup>(job.pk, job.id);
        if (current && !current.doc.complete)
            await app.replace({ ...current.doc, complete: true, ttl: 86400 }, current.etag);
    }
}

/** Shared by every whole-thread delete and public image replacement. Failure leaves a durable retry. */
export async function queueThreadCleanup(domain: string, id: string, records: boolean, app = getAppStore()) {
    const job: Cleanup = { type: 'thread-cleanup', pk: 'thread-cleanup', id: sha256Hex(`${domain}:${id}:${records}`), domain, threadId: id, records, ttl: -1 };
    await app.create(job);
    return job;
}

export async function cleanupThread(domain: string, id: string, records: boolean, comments = getCommentsStore(), app = getAppStore()) {
    if (!records && domain !== publicPartition) return;
    const job = await queueThreadCleanup(domain, id, records, app);
    const saved = await app.get<Cleanup>(job.pk, job.id);
    if (saved) await performCleanup(saved.doc, comments, app);
}

/** Scheduled alongside notifications; screenshot projection excludes image bytes. */
export async function sweepCommentCleanup(comments = getCommentsStore(), app = getAppStore(), now = Date.now()) {
    let failed = 0;
    for (const job of await app.query<Cleanup>({ type: 'thread-cleanup' })) {
        try { await performCleanup(job, comments, app); }
        catch { failed++; console.error('[comments] Scheduled thread cleanup needs retry'); }
    }
    let cursor: string | undefined;
    let removed = 0;
    do {
        const page = await comments.listScreenshotsBefore(new Date(now - 60 * 60 * 1000).toISOString(), cursor);
        for (const image of page.items) {
            try {
                const owner = await comments.get(image.domain, image.commentId);
                if (!owner?.comment.screenshot) {
                    await comments.deleteScreenshot(image.domain, image.commentId, image.etag);
                    removed++;
                }
            } catch { failed++; console.error('[comments] Scheduled image cleanup needs retry'); }
        }
        cursor = page.continuation;
    } while (cursor);
    return { removed, failed };
}
