import type { DbComment, DbReviewRelease, DbReviewSession } from '../db/schema';
import { getCommentsStore, type CommentsStore, type ReviewSessionWrite } from '../repo/commentsStore';

type ReviewComment = Pick<DbComment, 'domain' | 'id' | 'reviewSession'>;

export const reviewSessionDocumentId = (id: string) => `$review-session_${id}`;
export const reviewReleaseId = (id: string, revision: number) => `$review-release_${id}_${revision}`;

export async function getCommentReviewRelease(comment: ReviewComment, store: CommentsStore = getCommentsStore()) {
    if (!comment.reviewSession) return null;
    const { id, revision } = comment.reviewSession;
    const result = await store.reviewSessionRecord<DbReviewRelease>(comment.domain, reviewReleaseId(id, revision));
    return result?.doc.type === 'review-release' && result.doc.threadIds.includes(comment.id) ? result.doc : null;
}

export async function isReviewCommentReleased(comment: ReviewComment, store?: CommentsStore) {
    return !comment.reviewSession || Boolean(comment.reviewSession.releasedAt || await getCommentReviewRelease(comment, store));
}

/** A point read sees the committed release before the background worker projects it onto comments. */
export async function withReviewRelease(comment: DbComment, store: CommentsStore): Promise<DbComment> {
    if (!comment.reviewSession || comment.reviewSession.releasedAt) return comment;
    const release = await getCommentReviewRelease(comment, store);
    return release ? { ...comment, reviewSession: { ...comment.reviewSession, number: release.number, releasedAt: release.submittedAt } } : comment;
}

/** Serialize pending mutations against Send/Discard in the same partition. */
export async function heldReviewWrite(store: CommentsStore, comment: DbComment, removing = false): Promise<ReviewSessionWrite | null | undefined> {
    const review = comment.reviewSession;
    if (!review || review.releasedAt) return undefined;
    const session = await store.reviewSessionRecord<DbReviewSession>(comment.domain, reviewSessionDocumentId(review.id));
    if (!session || session.doc.type !== 'review-session' || session.doc.state !== 'open'
        || session.doc.revision + 1 !== review.revision || !session.doc.pendingThreadIds.includes(comment.id)) return null;
    const doc = session.doc;
    return {
        operation: 'replace', etag: session.etag,
        doc: removing ? { ...doc, pendingThreadIds: doc.pendingThreadIds.filter(id => id !== comment.id), threadCount: doc.threadCount - 1 } : doc
    };
}
