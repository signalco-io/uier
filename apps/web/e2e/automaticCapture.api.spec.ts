import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { availableScreenshot, createWithScreenshot, screenshotInfo } from '../src/lib/comments/service';
import { RATE_LIMIT_DOMAIN_SCREENSHOTS } from '../src/lib/comments/limits';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { DbComment } from '../src/lib/db/schema';

const image = { contentType: 'image/png' as const, width: 1, height: 1, data: Buffer.from('capture') };
const previousSecret = process.env.UIER_COMMENTS_SECRET;
test.beforeAll(() => { process.env.UIER_COMMENTS_SECRET = 'automatic-capture-test-key-for-local-tests'; });
test.afterAll(() => {
    if (previousSecret === undefined) delete process.env.UIER_COMMENTS_SECRET;
    else process.env.UIER_COMMENTS_SECRET = previousSecret;
});

test('automatic screenshots retain the image budget without blocking feedback text', async () => {
    const store = getMemoryCommentsStore();
    const domain = `capture-${randomUUID()}.localhost`;
    for (let i = 0; i < RATE_LIMIT_DOMAIN_SCREENSHOTS; i++) {
        expect(await availableScreenshot(store, domain, image)).toBe(image);
    }
    expect(await availableScreenshot(store, domain, image)).toBeUndefined();
});

test('an image-storage failure still saves the comment and removes uncertain image data', async () => {
    const memory = getMemoryCommentsStore();
    const comment: DbComment = {
        domain: `capture-${randomUUID()}.localhost`, id: 'comment_capture_failure', path: '/',
        position: { type: 'page' }, kind: 'feedback', resolved: false,
        thread: { items: [{ id: 'item_capture', text: 'Keep this feedback.' }] },
        screenshot: screenshotInfo(image)
    };
    const store = { ...memory, createScreenshot: async (document: Parameters<typeof memory.createScreenshot>[0]) => {
        await memory.createScreenshot(document);
        throw new Error('Image acknowledgement unavailable');
    } };
    await createWithScreenshot(store, comment, image);
    const saved = await memory.get(comment.domain, comment.id);
    expect(saved?.comment.thread.items[0]?.text).toBe('Keep this feedback.');
    expect(saved?.comment.screenshot).toBeUndefined();
    expect(await memory.getScreenshot(comment.domain, comment.id)).toBeNull();
});
