import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { submission, recoverSubmission, commitNewSubmission, commitReplySubmission } from '../src/lib/comments/submissions';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { DbComment } from '../src/lib/db/schema';
import { createProjectComment, replyToProjectComment } from '../src/lib/review/comments';
import type { DbProject } from '../src/lib/app/model';
import { pngImage } from './support/images';

const position = { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } as const;
const key = () => randomUUID().replaceAll('-', '');

test('first-write response loss, concurrent replay and conflicting public create/reply keys', async ({ playwright, baseURL }) => {
    const visitor = randomBytes(32).toString('base64url');
    const client = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'X-Uier-Visitor': visitor } });
    const path = `/retry-${key()}`;
    const data = { path, position, text: 'Save exactly once', idempotencyKey: key(), screenshot: pngImage };
    try {
        const responses = await Promise.all(Array.from({ length: 4 }, () => client.post('/api/comments', { data })));
        for (const response of responses) expect(response.status()).toBe(201);
        const saved = await responses[0]!.json();
        for (const response of responses) expect((await response.json()).id).toBe(saved.id);
        expect((await (await client.get(`/api/comments?path=${path}`)).json())).toHaveLength(1);
        expect((await client.get(`/api/comments/${saved.id}/screenshot`)).status()).toBe(200);
        // Simulate losing Set-Cookie: the stable draft visitor header still identifies the first write.
        const reloaded = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'X-Uier-Visitor': visitor } });
        expect((await (await reloaded.post('/api/comments', { data: { ...data, screenshot: undefined, device: { windowSize: [360, 800] } } })).json()).id).toBe(saved.id);
        expect((await client.post('/api/comments', { data: { ...data, text: 'Conflicting text' } })).status()).toBe(409);
        expect((await client.post(`/api/comments/${saved.id}/replies`, { data: { text: data.text, idempotencyKey: data.idempotencyKey } })).status()).toBe(409);
        const reply = { text: 'One reply', idempotencyKey: key() };
        const replies = await Promise.all(Array.from({ length: 4 }, () => client.post(`/api/comments/${saved.id}/replies`, { data: reply })));
        for (const response of replies) {
            expect(response.status()).toBe(201);
            expect((await response.json()).thread.items).toHaveLength(2);
        }
        expect((await client.post(`/api/comments/${saved.id}/replies`, { data: { ...reply, text: 'Changed reply' } })).status()).toBe(409);
        const other = await playwright.request.newContext({ baseURL });
        expect((await other.post('/api/comments', { data })).status()).toBe(201);
        await client.delete(`/api/comments/${saved.id}`);
        expect((await reloaded.post('/api/comments', { data })).status()).toBe(404);
        await other.dispose();
        await reloaded.dispose();
    } finally { await client.dispose(); }
});

test('atomic receipts recover a lost database acknowledgement and preserve concurrent replies', async () => {
    const store = getMemoryCommentsStore();
    const domain = `receipts-${key()}.localhost`;
    const comment: DbComment = { id: `comment_${key()}`, domain, path: '/', position, thread: { items: [{ id: 'first', text: 'First' }] } };
    const attempt = submission(domain, 'owner', key(), { operation: 'create', text: 'First' })!;
    let lost = true;
    const faulty = { ...store, commitSubmission: async (...args: Parameters<typeof store.commitSubmission>) => {
        const result = await store.commitSubmission(...args);
        if (lost) { lost = false; throw new Error('Write succeeded, response lost'); }
        return result;
    } };
    expect((await commitNewSubmission(faulty, attempt, comment)).id).toBe(comment.id);
    expect((await recoverSubmission(store, attempt))!.id).toBe(comment.id);
    expect(await store.listAll(domain, 10)).toHaveLength(1);
    expect(await store.get(domain, attempt.id)).toBeNull();
    const first = submission(domain, 'owner', key(), { operation: 'reply', text: 'Reply A' })!;
    const second = submission(domain, 'owner', key(), { operation: 'reply', text: 'Reply B' })!;
    await Promise.all([
        commitReplySubmission(store, first, comment.id, { id: 'reply_a', text: 'Reply A' }),
        commitReplySubmission(store, first, comment.id, { id: 'ignored_duplicate', text: 'Reply A' }),
        commitReplySubmission(store, second, comment.id, { id: 'reply_b', text: 'Reply B' })
    ]);
    expect((await store.get(domain, comment.id))!.comment.thread.items.map(item => item.text).sort()).toEqual(['First', 'Reply A', 'Reply B']);
    const pending = submission(domain, 'owner', key(), { operation: 'reply', text: 'Recover later' })!;
    const failed = { ...store, commitSubmission: async () => { throw new Error('Unavailable before commit'); } };
    await expect(commitReplySubmission(failed, pending, comment.id, { id: 'retry', text: 'Recover later' })).rejects.toThrow('Unavailable');
    expect(await store.getSubmission(domain, pending.id)).toBeNull();
    await commitReplySubmission(store, pending, comment.id, { id: 'retry', text: 'Recover later' });
    expect((await store.get(domain, comment.id))!.comment.thread.items).toHaveLength(4);
});

test('project receipts isolate actor/project and still enforce private visibility on replay', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = { id: `retry-${key()}`, urls: ['https://example.test'] } as DbProject;
        const owner = { kind: 'guest', visitorId: 'owner' } as const;
        const stranger = { kind: 'guest', visitorId: 'other' } as const;
        const request = new Request('http://localhost/api/review');
        const input = { path: '/view?tab=a', pageStateVersion: 1 as const, origin: 'https://example.test', position, kind: 'comment' as const, text: 'Project draft', authorName: 'Reviewer', idempotencyKey: key() };
        const first = await createProjectComment(request, project, owner, input);
        expect((await createProjectComment(request, project, owner, input)).id).toBe(first.id);
        expect((await createProjectComment(request, project, stranger, input)).id).not.toBe(first.id);
        expect((await createProjectComment(request, { ...project, id: `${project.id}-other` }, owner, input)).id).not.toBe(first.id);
        await expect(createProjectComment(request, project, owner, { ...input, path: '/view?tab=b' })).rejects.toMatchObject({ status: 409 });
        const reply = { text: 'Reply once', authorName: 'Reviewer', idempotencyKey: key() };
        await replyToProjectComment(request, project, owner, first.id, reply);
        expect((await replyToProjectComment(request, project, owner, first.id, reply)).thread.items).toHaveLength(2);
        await expect(replyToProjectComment(request, project, owner, first.id, { ...reply, text: 'Conflict' })).rejects.toMatchObject({ status: 409 });
        // Admin makes a stranger's thread private after they replied: replay cannot expose it.
        const others = await createProjectComment(request, project, stranger, { ...input, idempotencyKey: key() });
        const hiddenReply = { ...reply, idempotencyKey: key() };
        await replyToProjectComment(request, project, owner, others.id, hiddenReply);
        const store = getMemoryCommentsStore();
        const stored = (await store.get(others.domain, others.id))!;
        await store.replace({ ...stored.comment, private: true }, stored.etag);
        await expect(replyToProjectComment(request, project, owner, others.id, hiddenReply)).rejects.toMatchObject({ status: 404 });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});
