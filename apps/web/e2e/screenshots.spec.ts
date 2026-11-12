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
    // Said in words (#323), never previewed
    await expect(draft.getByRole('status').filter({ hasText: 'A screenshot of this part of the page will be attached.' })).toBeVisible();
    await expect(draft.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
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
    await page.evaluate(() => {
        HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('Capture unavailable'); };
        HTMLCanvasElement.prototype.toBlob = () => { throw new Error('Capture unavailable'); };
    });
    const draft = await startComment(page, 'Keep the feedback if capture fails.', page.getByRole('heading', { level: 1 }));
    await expect(draft.getByRole('status').filter({ hasText: 'The screenshot could not be taken. Only the text will be sent.' })).toBeVisible();
    await expect(draft.getByRole('button', { name: 'Omit screenshot' })).toHaveCount(0);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    await expect(thread.getByText('Keep the feedback if capture fails.')).toBeVisible();
    await expect(thread.getByText('No screenshot', { exact: true })).toBeVisible();
    expect((await savedComment(page, 'Keep the feedback if capture fails.')).screenshot).toBeUndefined();
    await context.close();
});

test('screenshots: selected-text comments and rewrite suggestions capture automatically', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    for (const rewrite of [false, true]) {
        await selectText(page, brand.shortDescription);
        await page.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: rewrite ? 'Rewrite' : 'Add comment', exact: true }).click();
        const draft = page.getByRole('dialog', { name: rewrite ? 'New rewrite suggestion' : 'New comment' });
        await draft.getByRole('textbox', { name: rewrite ? 'Suggested text' : 'Comment', exact: true }).fill(rewrite ? 'A clearer description.' : 'Clarify this description.');
        await expect(draft.getByRole('img')).toHaveCount(0);
        await draft.getByRole('button', { name: rewrite ? 'Post suggestion' : 'Post comment' }).click();
        // On touch the thread can be shorter than its messages, so the lazy image may be above or
        // below the thread's scroll viewport: scroll its evidence section to the top of it.
        await page.getByRole('dialog', { name: 'Comment thread' }).getByRole('group', { name: 'Messages', exact: true })
            .evaluate(messages => {
                const evidence = messages.querySelector('section[aria-label="Screenshot evidence"]');
                if (evidence)
                    messages.scrollTop += evidence.getBoundingClientRect().top - messages.getBoundingClientRect().top;
            });
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
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
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
    // Sent in the background
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();

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

/** The request body of the next new comment */
function nextCreatedComment(page: Page) {
    return page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments')
        .then(request => request.postDataJSON() as { text: string; screenshot?: string });
}

test('screenshots: the composer says while one is taken, and Omit screenshot posts only the text', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    // The narrowest supported phone layout
    if (testInfo.project.use.isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    // Hold the capture: it inlines the page's font files before drawing (src/screenshot.ts)
    await page.evaluate(() => {
        const original = window.fetch;
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        Object.assign(window, { releaseCapture: release });
        window.fetch = (input, init) => /\.woff2?(?:$|\?)/.test(String(input instanceof Request ? input.url : input))
            ? held.then(() => original(input, init)) : original(input, init);
    });
    const draft = await startComment(page, 'Send this without an image.', page.getByRole('heading', { level: 1 }));
    await expect(draft.getByRole('status').filter({ hasText: 'Taking a screenshot...' })).toBeVisible();
    await page.evaluate(() => (window as unknown as { releaseCapture: () => void }).releaseCapture());
    const disclosure = draft.getByRole('status').filter({ hasText: 'A screenshot of this part of the page will be attached.' });
    await expect(disclosure).toBeVisible();

    // A real toggle, reached and used with the keyboard
    const omit = draft.getByRole('button', { name: 'Omit screenshot' });
    await omit.focus();
    await page.keyboard.press('Space');
    await expect(omit).toHaveAttribute('aria-pressed', 'true');
    await expect(draft.getByRole('status').filter({ hasText: 'No screenshot will be attached.' })).toBeVisible();
    await expect(draft.getByRole('img')).toHaveCount(0);
    const box = await omit.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    await expectNoAxeViolations(page);

    const body = nextCreatedComment(page);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    expect(await body).not.toHaveProperty('screenshot');
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    await expect(thread.getByText('No screenshot', { exact: true })).toBeVisible();
    expect((await savedComment(page, 'Send this without an image.')).screenshot).toBeUndefined();
    await page.keyboard.press('Escape');

    // Per comment: the next one has its screenshot again
    const next = await startComment(page, 'This one keeps its screenshot.', page.getByRole('heading', { level: 1 }));
    await expect(next.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await next.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByRole('dialog', { name: 'Comment thread' }).getByRole('button', { name: 'Screenshot of the commented part of the page' })).toBeVisible();
    await context.close();
});

test('screenshots: Omit screenshot stops one being taken, and attaching it again takes a new one', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    // Hold the capture before it copies the page (it inlines the page's font files first), and count the final encodings
    await page.evaluate(() => {
        const original = window.fetch;
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const state = { release, encoded: 0 };
        Object.assign(window, { capture: state });
        window.fetch = (input, init) => /\.woff2?(?:$|\?)/.test(String(input instanceof Request ? input.url : input))
            ? held.then(() => original(input, init)) : original(input, init);
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
            if (this.width > 1) state.encoded++;
            toBlob.call(this, callback, type, quality);
        };
    });
    const capture = () => page.evaluate(() => (window as unknown as { capture: { release: () => void; encoded: number } }).capture);
    const draft = await startComment(page, 'Text only after all.', page.getByRole('heading', { level: 1 }));
    await expect(draft.getByRole('status').filter({ hasText: 'Taking a screenshot...' })).toBeVisible();
    await draft.getByRole('button', { name: 'Omit screenshot' }).click();
    await expect(draft.getByRole('status').filter({ hasText: 'No screenshot will be attached.' })).toBeVisible();
    await page.evaluate(() => (window as unknown as { capture: { release: () => void } }).capture.release());
    // Stopped: the page is not drawn or encoded once the fonts arrive (that takes well under a second)
    await page.waitForTimeout(1_000);
    expect((await capture()).encoded).toBe(0);

    // Attached after all: a new screenshot, of the page as it is now
    await draft.getByRole('button', { name: 'Omit screenshot' }).click();
    await expect(draft.getByRole('status').filter({ hasText: 'A screenshot of this part of the page will be attached.' })).toBeVisible();
    expect((await capture()).encoded).toBe(1);
    const body = nextCreatedComment(page);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    expect((await body).screenshot).toMatch(/^data:image\/(webp|jpeg);base64,/);
    await context.close();
});

test('screenshots: feedback can be sent without the screenshot of the visible page', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    if (testInfo.project.use.isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    await dialog.getByRole('textbox').fill('Text only, please.');
    await expect(dialog.getByRole('status').filter({ hasText: 'A screenshot of the visible page will be attached.' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Omit screenshot' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'No screenshot will be attached.' })).toBeVisible();
    const omit = await dialog.getByRole('button', { name: 'Omit screenshot' }).boundingBox();
    const panel = await dialog.boundingBox();
    expect(omit!.x + omit!.width).toBeLessThanOrEqual(panel!.x + panel!.width);

    const body = nextCreatedComment(page);
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    expect(await body).not.toHaveProperty('screenshot');
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
    expect((await savedComment(page, 'Text only, please.')).screenshot).toBeUndefined();

    // Sent: the next feedback has its screenshot again
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await context.close();
});

/** Pastes an image file into an element of the toolbar, like a keyboard paste of a copied image */
async function pasteImage(target: Locator, dataUrl: string) {
    await target.evaluate((element, data) => {
        const bytes = Uint8Array.from(atob(data.split(',')[1]!), c => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, composed: true, cancelable: true }));
    }, dataUrl);
}

test('screenshots: the reviewer attaches their own image instead, from the text box with the file picker or by pasting', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const draft = await startComment(page, 'This is what I see instead.', page.getByRole('heading', { level: 1 }));
    // Compact icons: the screenshot toggle in the header (its status read out), Attach image in the
    // text box's bottom-left corner, as a part of the comment
    const omit = draft.getByRole('button', { name: 'Omit screenshot' });
    await expect(omit).toHaveAccessibleDescription('A screenshot of this part of the page will be attached.');
    const attach = draft.getByRole('button', { name: 'Attach image' });
    await expect(attach).toHaveAccessibleDescription(/PNG, JPEG or WebP, up to 512 KB/);
    const text = (await draft.getByRole('textbox', { name: 'Comment', exact: true }).boundingBox())!;
    const attachBox = (await attach.boundingBox())!;
    expect(attachBox.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
    expect(attachBox.x - text.x).toBeLessThan(16);
    expect((await omit.boundingBox())!.y).toBeLessThan(text.y);
    const input = draft.locator('input[type="file"]');
    await input.setInputFiles({ name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(draft.getByRole('alert')).toContainText('Choose a PNG, JPEG or WebP');
    await input.setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from(pngImage.split(',')[1]!, 'base64') });
    await expect(draft.getByRole('status').filter({ hasText: 'Your image evidence.png will be attached instead of a screenshot.' })).toBeAttached();
    await expect(draft.getByRole('alert')).toHaveCount(0);
    await expect(omit).toHaveCount(0);
    // Named, never previewed
    await expect(draft.getByRole('img')).toHaveCount(0);
    await expectNoAxeViolations(page);
    const body = nextCreatedComment(page);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    expect((await body).screenshot).toBe(pngImage);
    await expect(page.getByRole('status').filter({ hasText: 'Comment posted' })).toBeAttached();
    expect((await savedComment(page, 'This is what I see instead.')).screenshot).toMatchObject({ width: 3, height: 2 });

    // Feedback: a pasted image, removed again, then pasted and sent
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    const textbox = dialog.getByRole('textbox');
    await textbox.fill('A pasted picture.');
    await pasteImage(textbox, pngImage);
    const remove = dialog.getByRole('button', { name: 'Remove attached image image.png' });
    await expect(remove).toBeVisible();
    await expect(textbox).toHaveText('A pasted picture.', { useInnerText: true });
    await remove.click();
    await expect(dialog.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await pasteImage(textbox, pngImage);
    await expect(remove).toBeVisible();
    const feedback = nextCreatedComment(page);
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    expect((await feedback).screenshot).toBe(pngImage);
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
    // Sent: the next feedback has its automatic screenshot again
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.getByRole('button', { name: 'Attach image' })).toBeVisible();
    await context.close();
});

/** Holds the reading of the next attached images (src/suppliedScreenshot.ts) until the returned function is called */
async function holdImageReading(page: Page) {
    await page.evaluate(() => {
        const held = window as unknown as { readAsDataURL?: FileReader['readAsDataURL']; releaseImage?: () => void };
        const original = held.readAsDataURL ??= FileReader.prototype.readAsDataURL;
        const release = new Promise<void>(resolve => { held.releaseImage = resolve; });
        FileReader.prototype.readAsDataURL = function (this: FileReader, blob: Blob) { void release.then(() => original.call(this, blob)); };
    });
    return () => page.evaluate(() => (window as unknown as { releaseImage: () => void }).releaseImage());
}

/** Holds the next new comment or feedback on its way until the returned function is called, then saves it or fails */
async function holdNextPost(page: Page, outcome: 'save' | 'fail') {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let used = false;
    await page.route(url => url.pathname === '/api/comments', async route => {
        if (used || route.request().method() !== 'POST') return route.fallback();
        used = true;
        await held;
        if (outcome === 'save') await route.fallback();
        else await route.fulfill({ status: 500, json: { error: 'server_error', message: 'Something went wrong' } });
    });
    return release;
}

test('screenshots: nothing is sent while an attached image is still being read', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const posts: string[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments') posts.push(request.url());
    });

    // A comment: neither Enter nor the button sends the automatic screenshot in its place
    const draft = await startComment(page, 'Wait for my picture.', page.getByRole('heading', { level: 1 }));
    let release = await holdImageReading(page);
    await draft.locator('input[type="file"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from(pngImage.split(',')[1]!, 'base64') });
    await expect(draft.getByRole('status').filter({ hasText: 'Reading your image...' })).toBeAttached();
    await expect(draft.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    await draft.getByRole('textbox', { name: 'Comment' }).press('Enter');
    await release();
    await expect(draft.getByRole('button', { name: 'Remove attached image evidence.png' })).toBeVisible();
    expect(posts).toHaveLength(0);
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toHaveText('Wait for my picture.', { useInnerText: true });
    const body = nextCreatedComment(page);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    expect((await body).screenshot).toBe(pngImage);
    await expect(page.getByRole('status').filter({ hasText: 'Comment posted' })).toBeAttached();

    // Feedback, with a pasted image
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    const textbox = dialog.getByRole('textbox');
    await textbox.fill('Wait for this one too.');
    release = await holdImageReading(page);
    await pasteImage(textbox, pngImage);
    await expect(dialog.getByRole('status').filter({ hasText: 'Reading your image...' })).toBeAttached();
    await expect(dialog.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    await textbox.press('Enter');
    await release();
    await expect(dialog.getByRole('button', { name: 'Remove attached image image.png' })).toBeVisible();
    expect(posts).toHaveLength(1);
    await expect(textbox).toHaveText('Wait for this one too.', { useInnerText: true });
    const feedback = nextCreatedComment(page);
    await textbox.press('Enter');
    expect((await feedback).screenshot).toBe(pngImage);
    await context.close();
});

test('screenshots: an attached image belongs to the feedback it was sent with', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    const openFeedback = async () => {
        await expect(dialog).toBeHidden();
        await toolbar(page).getByRole('button', { name: 'Send feedback' }).click();
    };
    const textbox = dialog.getByRole('textbox');
    const send = dialog.getByRole('button', { name: 'Send feedback' });
    const removeButton = (name: string) => dialog.getByRole('button', { name: `Remove attached image ${name}` });
    const second = { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(pngImage.split(',')[1]!, 'base64') };

    // Not sent, nothing newer: the text and the image are back in the form
    await openFeedback();
    await textbox.fill('Kept with its image.');
    await pasteImage(textbox, pngImage);
    await expect(removeButton('image.png')).toBeVisible();
    let release = await holdNextPost(page, 'fail');
    await send.click();
    await expect(dialog).toBeHidden();
    release();
    await openFeedback();
    await expect(textbox).toHaveText('Kept with its image.', { useInnerText: true });
    await expect(removeButton('image.png')).toBeVisible();

    // Opened again while it is on its way: a clean form, and the image attached there stays when it is saved
    release = await holdNextPost(page, 'save');
    const sent = nextCreatedComment(page);
    await send.click();
    expect((await sent).screenshot).toBe(pngImage);
    await openFeedback();
    await expect(removeButton('image.png')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'false');
    await dialog.locator('input[type="file"]').setInputFiles(second);
    await expect(removeButton('second.png')).toBeVisible();
    release();
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
    await expect(removeButton('second.png')).toBeVisible();

    // Not sent, with a newer image attached meanwhile: the newer one stays
    await textbox.fill('Sent with the second image.');
    release = await holdNextPost(page, 'fail');
    const failing = nextCreatedComment(page);
    await send.click();
    expect((await failing).screenshot).toBe(pngImage);
    await openFeedback();
    await expect(removeButton('second.png')).toHaveCount(0);
    await pasteImage(textbox, pngImage);
    await expect(removeButton('image.png')).toBeVisible();
    release();
    await expect(textbox).toHaveText('Sent with the second image.', { useInnerText: true });
    await expect(removeButton('image.png')).toBeVisible();
    await expect(removeButton('second.png')).toHaveCount(0);
    await context.close();
});
