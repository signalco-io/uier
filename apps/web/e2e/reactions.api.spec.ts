import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { MAX_MESSAGE_REACTIONS, messageReactions, reactionPeople, withOwnReaction, type MessageReaction } from '@uier/toolbar/reactions';
import { allowedExtensionOperation } from '@uier/toolbar/extension-contract';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { setProjectCommentReaction, reactToReviewComment } from '../src/lib/review/reactions';
import { setProjectCommentPrivate } from '../src/lib/review/comments';
import { commentRevision } from '../src/lib/review/commentRevision';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { authorNames } from '../src/lib/comments/authorNames';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { reactionInputSchema } from '../src/lib/comments/reactions';
import { RATE_LIMIT_VISITOR_REACTIONS } from '../src/lib/comments/limits';
import { authorReactionsLimit } from '../src/lib/comments/rateLimits';
import { loadProjectComment } from '../src/lib/app/projectComments';
import type { AppContext } from '../src/lib/app/context';
import type { ReviewApiContext } from '../src/lib/review/http';
import { persistProjectAccess } from './support/projectAccess';

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (originalLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = originalLocal; });

const author = { kind: 'member', userId: 'u_react_author', name: 'Ana Author', isAdmin: false } as const;
const member = { ...author, userId: 'u_react_member', name: 'Ben Member' };
const admin = { ...author, userId: 'u_react_admin', name: 'Cleo Admin', isAdmin: true };
const guest = { kind: 'guest', visitorId: 'visitor-react-guest' } as const;
const request = () => new Request('https://uier.io/api/review/fixture/comments/fixture/reactions', { method: 'POST' });

async function fixture(projectExtra: Partial<DbProject> = {}, extra: Partial<DbComment> = {}) {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests', ...projectExtra } as DbProject, [author, member, admin]);
    const comment: DbComment = {
        id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, path: '/', origin: project.urls[0],
        position: { type: 'page' }, authorId: `user:${author.userId}`, number: 1, resolved: false,
        thread: { items: [
            { id: 'item_first', text: 'The button is hard to find', authorId: `user:${author.userId}`, createdAt: '2026-11-01T10:00:00.000Z' },
            { id: 'item_reply', text: 'Agreed', authorId: guest.visitorId, authorName: 'Gita Guest', createdAt: '2026-11-01T11:00:00.000Z' }
        ] },
        activity: { sequence: 2, byActor: { [`user:${author.userId}`]: 1, [guest.visitorId]: 2 } },
        createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z', ...extra
    };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    const read = async () => (await store.get(comment.domain, comment.id))!.comment;
    const react = (actor: Parameters<typeof setProjectCommentReaction>[2], input: Partial<{ itemId: string; emoji: MessageReaction['emoji']; reacted: boolean; authorName: string }> = {}) =>
        setProjectCommentReaction(request(), project, actor, comment.id, { itemId: 'item_first', emoji: 'thumbs-up', reacted: true, ...input });
    return { project, comment, store, read, react };
}

/** A DTO item's reactions (a deleted item has none) */
function reactionsOf(item: { reactions?: MessageReaction[] } | { deleted: true } | undefined) {
    return item && 'reactions' in item ? item.reactions : undefined;
}

async function viewAs(comment: DbComment, actor: Parameters<typeof toReviewCommentDto>[1], project: DbProject) {
    return toReviewCommentDto(comment, actor, await authorNames([comment]), [], 0, undefined, project)!;
}

test('members and guests add and remove their own reactions on the first message and on replies, idempotently', async () => {
    const f = await fixture();
    await f.react(member);
    await f.react(guest, { authorName: 'Gita Guest' });
    await f.react(member, { itemId: 'item_reply', emoji: 'heart' });
    // Repeating a request changes nothing
    await f.react(member);
    let saved = await f.read();
    expect(saved.thread.items[0]!.reactions).toEqual([{ emoji: 'thumbs-up', by: [{ id: `user:${member.userId}` }, { id: guest.visitorId, name: 'Gita Guest' }] }]);
    expect(saved.thread.items[1]!.reactions).toEqual([{ emoji: 'heart', by: [{ id: `user:${member.userId}` }] }]);

    await f.react(member, { reacted: false });
    await f.react(member, { reacted: false });
    await f.react(member, { itemId: 'item_reply', emoji: 'heart', reacted: false });
    saved = await f.read();
    expect(saved.thread.items[0]!.reactions).toEqual([{ emoji: 'thumbs-up', by: [{ id: guest.visitorId, name: 'Gita Guest' }] }]);
    // The last reaction removed leaves no empty list behind
    expect(saved.thread.items[1]).not.toHaveProperty('reactions');
});

test('a member never stores a guest name, and a guest without one reads as a guest code', async () => {
    const f = await fixture();
    await f.react(member, { authorName: 'Pretend Name' });
    await f.react(guest, { emoji: 'eyes' });
    const saved = await f.read();
    expect(saved.thread.items[0]!.reactions).toEqual([
        { emoji: 'thumbs-up', by: [{ id: `user:${member.userId}` }] },
        { emoji: 'eyes', by: [{ id: guest.visitorId }] }
    ]);
    const dto = await viewAs(saved, admin, f.project);
    const eyes = reactionsOf(dto.thread.items[0])!.find(reaction => reaction.emoji === 'eyes')!;
    expect(eyes.names).toEqual([expect.stringMatching(/^Guest [0-9A-F]{4}$/)]);
});

test('reactions add no activity, history, notification, sync work, content revision or updatedAt', async () => {
    const f = await fixture();
    const before = await f.read();
    await f.react(member);
    await f.react(guest, { itemId: 'item_reply', emoji: 'rocket', authorName: 'Gita Guest' });
    const after = await f.read();
    expect(after.activity).toEqual(before.activity);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.history).toBeUndefined();
    expect(after.notificationEvents).toBeUndefined();
    expect(after.notificationPending).toBeUndefined();
    expect(after.syncPending).toBeUndefined();
    expect(commentRevision(after)).toBe(commentRevision(before));
});

test('the views give counts, the viewer\'s own and the others\' names, never ids', async () => {
    const f = await fixture();
    await f.react(member);
    await f.react(admin);
    await f.react(guest, { authorName: 'Gita Guest' });
    const saved = await f.read();

    const asMember = await viewAs(saved, member, f.project);
    expect(reactionsOf(asMember.thread.items[0])).toEqual([{ emoji: 'thumbs-up', count: 3, mine: true, names: ['Cleo Admin', 'Gita Guest'] }]);
    const asGuest = await viewAs(saved, guest, f.project);
    expect(reactionsOf(asGuest.thread.items[0])).toEqual([{ emoji: 'thumbs-up', count: 3, mine: true, names: ['Ben Member', 'Cleo Admin'] }]);
    const json = JSON.stringify(asGuest);
    for (const id of [member.userId, admin.userId, guest.visitorId]) expect(json).not.toContain(id);

    // The app's open thread: the first message's id and reactions, the reply's, and who may react
    const context = { user: { id: member.userId, name: member.name }, isAdmin: false, workspace: { id: f.project.workspaceId } } as unknown as AppContext;
    const view = (await loadProjectComment(context, f.project, f.comment.id))!;
    expect(view.messageId).toBe('item_first');
    expect(view.reactions).toEqual([{ emoji: 'thumbs-up', count: 3, mine: true, names: ['Cleo Admin', 'Gita Guest'] }]);
    expect(view.replies[0]!.reactions).toBeUndefined();
    expect(view.permissions.react).toBe(true);
});

test('who may react is who may reply: comments on, the thread visible, a live message', async () => {
    const disabled = await fixture({ access: 'disabled' });
    for (const actor of [member, guest]) await expect(disabled.react(actor)).rejects.toMatchObject({ code: 'comments_disabled' });

    const invited = await fixture({ access: 'invited' });
    await expect(invited.react(guest)).rejects.toMatchObject({ code: 'sign_in_required' });
    await invited.react(member);

    const f = await fixture();
    await expect(f.react({ kind: 'anonymous' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.react(member, { itemId: 'item_missing' })).rejects.toMatchObject({ code: 'not_found' });
    await setProjectCommentPrivate(f.project, admin, f.comment.id, true);
    await expect(f.react(guest)).rejects.toMatchObject({ code: 'not_found' });
    await expect(f.react(member)).rejects.toMatchObject({ code: 'not_found' });
    await f.react(author);

    const deleted = await fixture({}, { thread: { items: [{ id: 'item_first', text: '', deletedAt: '2026-11-02T00:00:00.000Z' }, { id: 'item_reply', text: 'Still here', authorId: guest.visitorId }] } });
    await expect(deleted.react(member)).rejects.toMatchObject({ code: 'not_found' });
    await deleted.react(member, { itemId: 'item_reply' });
});

test('a message holds a bounded number of reactions', async () => {
    const people = Array.from({ length: MAX_MESSAGE_REACTIONS }, (_, index) => ({ id: `visitor-${index}` }));
    const f = await fixture({}, { thread: { items: [{ id: 'item_first', text: 'Busy', authorId: guest.visitorId,
        reactions: [{ emoji: 'thumbs-up', by: people.slice(0, 60) }, { emoji: 'heart', by: people.slice(60) }] }] } });
    await expect(f.react(member, { emoji: 'eyes' })).rejects.toMatchObject({ code: 'invalid_request' });
    // Removing one makes room again
    await setProjectCommentReaction(request(), f.project, { kind: 'guest', visitorId: 'visitor-0' }, f.comment.id, { itemId: 'item_first', emoji: 'thumbs-up', reacted: false });
    await f.react(member, { emoji: 'eyes' });
});

test('the review route validates its body and answers with the thread', async () => {
    const f = await fixture();
    const context = (body: unknown): ReviewApiContext => ({
        project: f.project, actor: guest,
        request: new Request('https://uier.io/api/review/code/comments/id/reactions', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
    });
    const response = await reactToReviewComment(context({ itemId: 'item_reply', emoji: 'hooray', reacted: true, authorName: 'Gita Guest' }), { id: f.comment.id });
    expect(response.status).toBe(200);
    const body = await response.json() as { thread: { items: { reactions?: MessageReaction[] }[] } };
    expect(body.thread.items[1]!.reactions).toEqual([{ emoji: 'hooray', count: 1, mine: true, names: [] }]);
    for (const invalid of [{ itemId: 'item_reply', emoji: 'party', reacted: true }, { itemId: 'item_reply', emoji: 'hooray' }, { itemId: 'item reply', emoji: 'hooray', reacted: true }, { itemId: 'item_reply', emoji: 'hooray', reacted: true, extra: 1 }])
        await expect(reactToReviewComment(context(invalid), { id: f.comment.id })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(reactToReviewComment(context({ itemId: 'item_reply', emoji: 'hooray', reacted: true }), { id: 'not a comment' })).rejects.toMatchObject({ code: 'not_found' });
    expect(reactionInputSchema.safeParse({ itemId: 'item_reply', emoji: 'hooray', reacted: true, authorName: 'x' }).success).toBe(false);
    expect(allowedExtensionOperation(`comments/${f.comment.id}/reactions`, 'POST')).toBe(true);
});

test('copied issues and MCP packets list reaction counts, never who reacted', async () => {
    const f = await fixture();
    await f.react(member);
    await f.react(guest, { authorName: 'Gita Guest' });
    await f.react(member, { itemId: 'item_reply', emoji: 'eyes' });
    const exported = await projectFeedbackExport(f.project, member, f.comment.id, undefined, 'https://uier.io');
    expect(exported.context.feedback?.reactions).toEqual([{ emoji: 'thumbs-up', count: 2 }]);
    expect(exported.context.discussion[0]!.reactions).toEqual([{ emoji: 'eyes', count: 1 }]);
    expect(exported.markdown).toContain('Reactions: 👍 Thumbs up (2)');
    expect(exported.markdown).toContain('Reactions: 👀 Eyes (1)');
    expect(JSON.stringify(exported.context.feedback)).not.toContain('Gita Guest');
});

test('the shared helpers keep the quick set\'s order and toggle the viewer\'s own reaction', () => {
    const reactions = messageReactions([{ emoji: 'heart', count: 1, mine: false, names: ['Ana'] }, { emoji: 'unknown', count: 3 }, { emoji: 'thumbs-up', count: 2, mine: true, names: ['Ben'] }]);
    expect(reactions.map(reaction => reaction.emoji)).toEqual(['thumbs-up', 'heart']);
    expect(withOwnReaction(reactions, 'thumbs-up', false)).toEqual([{ emoji: 'thumbs-up', count: 1, mine: false, names: ['Ben'] }, reactions[1]]);
    expect(withOwnReaction(reactions, 'heart', true)[1]).toEqual({ emoji: 'heart', count: 2, mine: true, names: ['Ana'] });
    expect(withOwnReaction(reactions, 'eyes', true).map(reaction => reaction.emoji)).toEqual(['thumbs-up', 'heart', 'eyes']);
    expect(withOwnReaction([{ emoji: 'eyes', count: 1, mine: true, names: [] }], 'eyes', false)).toEqual([]);
    expect(reactionPeople({ emoji: 'eyes', count: 14, mine: true, names: ['Ana', 'Ben'] }, 'You', count => `${count} others`)).toEqual(['You', 'Ana', 'Ben', '11 others']);
});

test('reaction limits count per reviewer, apart from replies', async () => {
    const limit = authorReactionsLimit('visitor-a');
    expect(limit).toMatchObject({ key: 'visitor-reactions:visitor-a', limit: RATE_LIMIT_VISITOR_REACTIONS, reason: 'too_fast' });
    expect(authorReactionsLimit('user:a', true).key).toBe('member-reactions:user:a');
});

// The public comments API (uier's own pages): anyone who can reply reacts as their visitor
test('the public comments API adds and removes a visitor\'s reaction', async ({ request }) => {
    const created = await request.post('/api/comments', { data: { path: `/reactions-${randomUUID()}`, position: { type: 'page' }, kind: 'feedback', text: 'React to this' } });
    expect(created.status()).toBe(201);
    const thread = await created.json();
    const itemId = thread.thread.items[0].id;
    const added = await request.post(`/api/comments/${thread.id}/reactions`, { data: { itemId, emoji: 'rocket', reacted: true } });
    expect(added.status(), await added.text()).toBe(200);
    expect((await added.json()).thread.items[0].reactions).toEqual([{ emoji: 'rocket', count: 1, mine: true, names: [] }]);

    expect((await request.post(`/api/comments/${thread.id}/reactions`, { data: { itemId, emoji: 'rocket', reacted: true, authorName: 'x' } })).status()).toBe(400);
    const removed = await request.post(`/api/comments/${thread.id}/reactions`, { data: { itemId, emoji: 'rocket', reacted: false } });
    expect((await removed.json()).thread.items[0].reactions).toBeUndefined();
    expect((await request.post(`/api/comments/${thread.id}/reactions`, { data: { itemId: `item_${randomBytes(6).toString('hex')}`, emoji: 'rocket', reacted: true } })).status()).toBe(404);
    await request.delete(`/api/comments/${thread.id}`);
});
