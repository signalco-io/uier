import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DbComment, DbThreadItem } from '../src/lib/db/schema';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { commitReplySubmission, submission } from '../src/lib/comments/submissions';
import { screenshotDocument, screenshotInfo } from '../src/lib/comments/service';
import { screenshotSchema } from '../src/lib/comments/validation';
import { toCommentDto } from '../src/lib/comments/dto';
import { deleteProjectCommentItem, editProjectCommentItem, getProjectScreenshot, replyToProjectComment } from '../src/lib/review/comments';
import { persistProjectAccess } from './support/projectAccess';
import type { DbProject } from '../src/lib/app/model';
import { pngImage, jpegImage } from './support/images';
import { privateImages, expectPrivateImageRemoved } from './support/privateImages';
import { RATE_LIMIT_DOMAIN_SCREENSHOTS } from '../src/lib/comments/limits';
import { enforceScreenshotLimits } from '../src/lib/comments/rateLimits';

const beforeLocal = process.env.UIER_LOCAL;
const beforeSecret = process.env.UIER_COMMENTS_SECRET;
test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET = 'reply-image-local-test-secret-at-least-32-characters';
});
test.afterAll(() => {
    if (beforeLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = beforeLocal;
    if (beforeSecret === undefined) delete process.env.UIER_COMMENTS_SECRET; else process.env.UIER_COMMENTS_SECRET = beforeSecret;
});

async function saved() {
    const store = getMemoryCommentsStore();
    const project = await persistProjectAccess({ id: `reply-images-${randomUUID()}`, urls: ['https://reviewed.example'] } as DbProject);
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, path: '/', position: { type: 'page' },
        authorId: 'owner', thread: { items: [{ id: 'first', text: 'Original feedback', authorId: 'owner' }] }, resolved: true };
    await store.create(comment);
    return { store, project, comment };
}
const owner = { kind: 'guest', visitorId: 'owner' } as const;
const stranger = { kind: 'guest', visitorId: 'stranger' } as const;
const request = () => new Request('https://uier.io/api/review/fixture/comments/fixture/replies');

// The HTTP boundary must apply the same pixel sanitizer and body budget as new comments.
test('reply image API sanitizes all supported formats, keeps images per item, and rejects invalid or oversized uploads', async ({ request }) => {
    const created = await request.post('/api/comments', { data: {
        path: `/reply-images-${randomUUID()}`, position: { type: 'page' }, kind: 'feedback', text: 'Thread image', screenshot: pngImage
    } });
    expect(created.status()).toBe(201);
    const thread = await created.json();
    const originalUrl = `/api/comments/${thread.id}/screenshot`;
    const original = await (await request.get(originalUrl)).body();
    for (const screenshot of await privateImages()) {
        const reply = await request.post(`/api/comments/${thread.id}/replies`, { data: { text: 'Attached evidence', screenshot } });
        expect(reply.status(), await reply.text()).toBe(201);
        const saved = await reply.json();
        const item = saved.thread.items.at(-1);
        expect(item.screenshot).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
        expect(JSON.stringify(saved)).not.toContain('data:image');
        const image = await request.get(`/api/comments/${thread.id}/replies/${item.id}/screenshot`);
        expect(image.status()).toBe(200);
        expect(image.headers()['cache-control']).toContain('no-store');
        await expectPrivateImageRemoved(await image.body());
        expect(await (await request.get(originalUrl)).body()).toEqual(original);
        expect((await request.delete(`/api/comments/${thread.id}/replies/${item.id}`)).status()).toBe(200);
        expect((await request.get(`/api/comments/${thread.id}/replies/${item.id}/screenshot`)).status()).toBe(404);
    }
    for (const screenshot of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,bm90aW1hZ2U=', `data:image/png;base64,${'A'.repeat(710_000)}`]) {
        expect([400, 413]).toContain((await request.post(`/api/comments/${thread.id}/replies`, { data: { text: 'Invalid', screenshot } })).status());
    }
    await request.delete(`/api/comments/${thread.id}`);
});

test('project reply images obey thread privacy, survive text edits and are removed with the reply or thread', async () => {
    const { store, project, comment } = await saved();
    const screenshot = await screenshotSchema.parseAsync(pngImage);
    const key = randomUUID();
    const input = { text: 'Reply with an image', screenshot, idempotencyKey: key };
    const added = await replyToProjectComment(request(), project, owner, comment.id, input);
    const item = added.thread.items.at(-1)!;
    expect(added.resolved).toBe(true);
    expect(added.screenshot).toBeUndefined();
    expect((await getProjectScreenshot(project, stranger, comment.id, item.id)).data).toBe(screenshot.data.toString('base64'));
    expect(toCommentDto(added, 'owner')!.thread.items.at(-1)).toMatchObject({ screenshot: { width: 3, height: 2 } });
    expect((await replyToProjectComment(request(), project, owner, comment.id, input)).thread.items).toHaveLength(2);
    await expect(replyToProjectComment(request(), project, owner, comment.id, { ...input, screenshot: await screenshotSchema.parseAsync(jpegImage) })).rejects.toMatchObject({ code: 'conflict' });
    await editProjectCommentItem(project, owner, comment.id, item.id, { text: 'Edited reply text', expectedText: input.text });
    expect((await getProjectScreenshot(project, owner, comment.id, item.id)).width).toBe(3);
    const current = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...current.comment, private: true }, current.etag);
    for (const actor of [stranger, { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const]) {
        await expect(getProjectScreenshot(project, actor, comment.id, item.id)).rejects.toMatchObject({ code: 'not_found' });
        await expect(replyToProjectComment(request(), project, actor, comment.id, { text: 'Cannot attach', screenshot })).rejects.toMatchObject({ code: 'not_found' });
    }
    expect((await getProjectScreenshot(project, owner, comment.id, item.id)).width).toBe(3);
    await deleteProjectCommentItem(project, owner, comment.id, item.id);
    expect(await store.getScreenshot(comment.domain, comment.id, item.id)).toBeNull();
    const next = await replyToProjectComment(request(), project, owner, comment.id, { text: 'Another image', screenshot });
    await deleteProjectCommentItem(project, owner, comment.id, 'first');
    expect(await store.getScreenshot(comment.domain, comment.id, next.thread.items.at(-1)!.id)).toBeNull();
});

test('reply image budget falls back to text without losing status or exposing image metadata', async () => {
    const { store, project, comment } = await saved();
    for (let i = 0; i < RATE_LIMIT_DOMAIN_SCREENSHOTS; i++) await enforceScreenshotLimits(store, comment.domain);
    const added = await replyToProjectComment(request(), project, owner, comment.id, { text: 'Keep this reply', screenshot: await screenshotSchema.parseAsync(pngImage) });
    expect(added.resolved).toBe(true);
    expect(added.thread.items.at(-1)!.screenshot).toBeUndefined();
    expect(await store.getScreenshot(comment.domain, comment.id, added.thread.items.at(-1)!.id)).toBeNull();
});

test('reply and image commit atomically, recover lost acknowledgements, and retain text on failed image storage', async () => {
    for (const failImage of [false, true]) {
        const { store, comment } = await saved();
        const screenshot = await screenshotSchema.parseAsync(pngImage);
        const item: DbThreadItem = { id: `item_${randomUUID()}`, text: 'Atomic reply', authorId: 'owner', screenshot: screenshotInfo(screenshot) };
        const attempt = submission(comment.domain, 'owner', randomUUID(), { item: item.id })!;
        const wrapped = { ...store, async commitSubmission(...args: Parameters<typeof store.commitSubmission>) {
            if (failImage && args[3]) throw new Error('Upload unavailable');
            const result = await store.commitSubmission(...args);
            if (!failImage) throw new Error('Acknowledgement lost');
            return result;
        } };
        const added = await commitReplySubmission(wrapped, attempt, comment.id, item, undefined, undefined, current => screenshotDocument(current, screenshot, item.id));
        expect(added.thread.items).toHaveLength(2);
        expect(Boolean(added.thread.items[1]!.screenshot)).toBe(!failImage);
        expect(Boolean(await store.getScreenshot(comment.domain, comment.id, item.id))).toBe(!failImage);
        expect((await commitReplySubmission(wrapped, attempt, comment.id, item)).thread.items).toHaveLength(2);
    }
});

test('an image reply rechecks visibility when the parent becomes private during an etag retry', async () => {
    const { store, comment } = await saved();
    const screenshot = await screenshotSchema.parseAsync(pngImage);
    const item: DbThreadItem = { id: 'item_visibility_race', text: 'Evidence', authorId: 'stranger', screenshot: screenshotInfo(screenshot) };
    const attempt = submission(comment.domain, 'stranger', randomUUID(), { text: item.text })!;
    const wrapped = { ...store, async commitSubmission() {
        const parent = (await store.get(comment.domain, comment.id))!;
        await store.replace({ ...parent.comment, private: true }, parent.etag);
        return 'conflict' as const;
    } };
    await expect(commitReplySubmission(wrapped, attempt, comment.id, item, parent => {
        if (parent.private) throw new Error('Thread is no longer visible');
    }, undefined, parent => screenshotDocument(parent, screenshot, item.id))).rejects.toThrow('Thread is no longer visible');
    expect((await store.get(comment.domain, comment.id))!.comment.thread.items).toHaveLength(1);
    expect(await store.getScreenshot(comment.domain, comment.id, item.id)).toBeNull();
});
