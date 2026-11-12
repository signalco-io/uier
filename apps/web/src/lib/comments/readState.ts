import { matchesArchive, type ArchiveFilter } from '../repo/archiveFilter';
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

/**
 * `open`: not done, so In progress and Ready to verify count there too. The `unread*` counts are the unread threads in
 * each status (`unreadOpen` only Open itself) and in Archive, so the inbox's status tabs show their unread dot for
 * threads it has not loaded (uier #346). Flat numbers: an account's summaries add up key by key.
 */
export type ActivitySummary = {
    archived: number; unread: number; inProgress: number; ready: number; open: number; done: number; total: number;
    unreadOpen: number; unreadInProgress: number; unreadReady: number; unreadDone: number; unreadArchived: number;
};

/** No text or actor ids are returned to the browser. Authorization/visibility stays server-side. */
export async function projectActivity(domain: string, reviewerId: string | undefined,
    visible: (comment: DbCommentActivity) => boolean = comment => isVisible(comment, { visitor: { authorId: reviewerId } }), archive: ArchiveFilter = 'exclude', verificationEnabled = true) {
    const [records, reads] = await Promise.all([getCommentsStore().listActivity(domain), loadReadSequences(domain, reviewerId)]);
    const visibleRecords = records.filter(visible);
    const comments = visibleRecords.filter(comment => matchesArchive(comment, archive)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const unreadIds = comments.filter(comment => readActivity(comment, reviewerId, reads.get(comment.id)).unread).map(comment => comment.id);
    const unread = new Set(unreadIds);
    const unreadIn = (stage: ReturnType<typeof feedbackStage>) => comments.filter(comment => unread.has(comment.id) && feedbackStage({ ...comment, verificationEnabled }) === stage).length;
    return {
        summary: { archived: visibleRecords.filter(comment => Boolean(comment.archivedAt)).length, unread: unreadIds.length, inProgress: comments.filter(comment => feedbackStage({ ...comment, verificationEnabled }) === 'in-progress').length, ready: comments.filter(comment => readyForReview({ ...comment, verificationEnabled })).length, open: comments.filter(comment => !comment.resolved).length,
            done: comments.filter(comment => comment.resolved).length, total: comments.length,
            unreadOpen: unreadIn('open'), unreadInProgress: unreadIn('in-progress'), unreadReady: unreadIn('ready'), unreadDone: unreadIn('done'),
            unreadArchived: visibleRecords.filter(comment => comment.archivedAt && readActivity(comment, reviewerId, reads.get(comment.id)).unread).length } satisfies ActivitySummary,
        unreadIds
    };
}

/** Fetch only a bounded batch of unread content, including old threads outside the newest list. */
export async function unreadComments(domain: string, reviewerId: string | undefined,
    visible: (comment: DbCommentActivity) => boolean = comment => isVisible(comment, { visitor: { authorId: reviewerId } }), archive: ArchiveFilter = 'exclude') {
    const { unreadIds } = await projectActivity(domain, reviewerId, visible, archive);
    const stored = await Promise.all(unreadIds.slice(0, MAX_LIST_COMMENTS).map(id => getCommentsStore().get(domain, id)));
    // Visibility may have changed between the projection and the point read.
    return stored.flatMap(entry => entry && visible(entry.comment) && matchesArchive(entry.comment, archive) ? [entry.comment] : []);
}
