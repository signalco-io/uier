import { feedbackStage, readyForReview } from '@uier/toolbar/verification';
import { threadRecordTtl } from './retention';
import type { AppDoc } from '../app/model';
import { getAppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import type { DbComment, DbCommentActivity } from '../db/schema';
import { getCommentsStore } from '../repo/commentsStore';
import { MAX_LIST_COMMENTS } from './limits';
import { apiErrors } from './http';
import { readActivity, threadActivity } from './activity';
import { isVisible } from './visibility';

export type DbReviewRead = AppDoc & {
    type: 'review-read'; domain: string; reviewerId: string; readSequence: number; readAt: string;
};

const readPartition = (domain: string, reviewerId: string) => `review-read:${sha256Hex(domain)}:${sha256Hex(reviewerId)}`;

/** The caller must authorize the project and filter private comments before loading their cursors. */
export async function loadReadSequences(domain: string, reviewerId: string | undefined) {
    if (!reviewerId) return new Map<string, number>();
    const receipts = await getAppStore().query<DbReviewRead>({ type: 'review-read', pk: readPartition(domain, reviewerId) });
    return new Map(receipts.map(receipt => [receipt.id, receipt.readSequence]));
}

/** Reusable by notifications after checking current project access and thread visibility. */
export async function getReadSequence(domain: string, reviewerId: string, commentId: string) {
    return (await getAppStore().get<DbReviewRead>(readPartition(domain, reviewerId), commentId))?.doc.readSequence ?? 0;
}

function readReceipt(comment: DbComment, reviewerId: string, readSequence: number): DbReviewRead {
    return {
        type: 'review-read', pk: readPartition(comment.domain, reviewerId), id: comment.id, domain: comment.domain, reviewerId,
        readSequence, readAt: new Date().toISOString(),
        // Members retain their cursor; guest identity is browser/site-local and expires with inactivity.
        ttl: threadRecordTtl(comment, reviewerId.startsWith('user:') ? -1 : 365 * 24 * 60 * 60)
    };
}

/**
 * Caller supplies an authorized, visible thread. Never acknowledges activity newer than the
 * rendered sequence; parallel tabs advance with max(), and stale writes cannot move it back.
 */
export async function markThreadRead(comment: DbComment, reviewerId: string, sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > threadActivity(comment).sequence)
        throw apiErrors.invalidRequest('Invalid activity cursor.');
    const store = getAppStore();
    const pk = readPartition(comment.domain, reviewerId);
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get<DbReviewRead>(pk, comment.id);
        const readSequence = Math.max(stored?.doc.readSequence ?? 0, sequence);
        if (stored && readSequence === stored.doc.readSequence) return readActivity(comment, reviewerId, readSequence);
        const receipt = readReceipt(comment, reviewerId, readSequence);
        if (stored ? await store.replace(receipt, stored.etag) === 'ok' : await store.create(receipt))
            return readActivity(comment, reviewerId, readSequence);
    }
    throw apiErrors.conflict();
}

/**
 * Caller supplies an authorized, visible thread. An explicit Mark as unread: the cursor moves back to
 * just before the latest activity by someone else, so the thread is unread again and earlier activity
 * stays read. A thread with only the reviewer's own activity cannot be unread; it is left as it is.
 */
export async function markThreadUnread(comment: DbComment, reviewerId: string) {
    const { lastOtherSequence } = readActivity(comment, reviewerId);
    const store = getAppStore();
    const pk = readPartition(comment.domain, reviewerId);
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get<DbReviewRead>(pk, comment.id);
        const current = stored?.doc.readSequence ?? 0;
        if (!stored || lastOtherSequence === 0 || current < lastOtherSequence) return readActivity(comment, reviewerId, current);
        const readSequence = lastOtherSequence - 1;
        if (await store.replace(readReceipt(comment, reviewerId, readSequence), stored.etag) === 'ok')
            return readActivity(comment, reviewerId, readSequence);
    }
    throw apiErrors.conflict();
}

/** `open`: not done, so In progress and Ready to verify count there too */
export type ActivitySummary = { unread: number; inProgress: number; ready: number; open: number; done: number; total: number };

/** No text or actor ids are returned to the browser. Authorization/visibility stays server-side. */
export async function projectActivity(domain: string, reviewerId: string | undefined,
    visible: (comment: DbCommentActivity) => boolean = comment => isVisible(comment, { visitor: { authorId: reviewerId } })) {
    const [records, reads] = await Promise.all([getCommentsStore().listActivity(domain), loadReadSequences(domain, reviewerId)]);
    const comments = records.filter(visible).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const unreadIds = comments.filter(comment => readActivity(comment, reviewerId, reads.get(comment.id)).unread).map(comment => comment.id);
    return {
        summary: { unread: unreadIds.length, inProgress: comments.filter(comment => feedbackStage(comment) === 'in-progress').length, ready: comments.filter(readyForReview).length, open: comments.filter(comment => !comment.resolved).length,
            done: comments.filter(comment => comment.resolved).length, total: comments.length } satisfies ActivitySummary,
        unreadIds
    };
}

/** Fetch only a bounded batch of unread content, including old threads outside the newest list. */
export async function unreadComments(domain: string, reviewerId: string | undefined,
    visible: (comment: DbCommentActivity) => boolean = comment => isVisible(comment, { visitor: { authorId: reviewerId } })) {
    const { unreadIds } = await projectActivity(domain, reviewerId, visible);
    const stored = await Promise.all(unreadIds.slice(0, MAX_LIST_COMMENTS).map(id => getCommentsStore().get(domain, id)));
    // Visibility may have changed between the projection and the point read.
    return stored.flatMap(entry => entry && visible(entry.comment) ? [entry.comment] : []);
}
