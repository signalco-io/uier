import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject, DbProjectRef, DbMember, DbUser } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { signToken } from '../src/lib/app/tokens';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { listComments, replyToComment, getCommentScreenshot } from '../src/lib/comments/service';
import { readActivity, threadActivity } from '../src/lib/comments/activity';
import { getReadSequence, markThreadRead, projectActivity, unreadComments } from '../src/lib/comments/readState';
import { deleteProjectCommentItem, setProjectCommentResolved } from '../src/lib/review/comments';
import { reviewApiHandler } from '../src/lib/review/http';
import { listReviewComments, readReviewComment } from '../src/lib/review/readRoutes';

const alice = { kind: 'member', userId: 'alice', name: 'Alice', isAdmin: false } as const;
const bob = { ...alice, userId: 'bob', name: 'Bob' };
const now = new Date().toISOString();
const previousLocal = process.env.UIER_LOCAL;
test.afterEach(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

test('per-reviewer cursors survive own posts, resolution, concurrent/stale reads and deleted replies', async () => {
    process.env.UIER_LOCAL = '1';
    const project = { id: randomUUID(), access: 'invited' } as DbProject;
    const store = getMemoryCommentsStore();
    let comment: DbComment = {
        id: 'comment_activity', domain: `project:${project.id}`, path: '/one', position: { type: 'page' },
        authorId: 'user:alice', resolved: false,
        thread: { items: [{ id: 'first', text: 'Feedback', authorId: 'user:alice' }] }
    };
    await store.create(comment);
    expect(readActivity(comment, 'user:alice').unread).toBe(false);
    expect(readActivity(comment, 'user:bob').unread).toBe(true);
    await markThreadRead(comment, 'user:bob', 1);
    const append = async (authorId: string, id: string) => {
        expect(await store.appendThreadItem(comment.domain, comment.id, { id, text: id, authorId }, 50, now)).toBe('ok');
        comment = (await store.get(comment.domain, comment.id))!.comment;
    };
    await append('user:bob', 'reply_bob');
    await append('user:alice', 'reply_alice');
    // Own replies do not clear another person's unseen activity.
    expect(readActivity(comment, 'user:alice', 0)).toMatchObject({ sequence: 3, lastOtherSequence: 2, unread: true });
    expect(await markThreadRead(comment, 'user:alice', 1)).toMatchObject({ unread: true, readSequence: 1 });
    await append('user:bob', 'newer_reply');
    // A request sent from the sequence-3 view cannot mark sequence 4 read.
    expect(await markThreadRead(comment, 'user:alice', 3)).toMatchObject({ unread: true, readSequence: 3 });
    await Promise.all([4, 1, 3, 2].map(sequence => markThreadRead(comment, 'user:alice', sequence)));
    expect(await getReadSequence(comment.domain, 'user:alice', comment.id)).toBe(4);
    expect(await getReadSequence(comment.domain, 'user:bob', comment.id)).toBe(1);
    await expect(markThreadRead(comment, 'user:alice', 5)).rejects.toMatchObject({ code: 'invalid_request' });
    for (const cursor of [-1, 1.1, NaN])
        await expect(markThreadRead(comment, 'user:alice', cursor)).rejects.toMatchObject({ code: 'invalid_request' });
    comment = await setProjectCommentResolved(project, alice, comment.id, true);
    expect(readActivity(comment, 'user:bob', 1).unread).toBe(true);
    expect(await getReadSequence(comment.domain, 'user:alice', comment.id)).toBe(4);
    expect(readActivity(comment, 'user:alice', 4).unread).toBe(false);
    const sequence = threadActivity(comment).sequence;
    // Idempotent resolve is not new activity.
    expect(threadActivity(await setProjectCommentResolved(project, alice, comment.id, true)).sequence).toBe(sequence);
    comment = await setProjectCommentResolved(project, bob, comment.id, false);
    expect(readActivity(comment, 'user:alice', 4).unread).toBe(true);
    await markThreadRead(comment, 'user:alice', threadActivity(comment).sequence);
    // Physical deletion cannot reuse a previously acknowledged ordinal.
    const stored = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...comment, thread: { items: comment.thread.items.slice(0, 1) } }, stored.etag);
    await append('user:bob', 'after_deletion');
    expect(threadActivity(comment).sequence).toBe(sequence + 2);
    expect(readActivity(comment, 'user:alice', sequence + 1).unread).toBe(true);
});

test('read endpoints reauthorize identity, project, private visibility, origin and revoked membership', async () => {
    process.env.UIER_LOCAL = '1';
    const app = getAppStore();
    const workspaceId = randomUUID();
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const pk = `workspace:${workspaceId}` as const;
    const project: DbProject = { type: 'project', id, pk, workspaceId, name: 'Access', urls: ['https://reviewed.example'],
        access: 'invited', status: 'active', createdBy: 'alice', createdAt: now, updatedAt: now };
    await app.create(project);
    await app.create<DbProjectRef>({ type: 'project-ref', id, pk: `project:${id}`, workspaceId });
    await app.create<DbUser>({ type: 'user', id: 'alice', pk: 'user:alice', name: 'Alice', email: 'alice@example.com', createdAt: now, updatedAt: now });
    await app.create<DbMember>({ type: 'member', id: 'member_alice', pk, workspaceId, userId: 'alice', email: 'alice@example.com',
        role: 'commenter', projects: 'all', createdAt: now });
    const comment: DbComment = { id: 'comment_visible', domain: `project:${id}`, path: '/two', authorId: 'user:bob',
        position: { type: 'page' }, thread: { items: [{ id: 'item_first', text: 'Secret feedback', authorId: 'user:bob' }] } };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    const token = signToken('review', { uid: 'alice', pid: id }, 3600);
    const headers = { Authorization: `Bearer ${token}`, Origin: 'https://reviewed.example', 'Content-Type': 'application/json' };
    const handler = reviewApiHandler<{ projectId: string; id: string }>(readReviewComment, { verifyWrites: false });
    const call = (extra = {}, target = comment.id) => handler(new Request(`https://uier.io/api/review/${id}/comments/${target}/read`, {
        method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ sequence: 1, reviewerId: 'user:bob' })
    }), { params: Promise.resolve({ projectId: id, id: target }) });
    expect((await call()).status).toBe(200);
    expect(await getReadSequence(comment.domain, 'user:alice', comment.id)).toBe(1);
    expect(await getReadSequence(comment.domain, 'user:bob', comment.id)).toBe(0);
    expect((await call({ Origin: 'https://other.example' })).status).toBe(403);
    expect((await call({}, 'comment_foreign')).status).toBe(404);
    const stored = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...comment, private: true }, stored.etag);
    expect((await call()).status).toBe(404);
    const list = reviewApiHandler(listReviewComments, { verifyWrites: false });
    const listCall = () => list(new Request(`https://uier.io/api/review/${id}/comments?scope=site`, { headers }), { params: Promise.resolve({ projectId: id }) });
    expect(await (await listCall()).json()).toEqual([]);
    await app.delete(pk, 'member_alice');
    expect((await call()).status).toBe(401);
    expect((await listCall()).status).toBe(401);
    expect((await call({ Authorization: '' })).status).toBe(401);
});

test('public read receipts isolate guests, persist across page/site requests, and stay separate from done', async ({ request, playwright, baseURL }) => {
    const path = `/activity-${randomUUID()}`;
    const response = await request.post('/api/comments', { data: { path, kind: 'feedback', position: { type: 'page' }, text: 'Guest feedback' } });
    expect(response.status()).toBe(201);
    const comment = await response.json();
    expect(comment.activity).toMatchObject({ sequence: 1, unread: false, readSequence: 0 });
    const second = await playwright.request.newContext({ baseURL });
    try {
        const list = async () => (await (await second.get(`/api/comments?path=${path}`)).json()).find((item: { id: string }) => item.id === comment.id);
        expect((await list()).activity.unread).toBe(true);
        const readUrl = `/api/comments/${comment.id}/read`;
        const read = await second.post(readUrl, { data: { sequence: 1 } });
        expect(read.status()).toBe(200);
        expect(read.headers()['set-cookie']).toContain('uier_visitor=');
        expect((await list()).activity).toMatchObject({ unread: false, readSequence: 1 });
        expect((await list()).resolved).toBe(false);
        await request.patch(`/api/comments/${comment.id}`, { data: { resolved: true } });
        const changed = await list();
        expect(changed).toMatchObject({ resolved: true, activity: { unread: true, sequence: 2, readSequence: 1 } });
        await second.post(readUrl, { data: { sequence: 2 } });
        const site = await (await second.get('/api/comments?scope=site')).json();
        expect(site.find((item: { id: string }) => item.id === comment.id)).toMatchObject({ resolved: true, activity: { unread: false, readSequence: 2 } });
        expect((await second.post(readUrl, { data: { sequence: 999 } })).status()).toBe(400);
        expect((await second.post(readUrl, { headers: { Origin: 'https://other.example' }, data: { sequence: 2 } })).status()).toBe(403);
        expect((await second.post('/api/comments/comment_missing/read', { data: { sequence: 1 } })).status()).toBe(404);
        expect(JSON.stringify(changed.activity)).not.toContain('authorId');
    } finally { await second.dispose(); }
});


test('public showcase refresh never returns a private thread or permits a hidden reply/image read', async () => {
    process.env.UIER_LOCAL = '1';
    const domain = `private-${randomUUID()}`;
    const store = getMemoryCommentsStore();
    const comment: DbComment = { id: 'comment_private', domain, path: '/', private: true, authorId: 'owner',
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Private', authorId: 'owner' }] } };
    await store.create(comment);
    const context = { domain, request: new Request('http://localhost/api/comments'), visitor: { authorId: 'other' } };
    expect(await listComments(context, null)).toEqual([]);
    await expect(replyToComment(context, comment.id, { text: 'No access' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(getCommentScreenshot(context, comment.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await listComments({ ...context, visitor: { authorId: 'owner' } }, null)).toHaveLength(1);
});


test('activity counts and unread content include older threads outside the bounded newest list', async () => {
    process.env.UIER_LOCAL = '1';
    const domain = `all-activity-${randomUUID()}`;
    const store = getMemoryCommentsStore();
    for (let index = 0; index < 205; index++) {
        await store.create({ id: `comment_${index}`, domain, path: index === 0 ? '/older' : '/current',
            position: { type: 'page' }, createdAt: new Date(1_000_000 + index * 1000).toISOString(),
            authorId: index === 0 ? 'other' : 'me',
            thread: { items: [{ id: `item_${index}`, text: 'Private message text stays out of summaries', authorId: index === 0 ? 'other' : 'me' }] } });
    }
    expect((await store.listAll(domain, 200)).some(comment => comment.id === 'comment_0')).toBe(false);
    expect(JSON.stringify(await store.listActivity(domain))).not.toContain('Private message text');
    expect((await projectActivity(domain, 'me')).summary).toEqual({ unread: 1, open: 205, done: 0, total: 205 });
    const unread = await unreadComments(domain, 'me');
    expect(unread.map(comment => comment.id)).toEqual(['comment_0']);
    await markThreadRead(unread[0]!, 'me', 1);
    expect((await projectActivity(domain, 'me')).summary.unread).toBe(0);
    expect(await unreadComments(domain, 'me')).toEqual([]);
});


test('reading then deleting a legacy reply cannot cause its cursor to be reused', async () => {
    process.env.UIER_LOCAL = '1';
    const project = { id: randomUUID(), access: 'invited' } as DbProject;
    const store = getMemoryCommentsStore();
    const comment: DbComment = { id: 'comment_legacy_delete', domain: `project:${project.id}`, path: '/', authorId: 'user:alice',
        position: { type: 'page' }, thread: { items: [
            { id: 'first', text: 'First', authorId: 'user:alice' }, { id: 'reply', text: 'Old reply', authorId: 'user:bob' }
        ] } };
    await store.create(comment);
    await markThreadRead(comment, 'user:alice', 2);
    await deleteProjectCommentItem(project, bob, comment.id, 'reply');
    const afterDelete = (await store.get(comment.domain, comment.id))!.comment;
    expect(threadActivity(afterDelete).sequence).toBe(2);
    await store.appendThreadItem(comment.domain, comment.id, { id: 'new_reply', text: 'New reply', authorId: 'user:bob' }, 50, now);
    expect(readActivity((await store.get(comment.domain, comment.id))!.comment, 'user:alice', 2)).toMatchObject({ sequence: 3, unread: true });
});
