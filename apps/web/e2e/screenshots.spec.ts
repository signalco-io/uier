import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, selectText, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { brand } from '@uier/brand';
import { pngImage } from './support/images';

// Automatic screenshots (issue #81): a new comment or feedback can take a screenshot of the part of
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

test('screenshots: capture automatically, stay out of the composer and expand from saved thumbnails', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const draft = await startComment(page, 'The headline says it well.', page.getByRole('heading', { level: 1 }));
    await expect(draft.getByRole('button', { name: /screenshot/i })).toHaveCount(0);
    await expect(draft.getByRole('img')).toHaveCount(0);
    // Submit immediately: the form awaits the capture rather than racing it.
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    const thumbnail = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(thumbnail).toBeVisible();
    const saved = await savedComment(page, 'The headline says it well.');
    expect(saved.screenshot!.width).toBeGreaterThan(100);
    const box = await thumbnail.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(100);
    await thumbnail.focus();
    await page.keyboard.press('Enter');
    const expanded = page.getByRole('dialog', { name: 'Screenshot', exact: true });
    await expect(expanded.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    await expanded.getByRole('button', { name: 'Close screenshot' }).click();
    await expect(expanded).toBeHidden();
    await expect(thumbnail).toBeFocused();
    await page.reload();
    await page.locator(`[data-uier-comment="${saved.id}"]`).click();
    await expect(thumbnail).toBeVisible();
    await context.close();
});

test('screenshots: cancellation saves nothing and failed capture still saves the comment', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const canceled = await startComment(page, 'Discard this feedback.', page.getByRole('heading', { level: 1 }));
    await canceled.getByRole('button', { name: 'Discard' }).click();
    expect(await savedComments(page)).toHaveLength(0);
    await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('Capture unavailable'); }; });
    const draft = await startComment(page, 'Keep the feedback if capture fails.', page.getByRole('heading', { level: 1 }));
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    await expect(thread.getByText('Keep the feedback if capture fails.')).toBeVisible();
    await expect(thread.getByText('No screenshot available.')).toBeVisible();
    expect((await savedComment(page, 'Keep the feedback if capture fails.')).screenshot).toBeUndefined();
    await context.close();
});

test('screenshots: selected-text comments and rewrite suggestions capture automatically', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    for (const rewrite of [false, true]) {
        await selectText(page, brand.description);
        await page.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: rewrite ? 'Rewrite' : 'Add comment', exact: true }).click();
        const draft = page.getByRole('dialog', { name: rewrite ? 'New rewrite suggestion' : 'New comment' });
        await draft.getByRole('textbox', { name: rewrite ? 'Suggested text' : 'Comment', exact: true }).fill(rewrite ? 'A clearer description.' : 'Clarify this description.');
        await expect(draft.getByRole('img')).toHaveCount(0);
        await draft.getByRole('button', { name: rewrite ? 'Post suggestion' : 'Post comment' }).click();
        // Long quoted text can put the lazy image below the thread's scroll viewport on touch.
        await page.getByRole('dialog', { name: 'Comment thread' }).getByRole('group', { name: 'Messages', exact: true })
            .evaluate(element => element.scrollTo({ top: element.scrollHeight }));
        await expect(page.getByRole('dialog', { name: 'Comment thread' }).getByRole('button', { name: 'Screenshot of the commented part of the page' })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.getSelection()?.removeAllRanges());
    }
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
    await expect(dialog.getByRole('img')).toHaveCount(0);
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
