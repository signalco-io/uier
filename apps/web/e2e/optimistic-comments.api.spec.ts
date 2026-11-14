import { expect, test } from '@playwright/test';
import type { ProjectCommentView } from '../src/lib/app/projectComments';
import { applyCommentUpdate, savedReply, type SentReply } from '../src/components/app/comments/CommentUpdates';
import { commentWriteObserved, commentWrites, latestCommentWrites } from '../src/components/app/comments/commentUpdateAcknowledgement';

const thread = {
    id: 'thread', resolved: false, inProgress: false, priority: 'normal', replies: [],
    activity: { sequence: 5, readSequence: 0, lastOtherSequence: 5, unread: true }
} as unknown as ProjectCommentView;

test('a confirmed read covers only its rendered cursor and yields when the server acknowledges it', () => {
    const [read] = commentWrites({ id: thread.id, readSequence: 5 }, 1, thread);
    expect(commentWriteObserved(read!, [thread])).toBe(false);
    expect(applyCommentUpdate(thread, read!.update).activity?.unread).toBe(false);
    const newer = { ...thread, activity: { ...thread.activity!, sequence: 6, lastOtherSequence: 6 } };
    expect(applyCommentUpdate(newer, read!.update).activity).toMatchObject({ readSequence: 5, unread: true, lastOtherSequence: 6 });
    expect(commentWriteObserved(read!, [{ ...newer, activity: { ...newer.activity, readSequence: 5 } }])).toBe(true);
    // The manual single-read patch obeys the same contract.
    expect(applyCommentUpdate(newer, { id: thread.id, patch: { activity: { ...thread.activity!, readSequence: 5, unread: false } } }).activity)
        .toMatchObject({ sequence: 6, lastOtherSequence: 6, readSequence: 5, unread: true });
});

test('status acknowledges saved meaning rather than client completion timestamps', () => {
    const [done] = commentWrites({ id: thread.id, patch: { resolved: true, inProgress: false, workflowStatusId: undefined,
        updatedAt: 'client time', completedAt: 'client time' } }, 1, thread);
    expect(commentWriteObserved(done!, [{ ...thread }])).toBe(false);
    expect(commentWriteObserved(done!, [{ ...thread, resolved: true, workflowStatusId: 'done', updatedAt: 'server time', completedAt: 'server time' }])).toBe(true);
});

test('a saved comment sequence rejects older matches and releases concurrent newer edits', () => {
    const [status] = commentWrites({ id: thread.id, patch: { resolved: true } }, 1, thread);
    const received = { ...status!, commentSequence: 7 };
    expect(commentWriteObserved(received, [{ ...thread, resolved: true, activity: { ...thread.activity!, sequence: 6 } }])).toBe(false);
    expect(commentWriteObserved(received, [{ ...thread, resolved: true, activity: { ...thread.activity!, sequence: 7 } }])).toBe(true);
    expect(commentWriteObserved(received, [{ ...thread, resolved: false, activity: { ...thread.activity!, sequence: 8 } }])).toBe(true);
    const [labels] = commentWrites({ id: thread.id, patch: { labelIds: ['ours'] } }, 2, thread);
    expect(commentWriteObserved({ ...labels!, commentSequence: 7 }, [{ ...thread, labelIds: ['ours', 'theirs'], activity: { ...thread.activity!, sequence: 7 } }])).toBe(true);
});

test('two projections cannot move a confirmed read backwards without explicit mark unread', () => {
    const newer = commentWrites({ id: thread.id, readSequence: 6 }, 1, thread);
    const stale = commentWrites({ id: thread.id, readSequence: 5 }, 2, thread);
    const merged = latestCommentWrites([...newer, ...stale], { [stale[0]!.key]: 2 });
    expect(merged[0]!.update).toMatchObject({ readSequence: 6 });
    const unread = commentWrites({ id: thread.id, patch: { activity: { ...thread.activity!, readSequence: 4, unread: true } } }, 3, thread);
    const readAgain = commentWrites({ id: thread.id, readSequence: 5 }, 4, thread);
    expect(latestCommentWrites([...newer, ...unread, ...readAgain])[0]!.update).toMatchObject({ readSequence: 5 });
});

test('newer successful fields supersede older completions without dropping unrelated changes', () => {
    const priority = commentWrites({ id: thread.id, patch: { priority: 'high' } }, 1, thread);
    const done = commentWrites({ id: thread.id, patch: { resolved: true } }, 2, thread);
    const reopened = commentWrites({ id: thread.id, patch: { resolved: false } }, 3, thread);
    const writes = latestCommentWrites([...priority, ...reopened, ...done]);
    expect(writes.reduce((comment, write) => applyCommentUpdate(comment, write.update), thread)).toMatchObject({ resolved: false, priority: 'high' });
    // Once a newer success is observed, a still-pending older transition cannot replay over it.
    expect(latestCommentWrites(done, { [reopened[0]!.key]: 3 })).toEqual([]);
    expect(commentWriteObserved(reopened[0]!, [thread])).toBe(false);
});

test('retention distinguishes manual unread and archive presence from server timestamps', () => {
    const [unread] = commentWrites({ id: thread.id, patch: { activity: { ...thread.activity!, readSequence: 4, unread: true } } }, 1, thread);
    expect(commentWriteObserved(unread!, [{ ...thread, activity: { ...thread.activity!, readSequence: 5, unread: false } }])).toBe(false);
    expect(commentWriteObserved(unread!, [{ ...thread, activity: { ...thread.activity!, readSequence: 4 } }])).toBe(true);
    const [archive] = commentWrites({ id: thread.id, patch: { archivedAt: 'client time', archiveStatusId: 'archive' } }, 2, thread);
    expect(commentWriteObserved(archive!, [{ ...thread, archivedAt: 'server time', archiveStatusId: 'archive' }])).toBe(true);
});

test('saved assignment and labels release to canonical names, avatars and catalog order', () => {
    const writes = commentWrites({ id: thread.id, patch: { assignees: [{ id: 'member', name: 'Old name' }],
        labels: [{ id: 'b', name: 'Old label' }, { id: 'a', name: 'Other' }] as ProjectCommentView['labels'], labelIds: ['b', 'a'] } }, 1, thread);
    const saved = { ...thread, assignees: [{ id: 'member', name: 'New name', avatarUrl: '/new' }],
        labels: [{ id: 'a', name: 'Other' }, { id: 'b', name: 'New label' }], labelIds: ['a', 'b'] } as ProjectCommentView;
    expect(writes.every(write => commentWriteObserved(write, [saved]))).toBe(true);
});

test('list and detail replay the same pending reply once without mistaking it for the saved receipt', () => {
    const sent: SentReply = { reply: { id: 'pending', text: 'A reply', author: { name: 'You', isMe: true }, pending: true,
        deleted: false, edited: false, canDelete: false, canFilterAuthor: false }, previousReplyIds: [] };
    const once = applyCommentUpdate(thread, { id: thread.id, ...sent });
    expect(applyCommentUpdate(once, { id: thread.id, ...sent }).replies).toHaveLength(1);
    expect(savedReply(once.replies, sent)).toBeUndefined();
    const saved = { ...sent.reply, id: 'saved', pending: undefined };
    expect(savedReply([saved], sent)).toBe(saved);
});
