import { expect, test, type Page } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding } from './support/toolbar';
import { pngImage, jpegImage } from './support/images';
import { expectNoAxeViolations } from './accessibility';

const imageFile = (data = pngImage) => ({ name: 'evidence.png', mimeType: data.split(';')[0]!.slice(5), buffer: Buffer.from(data.split(',')[1]!, 'base64') });

async function savedFeedback(page: Page, screenshot?: string) {
    const id = await page.evaluate(async screenshot => {
        const response = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Keep this saved feedback.', screenshot }) });
        return (await response.json() as { id: string }).id;
    }, screenshot);
    await page.reload();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    return id;
}

async function storedImage(page: Page, id: string) {
    return page.evaluate(async id => {
        const blob = await (await fetch(`/api/comments/${id}/screenshot`)).blob();
        return new Promise<string>(resolve => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
        });
    }, id);
}

test('saved evidence: upload fallback, validation, denied clipboard and failed replacement preserve feedback', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const id = await savedFeedback(page);
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    const input = thread.getByLabel('Upload screenshot image');
    await expect(thread.getByText('No screenshot available.')).toBeVisible();
    await input.setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(thread.getByRole('alert')).toContainText('Choose a PNG, JPEG or WebP');
    await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
    await expect(thread.getByRole('alert')).toContainText('could not be opened');
    await input.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(512 * 1024 + 1) });
    await expect(thread.getByRole('alert')).toContainText('at most 512 KB');
    await input.setInputFiles(imageFile());
    await expect(thread.getByRole('status')).toContainText('Screenshot replaced.');
    const thumbnail = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(thumbnail).toBeVisible();
    expect(await storedImage(page, id)).toBe(pngImage);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('saved-evidence-light.png') });

    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
    await thread.getByRole('button', { name: 'Paste image' }).click();
    await expect(thread.getByRole('alert')).toContainText('Clipboard access was denied');
    expect(await storedImage(page, id)).toBe(pngImage);

    await page.route(`**/api/comments/${id}/screenshot`, async route => {
        if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: 'unavailable', message: 'Image storage unavailable.' } });
        else await route.continue();
    });
    await input.setInputFiles(imageFile(jpegImage));
    await expect(thread.getByRole('alert')).toContainText('Replacement was not confirmed');
    expect(await storedImage(page, id)).toBe(pngImage);
    await expect(thread.getByText('Keep this saved feedback.')).toBeVisible();
    await page.unroute(`**/api/comments/${id}/screenshot`);
    // A keyboard paste is a fallback even when the permission-based Clipboard API was denied.
    await thread.getByRole('region', { name: 'Screenshot evidence' }).evaluate((element, data) => {
        const bytes = Uint8Array.from(atob(data.split(',')[1]!), c => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'pasted.jpg', { type: 'image/jpeg' }));
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, composed: true }));
    }, jpegImage);
    await expect(thread.getByRole('status')).toContainText('Screenshot replaced.');
    expect(await storedImage(page, id)).toBe(jpegImage);
    await page.reload();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await expect(thumbnail).toBeVisible();
    await context.close();
});

test('saved evidence: clipboard image, keyboard redaction, failed save, reload and deletion in dark mode', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const id = await savedFeedback(page, pngImage);
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    await page.evaluate(data => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        read: async () => [{ types: ['image/png'], getType: async () => new Blob([Uint8Array.from(atob(data.split(',')[1]!), c => c.charCodeAt(0))], { type: 'image/png' }) }]
    } }), pngImage);
    await thread.getByRole('button', { name: 'Paste image' }).click();
    await expect(thread.getByRole('status')).toContainText('Screenshot replaced.');
    const thumbnail = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await thumbnail.focus();
    await page.keyboard.press('Enter');
    const expanded = page.getByRole('dialog', { name: 'Screenshot', exact: true });
    await expanded.getByRole('button', { name: 'Redact screenshot' }).click();
    const editor = expanded.getByRole('region', { name: 'Redact screenshot' });
    const surface = editor.getByRole('img', { name: 'Image redaction surface' });
    await surface.scrollIntoViewIfNeeded();
    const bounds = (await surface.boundingBox())!;
    const start = { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height * 0.2 };
    const end = { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height * 0.7 };
    if (testInfo.project.use.hasTouch) {
        const session = await context.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
    } else {
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
    }
    await expect(editor.getByRole('status')).toContainText('1 redaction area.');
    await editor.getByRole('button', { name: 'Undo redaction' }).click();
    await expect(editor.getByRole('status')).toContainText('0 redaction areas.');
    await editor.getByLabel('Left (%)').fill('0');
    await editor.getByLabel('Top (%)').fill('0');
    await editor.getByLabel('Width (%)').fill('100');
    await editor.getByLabel('Height (%)').fill('100');
    await editor.getByRole('button', { name: 'Add redaction', exact: true }).click();
    await expect(editor.getByRole('status')).toContainText('1 redaction area.');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('redaction-dark.png') });
    await page.route(`**/api/comments/${id}/screenshot`, async route => {
        if (route.request().method() === 'POST') await route.abort('failed'); else await route.continue();
    });
    await editor.getByRole('button', { name: 'Save redaction' }).click();
    await expect(editor.getByRole('alert')).toContainText('Redaction was not confirmed');
    expect(await storedImage(page, id)).toBe(pngImage);
    await page.unroute(`**/api/comments/${id}/screenshot`);
    await editor.getByRole('button', { name: 'Save redaction' }).click();
    await expect(thread.getByRole('status')).toContainText('Screenshot replaced.');
    expect(await storedImage(page, id)).not.toBe(pngImage);
    await page.reload();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await thumbnail.click();
    const pixels = await expanded.getByRole('img', { name: 'Expanded screenshot' }).evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
    });
    expect(pixels.filter((_, index) => index % 4 !== 3).every(value => value < 5)).toBe(true);
    await expanded.getByRole('button', { name: 'Close screenshot' }).click();
    const deleted = await page.evaluate(async id => (await fetch(`/api/comments/${id}`, { method: 'DELETE' })).status, id);
    expect(deleted).toBe(204);
    expect(await page.evaluate(async id => (await fetch(`/api/comments/${id}/screenshot`)).status, id)).toBe(404);
    await context.close();
});
