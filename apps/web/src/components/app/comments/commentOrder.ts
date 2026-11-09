import { commentPriority, type CommentPriority } from '@uier/toolbar/triage';

/** Urgent first, Low last */
const priorityRank: Record<CommentPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type Ordered = { priority?: CommentPriority; number?: number };

/**
 * A project's threads in the order its list and board columns show them: by priority (Urgent, High,
 * Normal, Low; missing is Normal), then by number, highest first, so the newest request of each priority
 * comes first. Threads without a number (older records) come after the numbered ones
 * of their priority, in the order they were given (`sort` is stable).
 */
export function compareCommentOrder(a: Ordered, b: Ordered) {
    const priority = priorityRank[commentPriority(a.priority)] - priorityRank[commentPriority(b.priority)];
    if (priority) return priority;
    if (a.number === undefined || b.number === undefined)
        return a.number === undefined ? (b.number === undefined ? 0 : 1) : -1;
    return b.number - a.number;
}

/** A sorted copy (`compareCommentOrder`) */
export function orderComments<T extends Ordered>(comments: readonly T[]) {
    return [...comments].sort(compareCommentOrder);
}
