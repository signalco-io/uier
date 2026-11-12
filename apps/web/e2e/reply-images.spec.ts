import { expect, test, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail, inBackground } from './support/app';
import { animationsFinished, openThread } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
let pixels: Buffer;
test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(baseURL!);
    pixels = await sharp({ create: { width: 180, height: 120, channels: 3, background: 'white' } }).png().toBuffer();
});
test.afterAll(async () => { await site.close(); });
const attach = (form: Locator, name = 'evidence.png') => form.locator('input[type=file]').setInputFiles({ name, mimeType: 'image/png', buffer: pixels });

// Both surfaces share real stored bytes and authorization, including a failed send followed by a retry.
test('reply images can be picked, removed, retried and expanded in toolbar and app threads', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('reply-images'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    const reviewUrl = `/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`;
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment', exact: true });
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Thread for image replies');
    await draft.getByRole('button', { name: 'Omit screenshot', exact: true }).click();
    const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/review/${projectId}/comments`));
    await draft.getByRole('button', { name: 'Post comment', exact: true }).click();
    const comment = await (await response).json();
    const thread = openThread(page);
    const form = thread.locator('form');
    await expect(form.getByRole('button', { name: 'Attach image', exact: true })).toBeVisible();
    await attach(form);
    await expect(form.getByRole('button', { name: 'Remove attached image evidence.png' })).toBeVisible();
    await form.getByRole('button', { name: 'Remove attached image evidence.png' }).click();
    await expect(form.getByRole('button', { name: 'Attach image', exact: true })).toBeVisible();
    await attach(form);
    await form.getByRole('textbox', { name: 'Reply', exact: true }).fill('Toolbar reply image');
    const endpoint = `**/api/review/${projectId}/comments/${comment.id}/replies`;
    let fail = true;
    await page.route(endpoint, async route => {
        if (fail) { fail = false; await route.abort('failed'); } else await route.continue();
    });
    await form.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(form.getByRole('textbox', { name: 'Reply', exact: true })).toHaveText('Toolbar reply image', { useInnerText: true });
    await expect(form.getByRole('button', { name: 'Remove attached image evidence.png' })).toBeVisible();
    // Image bytes must never be written into the local draft/attempt record.
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('data:image');
    await form.getByRole('button', { name: 'Post reply', exact: true }).click();
    const thumbnail = thread.getByRole('button', { name: 'Image attached to reply', exact: true });
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();
    await expect(page.getByRole('dialog', { name: 'Screenshot', exact: true }).getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    await page.getByRole('button', { name: 'Close screenshot', exact: true }).click();
    await page.unroute(endpoint);

    await page.goto(`/app/projects/${projectId}?comment=${comment.id}`);
    await inBackground(page);
    const card = page.getByRole('article', { name: /^Comment by/ });
    await expect(card.getByRole('button', { name: 'Image attached to reply', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Image attached to reply', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Reply image', exact: true }).getByRole('img', { name: 'Expanded reply image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    const appForm = card.getByRole('form', { name: 'Reply to thread' });
    await appForm.locator('input[type=file]').setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(appForm.getByRole('alert')).toContainText('Choose a PNG, JPEG or WebP image.');
    // Paste uses exactly the same reader as the picker, with no preview in the composer.
    await appForm.evaluate((form, bytes) => {
        const clipboard = new DataTransfer();
        clipboard.items.add(new File([Uint8Array.from(bytes)], 'pasted-reply-evidence-on-the-reviewed-page.png', { type: 'image/png' }));
        form.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, [...pixels]);
    await expect(appForm.getByRole('button', { name: 'Remove attached image pasted-reply-evidence-on-the-reviewed-page.png' })).toBeVisible();
    await expect(appForm.getByRole('img')).toHaveCount(0);
    expect(await appForm.locator('[data-slot="input-group"]').evaluate(box => box.scrollWidth <= box.clientWidth)).toBe(true);
    await appForm.getByRole('textbox', { name: 'Reply', exact: true }).fill('App reply image');
    let failAction = true;
    await page.route('**/app/projects/**', async route => {
        if (failAction && route.request().method() === 'POST' && route.request().headers()['next-action']) {
            failAction = false;
            await route.abort('failed');
        } else await route.continue();
    });
    await appForm.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(appForm.getByRole('textbox', { name: 'Reply', exact: true })).toHaveText('App reply image', { useInnerText: true });
    await expect(appForm.getByRole('button', { name: 'Remove attached image pasted-reply-evidence-on-the-reviewed-page.png' })).toBeVisible();
    await page.unroute('**/app/projects/**');
    await appForm.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(card.getByRole('status').filter({ hasText: /^Reply posted$/ })).toBeAttached();
    await expect(card.getByRole('button', { name: 'Image attached to reply', exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('data:image');
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(card.getByRole('button', { name: 'Image attached to reply', exact: true })).toHaveCount(2);
    await page.goto(reviewUrl);
    await page.locator(`[data-uier-comment="${comment.id}"]`).click();
    // Threads initially show the first and last message; reveal the middle reply too.
    await openThread(page).getByRole('button', { name: /Show all/ }).click();
    await openThread(page).getByText('Toolbar reply image', { exact: true }).scrollIntoViewIfNeeded();
    await expect(openThread(page).getByRole('button', { name: 'Image attached to reply', exact: true })).toHaveCount(2);
});
