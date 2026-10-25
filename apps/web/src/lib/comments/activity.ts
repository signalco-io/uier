import type { DbComment, DbCommentActivity } from '../db/schema';

/** Monotonic per-thread activity. Actor ids stay server-side. No message text is duplicated. */
export type ThreadActivity = { sequence: number; byActor: Record<string, number> };
export type ReadActivity = { sequence: number; lastOtherSequence: number; readSequence: number; unread: boolean };

/** Legacy threads get deterministic cursors before their first activity write. */
export function threadActivity(comment: Pick<DbCommentActivity, 'activity' | 'thread'>): ThreadActivity {
    if (comment.activity) return comment.activity;
    const byActor: Record<string, number> = {};
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    items.forEach((item, index) => {
        if (!item.deletedAt) byActor[item.authorId ?? 'legacy'] = index + 1;
    });
    return { sequence: items.length, byActor };
}

/** Call inside the comment's etag-protected mutation, so concurrent writes cannot share a cursor. */
export function withThreadActivity(comment: DbComment, authorId: string): DbComment {
    const current = threadActivity(comment);
    const sequence = current.sequence + 1;
    return { ...comment, activity: { sequence, byActor: { ...current.byActor, [authorId]: sequence } } };
}

export function readActivity(comment: Pick<DbCommentActivity, 'activity' | 'thread'>, authorId: string | undefined, readSequence = 0): ReadActivity {
    const activity = threadActivity(comment);
    const lastOtherSequence = Math.max(0, ...Object.entries(activity.byActor)
        .filter(([id]) => id !== authorId).map(([, sequence]) => sequence));
    return { sequence: activity.sequence, lastOtherSequence, readSequence, unread: lastOtherSequence > readSequence };
}
