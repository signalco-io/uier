import { commentPriority, type CommentPriority } from '@uier/toolbar/triage';
import type { BoardSort } from '../../../lib/app/boardSort';

/** Urgent first, Low last */
const priorityRank: Record<CommentPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type Ordered = { priority?: CommentPriority; number?: number };

/**
 * A project's threads in the order its list and active board columns show them: by priority (Urgent, High,
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

type Timed = Ordered & { completedAt?: string; updatedAt?: string; createdAt?: string };

/** Done is a completion history; legacy threads use their last update, then creation. */
export function compareDoneOrder(a: Timed, b: Timed) {
    const time = (comment: typeof a) => {
        for (const value of [comment.completedAt, comment.updatedAt, comment.createdAt]) {
            const parsed = Date.parse(value ?? '');
            if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
    };
    return time(b) - time(a) || compareCommentOrder(a, b);
}

/** The first readable time, in milliseconds */
function timeOf(...values: (string | undefined)[]) {
    for (const value of values) {
        const parsed = Date.parse(value ?? '');
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

/** Earlier or later first; a missing value goes last either way */
function compareValues(a: number | undefined, b: number | undefined, direction: 1 | -1) {
    if (a === undefined || b === undefined) return a === undefined ? (b === undefined ? 0 : 1) : -1;
    return (a - b) * direction;
}

/** Newest first: by when the thread was left, then by number */
export function compareNewestOrder(a: Timed, b: Timed) {
    return compareValues(timeOf(a.createdAt), timeOf(b.createdAt), -1) || compareValues(a.number, b.number, -1);
}

/** Oldest first: by when the thread was left, then by number */
export function compareOldestOrder(a: Timed, b: Timed) {
    return compareValues(timeOf(a.createdAt), timeOf(b.createdAt), 1) || compareValues(a.number, b.number, 1);
}

/** Recently updated first (any saved change: a reply, a move, a priority), then the usual order */
export function compareUpdatedOrder(a: Timed, b: Timed) {
    return compareValues(timeOf(a.updatedAt, a.createdAt), timeOf(b.updatedAt, b.createdAt), -1) || compareCommentOrder(a, b);
}

/** Each board sort's comparison (`lib/app/boardSort.ts`) */
export const boardSortOrders: Record<BoardSort, (a: Timed, b: Timed) => number> = {
    priority: compareCommentOrder,
    newest: compareNewestOrder,
    oldest: compareOldestOrder,
    updated: compareUpdatedOrder,
    completed: compareDoneOrder
};

/**
 * A board column's cards in its sort, a sorted copy. Ties keep the given order, so give the cards in the
 * list's order (`orderComments`), as the board and its drop placeholder both do.
 */
export function sortBoardColumn<T extends Timed>(cards: readonly T[], sort: BoardSort) {
    return [...cards].sort(boardSortOrders[sort]);
}
