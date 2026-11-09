import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

async function middleOf(target: Locator): Promise<[number, number]> {
    const box = (await target.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2];
}

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

type Box = { x: number; y: number; width: number; height: number };

/** Whether `inner`'s middle is inside `outer`, with `margin` pixels around it (a pin is beside its anchor's corner) */
function contains(outer: Box, inner: Box, margin = 0) {
    const x = inner.x + inner.width / 2;
    const y = inner.y + inner.height / 2;
    return x >= outer.x - margin && x <= outer.x + outer.width + margin && y >= outer.y - margin && y <= outer.y + outer.height + margin;
}

/** A pin of a comment in a closed popover or panel is beside the button that opens it */
async function expectBeside(pin: Locator, opener: Locator) {
    await expect.poll(async () => contains((await opener.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);
}

type SavedComment = { id: string; number: number; position: { selector: string; layer?: { opener: string; label?: string; nested?: string[] } }; screenshot?: { width: number; height: number } };

/** Writes the open new comment and sends it: the saved comment, whose thread opens */
async function send(page: Page, text: string) {
    const response = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/comments');
    const composer = page.getByRole('dialog', { name: 'New comment', exact: true }).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();
    await composer.fill(text);
    await composer.press('Enter');
    const saved = await response;
    expect(saved.status()).toBe(201);
    return await saved.json() as SavedComment;
}

/** A saved thread's popover, by a message in it (several can be open) */
const threadWith = (page: Page, text: string) => page.getByRole('dialog', { name: 'Comment thread', exact: true }).filter({ hasText: text });

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
    await expect(openThread(page).getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toHaveCount(0);
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
    await expect(openThread(page).getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(inbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toHaveCount(0);
    await expect(inbox).toBeVisible();
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    const initialX = (await pin.boundingBox())!.x;
    const handle = inbox.getByRole('button', { name: 'Move comments panel' });
    if (!testInfo.project.use.hasTouch) {
        await handle.focus();
        await handle.press('ArrowLeft');
        await expect.poll(async () => (await pin.boundingBox())!.x).toBeLessThan(initialX - 100);
    }
    // The inbox is its opener: while it is closed, the pin is beside the Inbox button
    expect(comment.position).toMatchObject({ layer: { opener: expect.stringMatching(/^#uier-toolbar>>>#uier-feedback-toolbar>/), label: 'Inbox' } });
    await inbox.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(pin).toBeVisible();
    await expectBeside(pin, toolbar(page).getByRole('button', { name: /^Inbox/ }));
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    await expect(pin).toBeVisible();
    await expect.poll(async () => contains((await search.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);

    // Keyboard Add comment uses the last focused inbox element, across the shadow boundary.
    await search.focus();
    await toolbar(page).getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    const second = await postDraft(page, 'A keyboard review of search.');
    expect(second.position.selector).toBe(comment.position.selector);
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: 'to pin a comment' })).toHaveCount(0);
    await expect(inbox).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Add comment' })).toBeFocused();
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    const cancel = page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeVisible();
    await animationsFinished(cancel);
    await expectNoAxeViolations(page);
    await cancel.click();
    await expect(page.getByRole('status').filter({ hasText: 'to pin a comment' })).toHaveCount(0);
    await expect(toolbar(page).getByRole('button', { name: 'Add comment' })).toBeFocused();
    await expect(openThread(page)).toHaveCount(0);
    await context.close();
});

test('uier pages can comment on an open thread: it stays open, and the comment opens it again with its pin', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    const origin = isolatedOrigin(testInfo);
    await openLanding(page, origin, { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await page.mouse.click(...await middleOf(page.getByRole('heading', { level: 1 })));
    const first = await send(page, 'The heading could be shorter.');
    const thread = threadWith(page, 'The heading could be shorter.');
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeFocused();

    // Add comment keeps the thread open, and its parts can be pointed at like the page
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await expect(thread).toBeVisible();
    const copy = thread.getByRole('button', { name: 'Copy', exact: true });
    await pointAt(page, copy);
    await expect(page.getByRole('dialog', { name: 'Copy', exact: true })).toHaveCount(0);
    await expect(thread).toBeVisible();
    const comment = await send(page, 'Name what Copy copies.');
    expect(comment.position.selector).toMatch(/^#uier-toolbar>>>div\.uier-thread>/);
    expect(comment.position.layer).toEqual({ opener: `#uier-toolbar>>>#uier-pin-${first.id}`, label: `Comment #${first.number}` });
    expect(comment.screenshot).toBeDefined();
    // Its own thread opens on the thread it is about, which stays open
    const reply = threadWith(page, 'Name what Copy copies.');
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(thread).toBeVisible();
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    await expect.poll(async () => contains((await copy.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);

    // Closed, the comment's pin is beside the pin that opens the thread
    await page.keyboard.press('Escape');
    await expect(reply).toHaveCount(0);
    await expect(thread).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thread).toHaveCount(0);
    const firstPin = page.locator(`[data-uier-comment="${first.id}"]`);
    await expectBeside(pin, firstPin);
    await pin.click();
    await expect(reply.getByText(`Open “Comment #${first.number}” to see the comment in place.`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reply).toHaveCount(0);

    // A link to the comment opens the thread first, then the comment on its part
    await page.goto(`${origin}/?uier-comment=${comment.id}`);
    await expect(thread).toBeVisible();
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(reply.getByText('to see the comment in place')).toHaveCount(0);
    await expect.poll(async () => contains((await copy.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);
    await context.close();
});

test('uier pages can comment on a menu inside an open thread, and the comment opens both again', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    const origin = isolatedOrigin(testInfo);
    await openLanding(page, origin, { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await page.mouse.click(...await middleOf(page.getByRole('heading', { level: 1 })));
    const first = await send(page, 'The heading could be shorter.');
    const thread = threadWith(page, 'The heading could be shorter.');
    const copy = thread.getByRole('button', { name: 'Copy', exact: true });
    await copy.click();
    const copyMenu = page.getByRole('dialog', { name: 'Copy', exact: true });
    const copyIssue = copyMenu.getByRole('button', { name: /^Copy issue/ });
    await expect(copyIssue).toBeVisible();
    await animationsFinished(copyMenu);

    // Both the thread and its Copy menu stay open while Copy issue is pointed at and commented on
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await pointAt(page, copyIssue);
    const comment = await send(page, 'Say where the issue is copied to.');
    expect(comment.position.selector).toMatch(/^#uier-toolbar>>>div\.uier-copy-menu>/);
    expect(comment.position.layer).toEqual({
        opener: `#uier-toolbar>>>#uier-pin-${first.id}`,
        label: `Comment #${first.number}`,
        nested: [expect.stringMatching(/^#uier-toolbar>>>div\.uier-thread>/)]
    });
    const reply = threadWith(page, 'Say where the issue is copied to.');
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(copyMenu).toBeVisible();
    await expect(thread).toBeVisible();
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    await expect.poll(async () => contains((await copyIssue.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);

    // Closed layer by layer, the pin moves to the opener of the closed one
    await page.keyboard.press('Escape');
    await expect(reply).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(copyMenu).toHaveCount(0);
    await expect(thread).toBeVisible();
    await expectBeside(pin, copy);
    await page.keyboard.press('Escape');
    await expect(thread).toHaveCount(0);
    await expectBeside(pin, page.locator(`[data-uier-comment="${first.id}"]`));

    // A link to the comment opens the thread, then its Copy menu, then the comment on Copy issue
    await page.goto(`${origin}/?uier-comment=${comment.id}`);
    await expect(thread).toBeVisible();
    await expect(copyMenu).toBeVisible();
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(reply.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'exact');
    await expect.poll(async () => contains((await copyIssue.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);
    await context.close();
});

test('uier pages can comment on a toolbar popover, which Show on page opens again', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Options' }).click();
    const options = page.getByRole('dialog', { name: 'Options', exact: true });
    const poweredBy = options.getByRole('link', { name: 'Powered by uier' });
    await expect(poweredBy).toBeVisible();
    await animationsFinished(options);
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    await expect(options).toBeVisible();
    await pointAt(page, poweredBy);
    const comment = await send(page, 'Say where this link goes.');
    expect(comment.position.selector).toMatch(/^#uier-toolbar>>>div\.uier-options>/);
    expect(comment.position.layer).toEqual({ opener: expect.stringMatching(/^#uier-toolbar>>>#uier-feedback-toolbar>/), label: 'Options' });
    const reply = threadWith(page, 'Say where this link goes.');
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(options).toBeVisible();
    // Escape closes the comment's thread, then the options
    await page.keyboard.press('Escape');
    await expect(reply).toHaveCount(0);
    await expect(options).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0);
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    await expectBeside(pin, toolbar(page).getByRole('button', { name: 'Options' }));

    // Show on page opens the options, then the thread on the link
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await inbox.getByRole('article').filter({ hasText: 'Say where this link goes.' })
        .getByRole('button', { name: 'Show on page' }).click();
    await expect(options).toBeVisible();
    await expect(reply.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect.poll(async () => contains((await poweredBy.boundingBox())!, (await pin.boundingBox())!, 40)).toBe(true);
    await context.close();
});
