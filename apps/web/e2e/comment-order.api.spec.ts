import { expect, test } from '@playwright/test';
import { compareCommentOrder, compareDoneOrder, orderComments } from '../src/components/app/comments/commentOrder';

// A project's list and active board columns show threads by priority (Urgent, High, Normal, Low), then by
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

test('Done uses completion time before priority and number, with legacy timestamp fallbacks', () => {
    const threads = [
        { number: 99, priority: 'urgent' as const, completedAt: '2026-01-01', updatedAt: '2026-12-01' },
        { number: 1, priority: 'low' as const, completedAt: '2026-03-01' },
        { number: 3, updatedAt: '2026-02-01' },
        { number: 4, createdAt: '2026-01-15' },
        { number: 5 }
    ];
    expect([...threads].sort(compareDoneOrder).map(thread => thread.number)).toEqual([1, 3, 4, 99, 5]);
});

test('Done timestamps survive same-status writes and refresh after reopening', async () => {
    const { ordinaryVerificationStatus } = await import('../src/lib/comments/verificationState');
    const original = { resolved: false, completedAt: '2020-01-01' } as import('../src/lib/db/schema').DbComment;
    const done = ordinaryVerificationStatus(original, true);
    expect(Date.parse(done.completedAt!)).toBeGreaterThan(Date.parse(original.completedAt!));
    expect(ordinaryVerificationStatus(done, true)).toBe(done);
    const reopened = ordinaryVerificationStatus(done, false);
    expect(reopened.completedAt).toBe(done.completedAt);
    expect(ordinaryVerificationStatus({ ...reopened, completedAt: '2021-01-01' }, true).completedAt).not.toBe('2021-01-01');
});
