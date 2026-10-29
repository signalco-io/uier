import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { getAppStore } from '../src/lib/app/store';
import { cleanupThread, sweepCommentCleanup } from '../src/lib/comments/cleanup';
import { createWithScreenshot, forgetScreenshot, screenshotDocument, screenshotInfo } from '../src/lib/comments/service';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import type { DbComment } from '../src/lib/db/schema';
import { pngImage } from './support/images';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
const image = parseScreenshot(pngImage) as ParsedScreenshot;
const old = () => new Date(Date.now() - 70 * 60_000).toISOString();
function comment(createdAt = old()): DbComment {
    return { domain: `cleanup-${randomUUID()}.localhost`, id: `comment_${randomUUID()}`, path: '/',
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Keep text' }] },
        createdAt, screenshot: screenshotInfo(image) };
}

test('scheduled sweep retries failed deletes, skips live/recent images and pages over metadata', async () => {
    const store = getMemoryCommentsStore();
    const gone = comment();
    await createWithScreenshot(store, gone, image);
    const stored = (await store.get(gone.domain, gone.id))!;
    await store.delete(gone.domain, gone.id, stored.etag);
    let attempts = 0;
    await forgetScreenshot({ ...store, deleteScreenshot: async () => { attempts++; throw new Error('Delete unavailable'); } }, gone.domain, gone.id, true, null);
    expect(attempts).toBe(2);
    const failedCreate = comment();
    await expect(createWithScreenshot({ ...store, create: async () => { throw new Error('Create unavailable'); },
        deleteScreenshot: async () => { throw new Error('Delete unavailable'); } }, failedCreate, image)).rejects.toThrow('Create unavailable');
    const live = comment();
    await createWithScreenshot(store, live, image);
    const recent = comment(new Date().toISOString());
    await store.createScreenshot(screenshotDocument(recent, image));
    const noImage = comment();
    await createWithScreenshot(store, noImage, image);
    const saved = (await store.get(noImage.domain, noImage.id))!;
    await store.replace({ ...saved.comment, screenshot: undefined }, saved.etag);
    // More than one projection page, with no parent comments and no pixels in the projection.
    const extras = Array.from({ length: 103 }, () => comment());
    for (const extra of extras) await store.createScreenshot(screenshotDocument(extra, image));
    await sweepCommentCleanup(store);
    for (const removed of [gone, failedCreate, noImage, ...extras]) expect(await store.getScreenshot(removed.domain, removed.id)).toBeNull();
    for (const kept of [live, recent]) expect(await store.getScreenshot(kept.domain, kept.id)).not.toBeNull();
});

test('orphan sweep does not delete an image replaced after the reference check', async () => {
    const store = getMemoryCommentsStore();
    const target = comment();
    await store.create({ ...target, screenshot: undefined });
    await store.createScreenshot(screenshotDocument(target, image));
    let replaced = false;
    await sweepCommentCleanup({ ...store, get: async (domain, id) => {
        const saved = await store.get(domain, id);
        if (domain === target.domain && id === target.id && !replaced) {
            replaced = true;
            await store.replaceScreenshot(target, saved!.etag, { ...screenshotDocument(target, image), revision: 'new', createdAt: new Date().toISOString() });
        }
        return saved;
    } });
    expect(replaced).toBe(true);
    expect((await store.getScreenshot(target.domain, target.id))?.revision).toBe('new');
});

test('durable deletion intent retries record cleanup and catches writes that were already in flight', async () => {
    const store = getMemoryCommentsStore();
    const app = getAppStore();
    const target = comment();
    const read = { type: 'review-read', pk: `read-${randomUUID()}`, id: target.id, domain: target.domain };
    await app.create(read);
    await expect(cleanupThread(target.domain, target.id, true, store, { ...app, delete: async () => { throw new Error('Delete unavailable'); } })).rejects.toThrow();
    expect(await app.get(read.pk, read.id)).not.toBeNull();
    const [pending] = await app.query({ type: 'thread-cleanup', where: { domain: target.domain, threadId: target.id } });
    expect(pending?.ttl).toBe(-1);
    await sweepCommentCleanup(store, app);
    expect(await app.get(read.pk, read.id)).toBeNull();
    await app.create(read); // A write that started before deletion completes late.
    await sweepCommentCleanup(store, app);
    expect(await app.get(read.pk, read.id)).toBeNull();
});
