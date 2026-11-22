import type { DbComment, DbReviewRelease } from '../../db/schema';
import type { CommentsStore } from '../../repo/commentsStore';
import type { NotificationEvent } from '../../notifications/delivery';

export function reviewCreatedEvent(comment: DbComment, release: DbReviewRelease): NotificationEvent | undefined {
    if (!release.threadIds.includes(comment.id) || comment.reviewSession?.id !== release.sessionId
        || comment.reviewSession.revision !== release.revision) return undefined;
    const original = comment.notificationEvents?.find(event => event.kind === 'comment' && event.reviewHeld);
    return original && { ...original, at: release.submittedAt, reviewHeld: undefined, recipients: undefined };
}

export async function* releasedThreads(comments: CommentsStore, release: DbReviewRelease) {
    // Keep the fanout bounded and avoid reading threads from any other partition.
    for (let index = 0; index < release.threadIds.length; index += 8) {
        const stored = await Promise.all(release.threadIds.slice(index, index + 8).map(id => comments.get(release.domain, id)));
        for (const entry of stored) {
            if (!entry) continue;
            const event = reviewCreatedEvent(entry.comment, release);
            if (event) yield { comment: entry.comment, event };
        }
    }
}
