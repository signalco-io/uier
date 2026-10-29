import { persistProjectAccess } from './support/projectAccess';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pngImage } from './support/images';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { editProjectCommentItem } from '../src/lib/review/comments';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { toCommentDto } from '../src/lib/comments/dto';
import { toReproductionContext } from '../src/lib/comments/reproduction';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';

const previousRuntime = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousRuntime === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousRuntime; });

const origin = 'https://reviewed.example';
const device = { browser: 'Example Browser (123)', os: 'Example OS', pixelRatio: 2, windowSize: [1280, 720] as [number, number], capturedAt: '2026-10-25T09:00:00.000Z' };

test('public editing enforces ownership, text validation, stale edits and original evidence', async ({ request, playwright, baseURL }) => {
    const path = `/edit-${randomUUID()}`;
    const created = await request.post('/api/comments', { data: {
        path, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 },
        text: 'Original comment', screenshot: pngImage, device
    } });
    expect(created.status()).toBe(201);
    const comment = await created.json();
    const first = comment.thread.items[0];
    const itemUrl = `/api/comments/${comment.id}/replies/${first.id}`;
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        expect((await stranger.patch(itemUrl, { data: { text: 'Forbidden', expectedText: first.text } })).status()).toBe(403);
        for (const data of [{ text: '', expectedText: first.text }, { text: 'x'.repeat(1001), expectedText: first.text }, { text: 'Missing expected text' }])
            expect((await request.patch(itemUrl, { data })).status()).toBe(400);
        const replyResponse = await request.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Original reply' } });
        const reply = (await replyResponse.json()).thread.items[1];
        const edited = await request.patch(itemUrl, { data: { text: 'Corrected comment', expectedText: first.text } });
        expect(edited.status()).toBe(200);
        const saved = await edited.json();
        expect(saved.thread.items[0]).toMatchObject({ ...first, text: 'Corrected comment', editedAt: expect.any(String) });
        expect(saved.thread.items[1]).toEqual(reply);
        expect(saved.position).toEqual(comment.position);
        expect(saved.screenshot).toEqual(comment.screenshot);
        expect(saved.device).toEqual(comment.device);
        expect(saved.createdAt).toBe(comment.createdAt);
        expect((await request.get(`/api/comments/${comment.id}/screenshot`)).status()).toBe(200);
        expect((await request.patch(itemUrl, { data: { text: 'Stale overwrite', expectedText: first.text } })).status()).toBe(409);
        const replyUrl = `/api/comments/${comment.id}/replies/${reply.id}`;
        expect((await stranger.patch(replyUrl, { data: { text: 'Forbidden', expectedText: reply.text } })).status()).toBe(403);
        const changedReply = await request.patch(replyUrl, { data: { text: 'Corrected reply', expectedText: reply.text } });
        expect((await changedReply.json()).thread.items[1]).toMatchObject({ text: 'Corrected reply', editedAt: expect.any(String) });
        await stranger.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Another reviewer' } });
        expect((await request.delete(`/api/comments/${comment.id}`)).status()).toBe(200);
        expect((await request.patch(itemUrl, { data: { text: 'Restore deleted', expectedText: 'Corrected comment' } })).status()).toBe(404);
    } finally { await stranger.dispose(); }
});

test('project edits enforce guest/member/admin rights and retain concurrent replies and context', async () => {
    const previousLocal = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = { id: `edit-${randomUUID()}`, urls: [origin] } as DbProject;
        await persistProjectAccess(project);
        const store = getMemoryCommentsStore();
        const comment: DbComment = {
            id: 'comment_edit', domain: `project:${project.id}`, origin, path: '/pricing', authorId: 'guest-owner', device,
            position: { type: 'page' }, screenshot: { width: 3, height: 2, bytes: 100, contentType: 'image/png' },
            thread: { items: [{ id: 'first', text: 'First', authorId: 'guest-owner' }, { id: 'reply', text: 'Reply', authorId: 'user:member' }] }
        };
        await store.create(comment);
        const owner = { kind: 'guest', visitorId: 'guest-owner' } as const;
        const outsider = { kind: 'guest', visitorId: 'outsider' } as const;
        const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;
        const admin = { ...member, userId: 'admin', isAdmin: true };
        for (const actor of [outsider, member])
            await expect(editProjectCommentItem(project, actor, comment.id, 'first', { text: 'No', expectedText: 'First' })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(editProjectCommentItem(project, owner, comment.id, 'reply', { text: 'No', expectedText: 'Reply' })).rejects.toMatchObject({ code: 'forbidden' });
        await editProjectCommentItem(project, member, comment.id, 'reply', { text: 'Member edit', expectedText: 'Reply' });
        const attempts = await Promise.allSettled(['Edit A', 'Edit B'].map(text => editProjectCommentItem(project, owner, comment.id, 'first', { text, expectedText: 'First' })));
        expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
        const current = (await store.get(comment.domain, comment.id))!.comment;
        const saved = await editProjectCommentItem(project, admin, comment.id, 'first', { text: 'Admin correction', expectedText: current.thread.items[0]!.text });
        expect(saved.thread.items[1]!.text).toBe('Member edit');
        expect(saved.device).toEqual(device);
        expect(saved.screenshot).toEqual(comment.screenshot);
        expect(saved.authorId).toBe(comment.authorId);
        expect(toReviewCommentDto(saved, owner, new Map(), [origin])?.permissions.edit).toBe(true);
        expect(toReviewCommentDto(saved, outsider, new Map(), [origin])?.permissions.edit).toBe(false);
        expect(toReviewCommentDto(saved, admin, new Map(), [origin])?.thread.items[1]).toMatchObject({ canEdit: true });
        const stored = (await store.get(comment.domain, comment.id))!;
        await store.replace({ ...stored.comment, private: true }, stored.etag);
        await expect(editProjectCommentItem(project, outsider, comment.id, 'first', { text: 'No', expectedText: 'Admin correction' })).rejects.toMatchObject({ code: 'not_found' });
    } finally {
        if (previousLocal === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previousLocal;
    }
});

test('reproduction details are member-only, explicit, partial-data safe and contain no query tokens', () => {
    const comment: DbComment = { id: 'comment_context', domain: 'project:test', origin, path: '/pricing?token=secret&toolbar-code=test#private', device,
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Feedback', authorId: 'guest' }] } };
    const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;
    const dto = toReviewCommentDto(comment, member, new Map(), [origin]);
    expect(dto?.reproduction).toMatchObject({ ...device, url: `${origin}/pricing` });
    expect(dto?.reproduction?.text).toContain('Viewport: 1280×720 CSS px');
    expect(JSON.stringify(dto?.reproduction)).not.toMatch(/secret|toolbar-code|private/);
    for (const actor of [{ kind: 'guest', visitorId: 'guest' } as const, { kind: 'anonymous' } as const]) {
        const limited = toReviewCommentDto(comment, actor, new Map(), [origin]);
        expect(limited?.reproduction).toBeUndefined();
        expect(limited?.device).toEqual({ windowSize: [1280, 720] });
        expect(JSON.stringify(limited)).not.toMatch(/Example Browser|Example OS|capturedAt|pixelRatio/);
    }
    expect(JSON.stringify(toCommentDto(comment, 'guest'))).not.toMatch(/Example Browser|Example OS|capturedAt|pixelRatio|reproduction/);
    expect(toReproductionContext({ ...comment, device: undefined, origin: 'https://elsewhere.example' }, [origin]).text)
        .toContain('Browser: Unknown\nOperating system: Unknown\nViewport: Unavailable');
    for (const path of ['//elsewhere.example', '/\\elsewhere.example'])
        expect(toReproductionContext({ ...comment, path }, [origin]).url).toBeUndefined();
});
