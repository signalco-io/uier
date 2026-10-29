import { withNotificationEvent } from '../notifications/events';
import { createHash } from 'node:crypto';
import type { DbComment, DbScreenshot, DbSubmission, DbThreadItem } from '../db/schema';
import type { CommentsStore } from '../repo/commentsStore';
import { ApiError, apiErrors } from './http';
import { MAX_THREAD_ITEMS } from './limits';
import { withThreadActivity } from './activity';

/** Longer than the seven-day local draft lifetime; receipts contain hashes and ids only. */
export const submissionTtlSeconds = 30 * 24 * 60 * 60;

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
export type Submission = { id: string; domain: string; fingerprint: string };

/** One key namespace per actor/partition, shared by create and reply to reject cross-operation reuse. */
export function submission(domain: string, actor: string, key: string | undefined, content: unknown): Submission | undefined {
    return key ? { domain, id: `$submission_${hash([actor, key])}`, fingerprint: hash(content) } : undefined;
}

export async function recoverSubmission(store: CommentsStore, attempt: Submission | undefined): Promise<DbComment | undefined> {
    if (!attempt) return undefined;
    const receipt = await store.getSubmission(attempt.domain, attempt.id);
    if (!receipt) return undefined;
    if (receipt.fingerprint !== attempt.fingerprint)
        throw new ApiError(409, 'conflict', 'This submission key was already used for different feedback.');
    const saved = await store.get(attempt.domain, receipt.commentId);
    // A deleted/expired comment must never be recreated by replaying an old attempt.
    if (!saved) throw apiErrors.notFound('This feedback was saved and has since been removed.');
    return saved.comment;
}

/** Commit then recover even if the database response itself was lost. */
async function commit(store: CommentsStore, attempt: Submission, comment: DbComment, etag?: string, screenshot?: DbScreenshot) {
    const receipt: DbSubmission = { ...attempt, type: 'submission', commentId: comment.id, ttl: submissionTtlSeconds };
    try {
        if (await store.commitSubmission(receipt, comment, etag, screenshot) === 'ok') return comment;
    } catch (error) {
        const saved = await recoverSubmission(store, attempt);
        if (saved) return saved;
        throw error;
    }
    return await recoverSubmission(store, attempt);
}

export async function commitNewSubmission(store: CommentsStore, attempt: Submission, comment: DbComment, screenshot?: DbScreenshot) {
    try {
        const saved = await commit(store, attempt, comment, undefined, screenshot);
        if (saved) return saved;
    } catch (error) {
        if (!screenshot) throw error;
        // A failed image transaction rolled back the text and receipt too. Retry without the image.
        delete comment.screenshot;
        const saved = await commit(store, attempt, comment);
        if (saved) return saved;
    }
    throw apiErrors.conflict();
}

export async function commitReplySubmission(store: CommentsStore, attempt: Submission, id: string, item: DbThreadItem,
    visible: (comment: DbComment) => unknown = () => undefined,
    prepare?: (previous: DbComment, updated: DbComment) => DbComment | Promise<DbComment>) {
    for (let retry = 0; retry < 8; retry++) {
        const recovered = await recoverSubmission(store, attempt);
        if (recovered) { await visible(recovered); return recovered; }
        const stored = await store.get(attempt.domain, id);
        if (!stored) throw apiErrors.notFound();
        await visible(stored.comment);
        if (stored.comment.thread.items.length >= MAX_THREAD_ITEMS)
            throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);
        const updated = { ...withThreadActivity(stored.comment, item.authorId ?? 'legacy'), thread: { ...stored.comment.thread, items: [...stored.comment.thread.items, item] }, updatedAt: item.createdAt };
        const comment = prepare ? await prepare(stored.comment, updated)
            : withNotificationEvent(updated, item.authorId ?? 'legacy', 'reply', item.createdAt);
        const saved = await commit(store, attempt, comment, stored.etag);
        if (saved) { await visible(saved); return saved; }
    }
    throw apiErrors.conflict();
}

/** Same partition transaction as replies: desired-state changes cannot replay over newer work. */
export async function commitChangeSubmission(store: CommentsStore, attempt: Submission, id: string,
    visible: (comment: DbComment) => unknown, change: (comment: DbComment) => Promise<DbComment>) {
    for (let retry = 0; retry < 8; retry++) {
        const recovered = await recoverSubmission(store, attempt);
        if (recovered) { await visible(recovered); return recovered; }
        const stored = await store.get(attempt.domain, id);
        if (!stored) throw apiErrors.notFound();
        await visible(stored.comment);
        const updated = await change(stored.comment);
        const saved = await commit(store, attempt, updated, stored.etag);
        if (saved) { await visible(saved); return saved; }
    }
    throw apiErrors.conflict();
}
