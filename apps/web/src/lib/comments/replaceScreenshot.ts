import { nanoid } from 'nanoid';
import { screenshotDocumentId, type DbComment, type DbScreenshot } from '../db/schema';
import type { CommentsStore } from '../repo/commentsStore';
import { ApiError, apiErrors } from './http';
import { enforceScreenshotLimits } from './rateLimits';
import type { ParsedScreenshot } from './screenshot';
import { screenshotInfo } from './service';

/** Recheck visibility/ownership on every retry; keep original bytes until the transaction commits. */
export async function replaceSavedScreenshot(
    store: CommentsStore, domain: string, id: string,
    input: { screenshot: ParsedScreenshot; expectedRevision: string | null },
    authorize: (comment: DbComment) => void
) {
    let counted = false;
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get(domain, id);
        if (!stored) throw apiErrors.notFound();
        const comment = stored.comment;
        authorize(comment);
        if (!comment.thread.items[0] || comment.thread.items[0].deletedAt) throw apiErrors.notFound();
        if ((comment.screenshot?.revision ?? null) !== input.expectedRevision)
            throw new ApiError(409, 'conflict', 'The screenshot changed. Reload it before replacing it.');
        if (!counted) {
            await enforceScreenshotLimits(store, domain);
            counted = true;
        }
        const now = new Date().toISOString();
        const info = { ...screenshotInfo(input.screenshot), revision: nanoid() };
        const updated = { ...comment, screenshot: info, updatedAt: now };
        const image: DbScreenshot = {
            ...info, id: screenshotDocumentId(id), domain, type: 'screenshot', commentId: id,
            data: input.screenshot.data.toString('base64'), createdAt: now,
            ...(comment.ttl !== undefined ? { ttl: comment.ttl } : {})
        };
        const result = await store.replaceScreenshot(updated, stored.etag, image);
        if (result === 'ok') return updated;
        if (result === 'not_found') throw apiErrors.notFound();
        // A reply/private change can race us; reauthorize against its new version.
    }
    throw apiErrors.conflict();
}
