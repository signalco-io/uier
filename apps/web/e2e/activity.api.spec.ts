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
import { listReviewComments, readReviewComment, readReviewComments } from '../src/lib/review/readRoutes';
import { markThreadsRead } from '../src/lib/comments/bulkRead';
import { POST as publicBulkRead } from '../app/api/comments/read/route';

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

test('bulk read validates before writes, bounds concurrency and preserves failed/conflicting cursors', async () => {
    process.env.UIER_LOCAL = '1';
    const domain = `bulk-${randomUUID()}`;
    const store = getMemoryCommentsStore();
    const threads = Array.from({ length: 205 }, (_, index) => ({ id: `comment_${index}`, sequence: 1 }));
    for (const { id } of threads) await store.create({ id, domain, path: '/', authorId: 'other', position: { type: 'page' },
        thread: { items: [{ id: 'first', text: 'No content in receipts', authorId: 'other' }] } });
    let loading = 0, maximum = 0;
    const load = async (id: string) => {
        maximum = Math.max(maximum, ++loading);
        await new Promise(resolve => setTimeout(resolve, 1));
        loading--;
        return (await store.get(domain, id))?.comment ?? null;
    };
    for (const invalid of [threads, [threads[0], threads[0]], [{ id: '../bad', sequence: 1 }],
        [threads[0], { id: 'comment_1', sequence: -1 }], [{ id: 'comment_0', sequence: 1.1 }],
        [{ id: 'comment_0', sequence: Number.MAX_SAFE_INTEGER + 1 }]]) {
        await expect(markThreadsRead({ threads: invalid }, 'reader', load)).rejects.toMatchObject({ code: 'invalid_request' });
        expect(await getReadSequence(domain, 'reader', 'comment_0')).toBe(0);
    }
    await expect(markThreadsRead({ threads: threads.slice(0, 1) }, undefined, load)).rejects.toMatchObject({ code: 'forbidden' });
    const app = getAppStore();
    await markThreadRead((await store.get(domain, 'comment_2'))!.comment, 'reader', 0);
    const receipt = (await app.query({ type: 'review-read' })).find(doc => doc.id === 'comment_2' && 'domain' in doc && doc.domain === domain)!;
    // Advance the memory etag between every get/replace to exercise all eight real cursor retries.
    const memory = (globalThis as typeof globalThis & { __uierAppMemoryStore: { partitions: Map<string, Map<string, { version: number }>> } }).__uierAppMemoryStore;
    const entry = memory.partitions.get(receipt.pk)!.get(receipt.id)!;
    let version = entry.version;
    Object.defineProperty(entry, 'version', { configurable: true, get: () => ++version });
    try {
        const result = await markThreadsRead({ threads: threads.slice(0, 200) }, 'reader', load);
        expect(result.reads).toHaveLength(199);
        expect(result.reads.some(read => read.id === 'comment_2')).toBe(false);
        expect(await getReadSequence(domain, 'reader', 'comment_2')).toBe(0);
        expect(maximum).toBeLessThanOrEqual(4);
        expect(JSON.stringify(result)).not.toMatch(/authorId|No content/);
    } finally { Object.defineProperty(entry, 'version', { configurable: true, writable: true, value: version }); }
    expect((await markThreadsRead({ threads: [threads[2]!, ...threads.slice(200)] }, 'reader', load)).reads).toHaveLength(6);
    expect((await projectActivity(domain, 'reader')).summary.unread).toBe(0);
});

test('bulk review API rechecks members, guests, private threads and long bodies without exposing skipped ids', async () => {
    process.env.UIER_LOCAL = '1';
    const app = getAppStore();
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const workspaceId = randomUUID();
    const pk = `workspace:${workspaceId}` as const;
    const project: DbProject = { type: 'project', id, pk, workspaceId, name: 'Bulk', urls: ['https://reviewed.example'],
        access: 'guests', status: 'active', createdBy: 'alice', createdAt: now, updatedAt: now };
    await app.create(project);
    await app.create<DbProjectRef>({ type: 'project-ref', id, pk: `project:${id}`, workspaceId });
    await app.create<DbUser>({ type: 'user', id: 'bulk-reader', pk: 'user:bulk-reader', name: 'Reader', email: 'bulk-reader@example.com', createdAt: now, updatedAt: now });
    await app.create<DbMember>({ type: 'member', id: 'member_bulk-reader', pk, workspaceId, userId: 'bulk-reader', email: 'bulk-reader@example.com', role: 'commenter', projects: 'all', createdAt: now });
    const domain = `project:${id}`;
    const threads = Array.from({ length: 200 }, (_, index) => ({ id: `comment_${index}`.padEnd(128, 'a'), sequence: 1 }));
    const store = getMemoryCommentsStore();
    for (const thread of threads) await store.create({ id: thread.id, domain, path: '/', authorId: 'user:other',
        private: thread === threads[1], position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Hidden text', authorId: 'user:other' }] } });
    await store.appendThreadItem(domain, threads[0]!.id, { id: 'racing_reply', text: 'Racing reply', authorId: 'user:other' }, 50, now);
    const handler = reviewApiHandler(readReviewComments, { verifyWrites: false });
    const token = signToken('review', { uid: 'bulk-reader', pid: id }, 3600);
    const headers = { Authorization: `Bearer ${token}`, Origin: 'https://reviewed.example', 'Content-Type': 'application/json' };
    const call = (body: unknown, extra = {}) => handler(new Request(`https://uier.io/api/review/${id}/comments/read`, {
        method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body)
    }), { params: Promise.resolve({ projectId: id }) });
    expect((await call({ threads: [...threads, threads[0]] })).status).toBe(400);
    expect(await getReadSequence(domain, 'user:bulk-reader', threads[0]!.id)).toBe(0);
    expect((await call({ threads }, { Authorization: '' })).status).toBe(400);
    const response = await call({ threads });
    expect(response.status).toBe(200);
    const result = await response.json() as Awaited<ReturnType<typeof markThreadsRead>>;
    expect(result.reads).toHaveLength(199);
    expect(result.reads.find(read => read.id === threads[0]!.id)!.activity).toMatchObject({ sequence: 2, readSequence: 1, unread: true });
    expect(JSON.stringify(result)).not.toContain(threads[1]!.id);
    expect(await getReadSequence(domain, 'user:bulk-reader', threads[1]!.id)).toBe(0);
    const guest = await call({ threads: threads.slice(0, 2) }, { Authorization: '', 'X-Uier-Visitor': 'a'.repeat(43) });
    expect(guest.status).toBe(200);
    expect((await guest.json() as Awaited<ReturnType<typeof markThreadsRead>>).reads).toHaveLength(1);
    await app.delete(pk, 'member_bulk-reader');
    expect((await call({ threads })).status).toBe(400); // guest-readable project, but no reviewer identity
    await app.replace({ ...project, access: 'invited' }, (await app.get<DbProject>(pk, id))!.etag);
    expect((await call({ threads })).status).toBe(401);
    expect((await call({ threads }, { Origin: 'https://foreign.example' })).status).toBe(403);
});

test('public bulk route shares visitor cursors, skips missing threads and leaves a raced reply unread', async ({ request, playwright, baseURL }) => {
    const path = `/bulk-public-${randomUUID()}`;
    const comment = await (await request.post('/api/comments', { data: { path, kind: 'feedback', position: { type: 'page' }, text: 'Bulk public' } })).json();
    const reader = await playwright.request.newContext({ baseURL });
    try {
        const threads = [{ id: comment.id, sequence: 1 }, { id: 'comment_missing', sequence: 0 }];
        for (const invalid of [[...threads, threads[0]], [{ id: comment.id, sequence: -1 }], [{ id: '/bad', sequence: 1 }]])
            expect((await reader.post('/api/comments/read', { data: { threads: invalid } })).status()).toBe(400);
        await request.post(`/api/comments/${comment.id}/replies`, { data: { text: 'After rendered snapshot' } });
        const response = await reader.post('/api/comments/read', { data: { threads } });
        expect(response.status()).toBe(200);
        expect(response.headers()['set-cookie']).toContain('uier_visitor=');
        expect(await response.json()).toEqual({ reads: [{ id: comment.id, activity: expect.objectContaining({ readSequence: 1, sequence: 2, unread: true }) }] });
        const listed = await (await reader.get(`/api/comments?path=${path}`)).json();
        expect(listed[0].activity).toMatchObject({ readSequence: 1, unread: true });
        expect((await reader.post('/api/comments/read', { headers: { Origin: 'https://foreign.example' }, data: { threads } })).status()).toBe(403);
    } finally { await reader.dispose(); }
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
        // Toolbar writes now use #86's atomic retry receipts. Replaying a reply advances once.
        const idempotencyKey = randomUUID();
        const reply = () => second.post(`/api/comments/${comment.id}/replies`, { data: { text: 'My reply', idempotencyKey } });
        expect((await (await reply()).json()).activity).toMatchObject({ sequence: 2, unread: false, readSequence: 1 });
        expect((await (await reply()).json()).activity.sequence).toBe(2);
        await request.patch(`/api/comments/${comment.id}`, { data: { resolved: true } });
        const changed = await list();
        expect(changed).toMatchObject({ resolved: true, activity: { unread: true, sequence: 3, readSequence: 1 } });
        await second.post(readUrl, { data: { sequence: 3 } });
        const site = await (await second.get('/api/comments?scope=site')).json();
        expect(site.find((item: { id: string }) => item.id === comment.id)).toMatchObject({ resolved: true, activity: { unread: false, readSequence: 3 } });
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
    const request = () => new Request(`http://${domain}/api/comments/read`, { method: 'POST',
        headers: { host: domain, 'Content-Type': 'application/json' }, body: JSON.stringify({ threads: [{ id: comment.id, sequence: 1 }] }) });
    const hidden = await publicBulkRead(request(), { params: Promise.resolve({}) });
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ reads: [] });
    const previousBypass = process.env.UIER_BOTID_DEV_BYPASS;
    process.env.UIER_BOTID_DEV_BYPASS = 'BAD-BOT';
    try { expect((await publicBulkRead(request(), { params: Promise.resolve({}) })).status).toBe(403); }
    finally {
        if (previousBypass === undefined) delete process.env.UIER_BOTID_DEV_BYPASS;
        else process.env.UIER_BOTID_DEV_BYPASS = previousBypass;
    }
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
