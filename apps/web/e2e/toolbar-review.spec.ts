import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

async function pointAt(page: Page, target: Locator) {
    const box = (await target.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    const outline = page.locator('[data-uier-outline]');
    await expect(outline).toBeVisible();
    await expect.poll(async () => Math.abs((await outline.boundingBox())!.width - box.width)).toBeLessThan(1);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
}

async function postDraft(page: Page, text: string) {
    const response = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/comments');
    const composer = openThread(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();
    await composer.fill(text);
    await composer.press('Enter');
    const saved = await response;
    expect(saved.status()).toBe(201);
    const comment = await saved.json() as { id: string; position: { selector: string }; screenshot?: { width: number; height: number } };
    expect(comment.position.selector).toMatch(/^#uier-toolbar>>>/);
    await expect(openThread(page).getByText(text, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    return comment;
}

test('uier pages can review toolbar controls, keep their anchors after reload and capture the control', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.emulateMedia({ colorScheme: 'light' });
    const about = toolbar(page).getByRole('button', { name: 'About uier' });
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await pointAt(page, about);
    // Targeting a control does not activate it.
    await expect(page.getByRole('region', { name: 'Try uier on this page' })).toHaveCount(0);
    const comment = await postDraft(page, 'Explain this toolbar icon.');
    expect(comment.screenshot).toBeDefined();
    const darkPixels = await page.evaluate(async id => {
        const image = await createImageBitmap(await (await fetch(`/api/comments/${id}/screenshot`)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let dark = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 35 && pixels[i + 1]! < 35 && pixels[i + 2]! < 35) dark++;
        return dark / (image.width * image.height);
    }, comment.id);
    expect(darkPixels).toBeGreaterThan(0.1);

    await page.reload();
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    await expect(pin).toBeVisible();
    await pin.click();
    await expect(openThread(page).getByText('Explain this toolbar icon.', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await toolbar(page).getByRole('button', { name: 'Collapse toolbar' }).click();
    await expect(pin).toHaveCount(0);
    await toolbar(page).getByRole('button', { name: 'Expand toolbar' }).click();
    await expect(pin).toBeVisible();
    await context.close();
});

test('uier inbox elements support pointer and keyboard anchors, panel movement and cancellation', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    const search = inbox.getByRole('searchbox', { name: 'Search comments' });
    await animationsFinished(inbox);
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await pointAt(page, search);
    const comment = await postDraft(page, 'Clarify the inbox search.');
    expect(comment.position.selector).toContain('#uier-panel-inbox>');
    await inbox.getByRole('article').filter({ hasText: 'Clarify the inbox search.' })
        .getByRole('button', { name: 'Show on page' }).click();
    await expect(openThread(page).getByText('Clarify the inbox search.', { exact: true })).toBeVisible();
    await expect(inbox).toBeVisible();
    await page.keyboard.press('Escape');
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    const initialX = (await pin.boundingBox())!.x;
    const handle = inbox.getByRole('button', { name: 'Move comments panel' });
    if (!testInfo.project.use.hasTouch) {
        await handle.focus();
        await handle.press('ArrowLeft');
        await expect.poll(async () => (await pin.boundingBox())!.x).toBeLessThan(initialX - 100);
    }
    await inbox.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(pin).toHaveCount(0);
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    await expect(pin).toBeVisible();

    // Keyboard Add comment uses the last focused inbox element, across the shadow boundary.
    await search.focus();
    await toolbar(page).getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    const second = await postDraft(page, 'A keyboard review of search.');
    expect(second.position.selector).toBe(comment.position.selector);
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.review-overlay')).toHaveCount(0);
    await expect(inbox).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Add comment' })).toBeFocused();
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    const cancel = page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeVisible();
    await animationsFinished(cancel);
    await expectNoAxeViolations(page);
    await cancel.click();
    await expect(page.locator('.review-overlay')).toHaveCount(0);
    await expect(toolbar(page).getByRole('button', { name: 'Add comment' })).toBeFocused();
    await expect(openThread(page)).toHaveCount(0);
    await context.close();
});
