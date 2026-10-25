import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { pngImage } from './support/images';

// Optional screenshots (issue #32): a new comment or feedback can take a screenshot of the part of
// the page it is about, in the reviewer's browser, without the toolbar. It is saved with the
// comment and shown in its thread.

type SavedComment = { id: string; kind: string; thread: { items: { text: string }[] }; screenshot?: { width: number; height: number } };

async function savedComments(page: Page) {
    return await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as SavedComment[]);
}

async function savedComment(page: Page, text: string) {
    const comment = (await savedComments(page)).find(c => c.thread.items[0]?.text === text);
    expect(comment, `the comment "${text}"`).toBeDefined();
    return comment!;
}

/** The colour of a pixel of the comment's stored screenshot (window coordinates of when it was taken) */
async function screenshotPixel(page: Page, commentId: string, point: { x: number; y: number }, scale: number) {
    return await page.evaluate(async ({ commentId, point, scale }) => {
        const blob = await (await fetch(`/api/comments/${commentId}/screenshot`)).blob();
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const [r, g, b] = context.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1).data;
        return { r: r!, g: g!, b: b! };
    }, { commentId, point, scale });
}

/** Pins a new comment to an element of the page and writes its text */
async function startComment(page: Page, text: string, element: Locator) {
    await element.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add comment' }).click();
    const box = await element.boundingBox();
    await page.mouse.click(box!.x + 20, box!.y + box!.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Comment' }).fill(text);
    return draft;
}

test('screenshots: a comment with a screenshot of its element, one without, one removed again', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    // With: the screenshot is taken when asked for, shown before posting, and sent with the comment
    const draft = await startComment(page, 'The headline says it well.', page.getByRole('heading', { level: 1 }));
    await draft.getByRole('button', { name: 'Add a screenshot' }).click();
    const preview = draft.getByRole('img', { name: 'Screenshot to send with the comment' });
    await expect(preview).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Screenshot added' })).toBeAttached();
    await expect(draft.getByRole('button', { name: 'Add a screenshot' })).toHaveCount(0);
    await animationsFinished(draft);
    await expectNoAxeViolations(page);
    await draft.getByRole('button', { name: 'Post comment' }).click();

    // The thread shows it; it opens full size in a new tab
    const thread = openThread(page);
    const shown = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(shown).toBeVisible();
    await expect.poll(async () => await shown.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const popup = context.waitForEvent('page');
    await shown.click();
    expect((await popup).url()).toMatch(/^blob:/);

    // Saved with the comment: the heading and some room around it, at the screen's pixel ratio
    const withScreenshot = await savedComment(page, 'The headline says it well.');
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    const scale = Math.min(await page.evaluate(() => window.devicePixelRatio), 2);
    expect(withScreenshot.screenshot!.height).toBeGreaterThanOrEqual(Math.floor(Math.min(heading!.height, 200) * scale));
    expect(withScreenshot.screenshot!.width).toBeGreaterThanOrEqual(Math.floor(Math.min(heading!.width, 360) * scale));
    const image = await page.evaluate(async (id) => {
        const response = await fetch(`/api/comments/${id}/screenshot`);
        const bitmap = await createImageBitmap(await response.blob());
        return { type: response.headers.get('content-type'), width: bitmap.width, height: bitmap.height };
    }, withScreenshot.id);
    expect(image).toEqual({ type: expect.stringMatching(/^image\/(webp|jpeg)$/), ...withScreenshot.screenshot });

    // Without: nothing taken, nothing sent
    await page.keyboard.press('Escape');
    const plain = await startComment(page, 'No picture needed.', page.getByRole('main').getByRole('heading', { level: 2 }).first());
    await plain.getByRole('button', { name: 'Post comment' }).click();
    const plainThread = page.getByRole('dialog', { name: 'Comment thread' });
    await expect(plainThread.getByText('No picture needed.')).toBeVisible();
    await expect(plainThread.getByRole('button', { name: 'Screenshot of the commented part of the page' })).toHaveCount(0);
    expect((await savedComment(page, 'No picture needed.')).screenshot).toBeUndefined();

    // Taken, then removed before posting
    await page.keyboard.press('Escape');
    const removed = await startComment(page, 'Changed my mind about the picture.', page.getByRole('main').getByRole('heading', { level: 2 }).nth(1));
    await removed.getByRole('button', { name: 'Add a screenshot' }).click();
    await removed.getByRole('button', { name: 'Remove screenshot' }).click();
    await expect(removed.getByRole('img', { name: 'Screenshot to send with the comment' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Screenshot removed' })).toBeAttached();
    await expect(removed.getByRole('textbox', { name: 'Comment' })).toBeFocused();
    await removed.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByRole('dialog', { name: 'Comment thread' }).getByText('Changed my mind about the picture.')).toBeVisible();
    expect((await savedComment(page, 'Changed my mind about the picture.')).screenshot).toBeUndefined();

    await context.close();
});

test('screenshots: with the keyboard, the focus goes to "Remove screenshot"', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    const draft = await startComment(page, 'With the keyboard.', page.getByRole('heading', { level: 1 }));
    await draft.getByRole('button', { name: 'Add a screenshot' }).focus();
    await page.keyboard.press('Enter');
    await expect(draft.getByRole('button', { name: 'Remove screenshot' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toBeFocused();

    await context.close();
});

test('screenshots: the inbox loads them as they come into view', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    for (let i = 1; i <= 6; i++) {
        const status = await page.evaluate(async ({ i, screenshot }) => (await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'main', xNormal: 0.5, yNormal: 0.1 * i }, text: `Comment ${i}`, screenshot })
        })).status, { i, screenshot: pngImage });
        expect(status).toBe(201);
    }

    const fetched = new Set<string>();
    page.on('request', (request) => {
        if (request.url().endsWith('/screenshot')) {
            fetched.add(request.url());
        }
    });
    await page.reload();
    await page.getByRole('button', { name: 'Inbox, 6 comments' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('button', { name: 'Screenshot of the commented part of the page' }).first()).toBeVisible();
    // Only the ones in (or near) the list's view
    expect(fetched.size).toBeGreaterThan(0);
    expect(fetched.size).toBeLessThan(6);

    // The rest when the list scrolls to them
    const cards = sidebar.getByRole('article');
    for (let i = 0; i < 6; i++) {
        await cards.nth(i).scrollIntoViewIfNeeded();
        await expect(cards.nth(i).getByRole('button', { name: 'Screenshot of the commented part of the page' })).toBeVisible();
    }
    expect(fetched.size).toBe(6);

    await context.close();
});

test('screenshots: feedback is about the page, its screenshot is the window without the toolbar', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const view = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    const pill = await toolbar(page).boundingBox();

    await page.getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    await dialog.getByRole('textbox').fill('Clear and calm.');
    await dialog.getByRole('button', { name: 'Add a screenshot' }).click();
    await expect(dialog.getByRole('img', { name: 'Screenshot to send with the comment' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog).toBeHidden();

    // The whole window, at the screen's pixel ratio (at most 2)
    const feedback = await savedComment(page, 'Clear and calm.');
    expect(feedback.kind).toBe('feedback');
    const scale = feedback.screenshot!.width / view.width;
    expect(scale).toBeCloseTo(Math.min(await page.evaluate(() => window.devicePixelRatio), 2), 1);
    expect(feedback.screenshot!.height).toBeCloseTo(view.height * scale, -1);

    // The black toolbar pill was over the white page: the screenshot has the page there
    const underPill = await screenshotPixel(page, feedback.id, { x: pill!.x + pill!.width / 2, y: pill!.y + pill!.height / 2 }, scale);
    expect(underPill.r + underPill.g + underPill.b).toBeGreaterThan(600);

    // The inbox shows it with the feedback
    await page.reload();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('button', { name: 'Screenshot of the commented part of the page' })).toBeVisible();

    await context.close();
});
