import { expect, test } from '@playwright/test';
import { compareCommentOrder, orderComments } from '../src/components/app/comments/commentOrder';

// A project's list and board columns show threads by priority (Urgent, High, Normal, Low), then by
// number, highest first.

test('threads order by priority, then by number, highest first', () => {
    const threads = [
        { id: 'a', priority: 'normal', number: 7 },
        { id: 'b', priority: 'low', number: 1 },
        { id: 'c', priority: 'urgent', number: 9 },
        { id: 'd', priority: 'normal', number: 2 },
        { id: 'e', priority: 'high', number: 5 },
        { id: 'f', priority: 'urgent', number: 3 },
        { id: 'g', priority: 'high', number: 4 }
    ] as const;
    expect(orderComments(threads).map(thread => thread.id)).toEqual(['c', 'f', 'e', 'g', 'a', 'd', 'b']);
    // A copy: the given list keeps its order
    expect(threads.map(thread => thread.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('a missing or unknown priority is Normal; threads without a number follow the numbered ones in the given order', () => {
    const threads = [
        { id: 'old-newer', priority: undefined, number: undefined },
        { id: 'numbered', priority: 'normal' as const, number: 12 },
        { id: 'old-older', priority: 'normal' as const, number: undefined },
        { id: 'low', priority: 'low' as const, number: 1 },
        { id: 'unknown', priority: 'critical' as never, number: 3 }
    ];
    expect(orderComments(threads).map(thread => thread.id)).toEqual(['numbered', 'unknown', 'old-newer', 'old-older', 'low']);
    expect(compareCommentOrder({ priority: 'high', number: 2 }, { priority: 'high', number: 2 })).toBe(0);
    expect(compareCommentOrder({ priority: 'urgent', number: 40 }, { priority: 'high', number: 1 })).toBeLessThan(0);
    expect(compareCommentOrder({ number: 10 }, { number: 3 })).toBeLessThan(0);
});
