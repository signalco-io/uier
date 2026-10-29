import { persistProjectAccess } from './support/projectAccess';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pngImage, jpegImage } from './support/images';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { replaceSavedScreenshot } from '../src/lib/comments/replaceScreenshot';
import { createWithScreenshot, screenshotInfo } from '../src/lib/comments/service';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { replaceProjectScreenshot, getProjectScreenshot, removeProjectComment } from '../src/lib/review/comments';
import type { DbComment } from '../src/lib/db/schema';
import type { ReviewApiContext } from '../src/lib/review/http';
import { RATE_LIMIT_DOMAIN_SCREENSHOTS } from '../src/lib/comments/limits';
import { enforceScreenshotLimits } from '../src/lib/comments/rateLimits';

const original = parseScreenshot(pngImage) as ParsedScreenshot;
const replacement = parseScreenshot(jpegImage) as ParsedScreenshot;
const previousLocal = process.env.UIER_LOCAL;
const previousSecret = process.env.UIER_COMMENTS_SECRET;
test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET = 'screenshot-replacement-local-test-secret';
});
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal;
    if (previousSecret === undefined) delete process.env.UIER_COMMENTS_SECRET; else process.env.UIER_COMMENTS_SECRET = previousSecret;
});

async function saved(domain = `images-${randomUUID()}.localhost`) {
    const store = getMemoryCommentsStore();
    const comment: DbComment = {
        id: `comment_${randomUUID()}`, domain, path: '/', position: { type: 'page' }, authorId: 'owner',
        thread: { items: [{ id: 'first', text: 'Keep this feedback.', authorId: 'owner' }] },
        screenshot: screenshotInfo(original)
    };
    await createWithScreenshot(store, comment, original);
    return { store, comment };
}

test('public screenshot replacement validates, authorizes, rejects stale edits and deletes the current image', async ({ request, playwright, baseURL }) => {
    const response = await request.post('/api/comments', { data: {
        path: `/evidence-${randomUUID()}`, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 },
        text: 'Keep this feedback.', screenshot: pngImage
    } });
    expect(response.status()).toBe(201);
    const comment = await response.json();
    const url = `/api/comments/${comment.id}/screenshot`;
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        expect((await stranger.post(url, { data: { screenshot: jpegImage, expectedRevision: null } })).status()).toBe(403);
        for (const screenshot of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,bm90IGFuIGltYWdl']) {
            expect((await request.post(url, { data: { screenshot, expectedRevision: null } })).status()).toBe(400);
            expect(await (await request.get(url)).body()).toEqual(original.data);
        }
        expect((await request.post(url, { data: { screenshot: jpegImage } })).status()).toBe(400);
        const oversizedDimensions = Buffer.from(original.data);
        oversizedDimensions.writeUInt32BE(5000, 16);
        const tooWide = `data:image/png;base64,${oversizedDimensions.toString('base64')}`;
        expect((await request.post(url, { data: { screenshot: tooWide, expectedRevision: null } })).status()).toBe(400);
        expect((await request.post(url, { headers: { Origin: 'https://elsewhere.example' }, data: { screenshot: jpegImage, expectedRevision: null } })).status()).toBe(403);
        const result = await request.post(url, { data: { screenshot: jpegImage, expectedRevision: null } });
        expect(result.status()).toBe(200);
        expect((await result.json()).screenshot.revision).toEqual(expect.any(String));
        const image = await request.get(url);
        expect(image.headers()['cache-control']).toBe('no-store');
        expect(await image.body()).toEqual(replacement.data);
        expect((await request.post(url, { data: { screenshot: pngImage, expectedRevision: null } })).status()).toBe(409);
        expect((await request.delete(`/api/comments/${comment.id}`)).status()).toBe(204);
        expect((await request.get(url)).status()).toBe(404);
    } finally { await stranger.dispose(); }
});

test('failed replacement keeps original bytes and metadata; concurrent image edits have one winner', async () => {
    const { store, comment } = await saved();
    const before = await store.get(comment.domain, comment.id);
    await expect(replaceSavedScreenshot({ ...store, replaceScreenshot: async () => { throw new Error('Storage unavailable'); } },
        comment.domain, comment.id, { screenshot: replacement, expectedRevision: null }, () => {})).rejects.toThrow('Storage unavailable');
    expect(await store.get(comment.domain, comment.id)).toEqual(before);
    expect((await store.getScreenshot(comment.domain, comment.id))?.data).toBe(original.data.toString('base64'));
    const results = await Promise.allSettled([original, replacement].map(screenshot => replaceSavedScreenshot(store,
        comment.domain, comment.id, { screenshot, expectedRevision: null }, () => {})));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    const current = (await store.get(comment.domain, comment.id))!;
    expect((await store.getScreenshot(comment.domain, comment.id))?.revision).toBe(current.comment.screenshot?.revision);
    expect(current.comment.thread).toEqual(comment.thread);
    // A stale transaction is rejected before either document changes.
    expect(await store.replaceScreenshot(comment, before!.etag, (await store.getScreenshot(comment.domain, comment.id))!)).toBe('conflict');
    expect(await store.get(comment.domain, comment.id)).toEqual(current);
});

test('project evidence checks guest/member/admin permissions and private visibility on every retry', async () => {
    const projectId = `evidence-${randomUUID()}`;
    const { store, comment } = await saved(`project:${projectId}`);
    const project = await persistProjectAccess({ id: projectId, urls: ['https://reviewed.example'] } as ReviewApiContext['project']);
    const context = (actor: ReviewApiContext['actor'], expectedRevision: string | null = null): ReviewApiContext => ({
        request: new Request('https://uier.io/api/review/test/comments/test/screenshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ screenshot: jpegImage, expectedRevision })
        }), project, actor
    });
    const owner = { kind: 'guest', visitorId: 'owner' } as const;
    const stranger = { kind: 'guest', visitorId: 'other' } as const;
    const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;
    const admin = { ...member, userId: 'admin', isAdmin: true };
    const replace = (actor: ReviewApiContext['actor'], expectedRevision: string | null = null) =>
        replaceProjectScreenshot(context(actor).project, actor, comment.id, { screenshot: replacement, expectedRevision });
    const get = (actor: ReviewApiContext['actor']) => getProjectScreenshot(context(actor).project, actor, comment.id);
    for (const actor of [stranger, member])
        await expect(replace(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(replace({ kind: 'anonymous' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await replace(owner)).screenshot?.revision).toEqual(expect.any(String));
    const current = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...current.comment, private: true }, current.etag);
    for (const actor of [stranger, member]) {
        await expect(replace(actor)).rejects.toMatchObject({ code: 'not_found' });
        await expect(get(actor)).rejects.toMatchObject({ code: 'not_found' });
    }
    const revised = await replace(admin, current.comment.screenshot!.revision!);
    expect(revised.screenshot?.revision).not.toBe(current.comment.screenshot!.revision);
    expect((await get(owner)).data).toBe(replacement.data.toString('base64'));
    await removeProjectComment(context(admin).project, admin, comment.id);
    expect(await store.getScreenshot(comment.domain, comment.id)).toBeNull();
    await expect(get(admin)).rejects.toMatchObject({ code: 'not_found' });
});

test('a concurrent permission/deletion change is checked again without changing the original evidence', async () => {
    const { store, comment } = await saved();
    let writes = 0;
    const racing = { ...store, replaceScreenshot: async (...args: Parameters<typeof store.replaceScreenshot>) => {
        writes++;
        const current = (await store.get(comment.domain, comment.id))!;
        await store.replace({ ...current.comment, private: true }, current.etag);
        return store.replaceScreenshot(...args);
    } };
    await expect(replaceSavedScreenshot(racing, comment.domain, comment.id, { screenshot: replacement, expectedRevision: null }, comment => {
        if (comment.private) throw new Error('No longer authorized');
    })).rejects.toThrow('No longer authorized');
    expect(writes).toBe(1);
    expect((await store.getScreenshot(comment.domain, comment.id))?.data).toBe(original.data.toString('base64'));
});

test('image budget failures preserve original evidence and a member can replace their own evidence', async () => {
    const { store, comment } = await saved();
    for (let i = 0; i < RATE_LIMIT_DOMAIN_SCREENSHOTS; i++) await enforceScreenshotLimits(store, comment.domain);
    await expect(replaceSavedScreenshot(store, comment.domain, comment.id,
        { screenshot: replacement, expectedRevision: null }, () => {})).rejects.toMatchObject({ code: 'rate_limited' });
    expect((await store.getScreenshot(comment.domain, comment.id))?.data).toBe(original.data.toString('base64'));
    const projectId = `member-${randomUUID()}`;
    const owned = await saved(`project:${projectId}`);
    const current = (await store.get(owned.comment.domain, owned.comment.id))!;
    await store.replace({ ...current.comment, authorId: 'user:member' }, current.etag);
    const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;
    const project = await persistProjectAccess({ id: projectId } as ReviewApiContext['project']);
    const updated = await replaceProjectScreenshot(project, member, owned.comment.id,
        { screenshot: replacement, expectedRevision: null });
    expect(updated.screenshot?.revision).toEqual(expect.any(String));
});
