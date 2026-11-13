import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, inBackground, signIn, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
const recordingFile = fileURLToPath(new URL('./fixtures/recording.webm', import.meta.url));
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

test('app replies upload and retry a recording, renew private playback and retain it after reload', async ({ page }) => {
    test.setTimeout(90_000);
    // Upload remains available when native screen capture is unavailable, including mobile browsers.
    await page.addInitScript(() => {
        if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: undefined });
    });
    await signIn(page, uniqueEmail('app-recording'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment', exact: true });
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Thread for a recorded reproduction');
    await draft.getByRole('button', { name: 'Omit screenshot', exact: true }).click();
    const creation = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/review/${projectId}/comments`));
    await draft.getByRole('button', { name: 'Post comment', exact: true }).click();
    const comment = await (await creation).json();
    await page.goto(`/app/projects/${projectId}?comment=${comment.id}`);
    await inBackground(page);
    const card = page.getByRole('article', { name: /^Comment by/ });
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    const form = card.getByRole('form', { name: 'Reply to thread' });
    await expect(form.getByRole('button', { name: 'Record screen', exact: true })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Upload video', exact: true })).toBeVisible();
    const file = form.locator('input[type=file][accept*="video/"]');
    await file.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a recording') });
    await expect(form.getByRole('alert')).toContainText('Choose an MP4 or WebM video.');
    await file.setInputFiles(recordingFile);
    await expect(form.locator('video[aria-label="Recording preview"]')).toBeVisible();
    await form.getByRole('button', { name: 'Discard recording', exact: true }).click();
    await expect(form.locator('[data-recording-preview]')).toHaveCount(0);
    await file.setInputFiles(recordingFile);
    await expect(form.locator('video[aria-label="Recording preview"]')).toBeVisible();
    await form.getByRole('textbox', { name: 'Reply', exact: true }).fill('The menu closes when the pointer reaches the second item.');
    expect(await form.locator('[data-slot="input-group"]').evaluate(box => box.scrollWidth <= box.clientWidth)).toBe(true);
    let uploads = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/projects/${projectId}/recordings`) uploads++;
    });
    let failAction = true;
    await page.route('**/app/projects/**', async route => {
        if (failAction && route.request().method() === 'POST' && route.request().headers()['next-action']) {
            failAction = false;
            await route.abort('failed');
        } else await route.continue();
    });
    await form.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(form.getByRole('textbox', { name: 'Reply', exact: true })).toHaveText('The menu closes when the pointer reaches the second item.', { useInnerText: true });
    await expect(form.locator('video[aria-label="Recording preview"]')).toBeVisible();
    await expect(form.getByRole('alert')).toBeVisible();
    expect(uploads).toBe(1);
    await page.unroute('**/app/projects/**');
    await form.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(card.getByRole('status').filter({ hasText: /^Reply posted$/ })).toBeAttached();
    const saved = card.locator('[data-comment-recording]');
    await expect(saved).toHaveCount(1);
    expect(uploads).toBe(1);
    let playbackRequests = 0;
    page.on('request', request => {
        if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/recording')) playbackRequests++;
    });
    await saved.getByRole('button', { name: /^Recording attached to reply/ }).click();
    const player = saved.locator('video');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(video => { (video as HTMLVideoElement).pause(); video.dispatchEvent(new Event('error')); });
    await expect.poll(() => playbackRequests).toBe(2);
    await expect(saved.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('data:video');
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(card.locator('[data-comment-recording]')).toHaveCount(1);
    await expect(card.getByRole('button', { name: /^Recording attached to reply/ })).toBeVisible();
});
