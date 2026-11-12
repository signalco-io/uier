import { expect, test, type Locator, type Page } from '@playwright/test';
import { commentBubble, isolatedOrigin, newVisitor, openLanding, openThread } from './support/toolbar';

/** Creates a comment on `/` through the API from the page (visitor cookie and BotID headers) */
async function postComment(page: Page, body: Record<string, unknown>) {
    return await page.evaluate(async (body) => {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', ...body })
        });
        return { status: response.status, body: await response.json() as { id?: string } };
    }, body);
}

async function postReply(page: Page, commentId: string, text: string) {
    return await page.evaluate(async ({ commentId, text }) => {
        const response = await fetch(`/api/comments/${commentId}/replies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        return response.status;
    }, { commentId, text });
}

const preview = (page: Page) => page.getByRole('dialog', { name: 'Comment thread preview', exact: true });

/** Rests the mouse on the middle of `locator` */
async function hover(page: Page, locator: Locator) {
    const box = (await locator.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

test('a pin shows the avatars of the people in its thread, on the side with room (uier #307)', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const created = await postComment(page, { position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'The heading could be shorter.' });
    expect(created.status).toBe(201);
    const commentId = created.body.id!;

    // Three other visitors reply, then the author again: four people
    for (const text of ['Agreed.', 'Maybe four words.', 'Or three.']) {
        const visitor = await newVisitor(browser, testInfo);
        await visitor.page.goto(`${origin}/`);
        expect(await postReply(visitor.page, commentId, text)).toBe(201);
        await visitor.context.close();
    }
    expect(await postReply(page, commentId, 'Three it is.')).toBe(201);
    await page.reload();

    const pin = commentBubble(page, 5, 1);
    await expect(pin).toBeVisible();
    // The pin's text stays its number and count; the people are its description, the author first
    await expect(pin).toHaveText('1 5');
    await expect(pin).toHaveAccessibleDescription(/^In this thread: you, Guest [0-9A-F]{4}, Guest [0-9A-F]{4}, and Guest [0-9A-F]{4}$/);
    // Two avatars and "+2" beside the pin, to its right
    const stack = pin.locator('[data-uier-participants]');
    await expect(stack).toHaveAttribute('data-uier-participants', 'right');
    await expect(stack.locator('[data-uier-participant]')).toHaveCount(2);
    await expect(stack.locator('[data-uier-participant]').first()).toHaveAttribute('data-uier-participant', /^[0-9A-F]{2}$/);
    await expect(stack.locator('[data-uier-participants-more]')).toHaveAttribute('data-uier-participants-more', '+2');
    const shape = (await pin.locator('svg').boundingBox())!;
    const stackBox = (await stack.boundingBox())!;
    // Tucked partly under the pin, behind it, the author in front of the others (uier #317)
    expect(stackBox.x).toBeLessThan(shape.x + shape.width);
    expect(stackBox.x).toBeGreaterThan(shape.x + shape.width / 2);
    expect(Math.abs(stackBox.y + stackBox.height / 2 - (shape.y + shape.height / 2))).toBeLessThan(2);
    const layers = await stack.locator('[data-uier-participant], [data-uier-participants-more]')
        .evaluateAll(avatars => avatars.map(avatar => Number(getComputedStyle(avatar).zIndex)));
    expect(layers).toEqual([...layers].sort((a, b) => b - a));
    expect(new Set(layers).size).toBe(layers.length);
    // A hovered pin slides them out a little, still overlapping
    if (!testInfo.project.use.hasTouch) {
        const avatars = stack.locator('[data-uier-participant]');
        const before = (await avatars.first().boundingBox())!;
        await pin.hover();
        await expect.poll(async () => (await avatars.first().boundingBox())!.x).toBeGreaterThan(before.x + 4);
        const [first, second] = [(await avatars.first().boundingBox())!, (await avatars.nth(1).boundingBox())!];
        expect(second.x).toBeLessThan(first.x + first.width);
        await page.mouse.move(0, 0);
    }

    // Near the right edge, the avatars go on the pin's left and stay in the window
    const edge = await postComment(page, { position: { type: 'point', selector: 'main>section:nth-of-type(2)', xNormal: 0.99, yNormal: 0.1 }, text: 'Near the edge.' });
    expect(edge.status).toBe(201);
    await page.reload();
    const edgePin = page.getByRole('button', { name: 'Comment #2, 1 message', exact: true });
    // Pins are fixed: the page scrolls the point to the middle of the window
    await page.evaluate(() => {
        const rect = document.querySelector('main>section:nth-of-type(2)')!.getBoundingClientRect();
        window.scrollBy({ top: rect.top + rect.height * 0.1 - window.innerHeight / 2, behavior: 'instant' });
    });
    const edgeStack = edgePin.locator('[data-uier-participants]');
    await expect(edgeStack).toHaveAttribute('data-uier-participants', 'left');
    await expect(edgeStack.locator('[data-uier-participant]')).toHaveCount(1);
    await expect(edgeStack).toBeInViewport({ ratio: 1 });
    await expect(edgePin).toHaveAccessibleDescription('In this thread: you');

    await context.close();
});

test('resting the mouse on a pin previews its thread; a click keeps it open with the reply box (uier #308)', async ({ browser }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'A mouse only: a tap opens the thread at once');
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const created = await postComment(page, { position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'The heading could be shorter.' });
    expect(created.status).toBe(201);
    expect(await postReply(page, created.body.id!, 'And bolder.')).toBe(201);
    await page.reload();
    const pin = commentBubble(page, 2, 1);
    await expect(pin).toBeVisible();

    // Read-only, the focus where it was, and gone once the pointer leaves
    await hover(page, pin);
    await expect(preview(page)).toBeVisible();
    await expect(preview(page)).toContainText('The heading could be shorter.');
    await expect(preview(page)).toContainText('And bolder.');
    await expect(preview(page).getByRole('textbox')).toHaveCount(0);
    // Without its controls (copy, options, add reaction ...), which keep their place (uier #320),
    // except the status, which shows (uier #322)
    const previewControls = preview(page).locator('[data-uier-thread-control]:not([data-uier-status])');
    await expect(previewControls.first()).toBeAttached();
    for (const control of await previewControls.all()) await expect(control).toHaveCSS('opacity', '0');
    for (const status of await preview(page).locator('[data-uier-status]').all()) await expect(status).toHaveCSS('opacity', '1');
    await expect(openThread(page).filter({ has: page.getByRole('textbox', { name: 'Reply' }) })).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.mouse.move(5, 5, { steps: 4 });
    await expect(preview(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    // Moving from the pin into the preview keeps it; a click in it opens the thread with its reply box
    await hover(page, pin);
    await expect(preview(page)).toBeVisible();
    await hover(page, preview(page));
    await page.waitForTimeout(400);
    await expect(preview(page)).toBeVisible();
    await page.mouse.down();
    await page.mouse.up();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    // The controls come back, fading in
    await expect(thread.locator('[data-uier-controls-reveal]')).toBeAttached();
    await expect(thread.getByRole('button', { name: 'Thread options' })).toHaveCSS('opacity', '1');
    await expect(preview(page)).toHaveCount(0);
    // It stays open when the pointer leaves
    await page.mouse.move(5, 5, { steps: 4 });
    await page.waitForTimeout(400);
    await expect(thread).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();

    // A click on the pin while previewing opens the thread too
    await hover(page, pin);
    await expect(preview(page)).toBeVisible();
    await pin.click();
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();

    await context.close();
});

test('a tap on a pin opens its thread at once, without a preview (uier #308)', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'Touch only');
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const created = await postComment(page, { position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'The heading could be shorter.' });
    expect(created.status).toBe(201);
    await page.reload();

    await commentBubble(page, 1, 1).tap();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeVisible();
    await expect(preview(page)).toHaveCount(0);

    await context.close();
});

test('the pointer in a long thread\'s preview scrolls it to its last message (uier #322)', async ({ browser }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'A mouse only: a tap opens the thread at once');
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await page.setViewportSize({ width: 1280, height: 600 });
    await openLanding(page, origin, { dismissHint: true });
    const created = await postComment(page, { position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'The heading could be shorter.' });
    expect(created.status).toBe(201);
    const replies = Array.from({ length: 12 }, (_, index) => `Reply ${index + 1}: ${'a longer thought about the heading '.repeat(3)}`);
    for (const text of replies) expect(await postReply(page, created.body.id!, text)).toBe(201);
    await page.reload();
    const pin = commentBubble(page, 13, 1);
    await expect(pin).toBeVisible();

    await hover(page, pin);
    await expect(preview(page)).toBeVisible();
    // Every message, not "Show all" (which it could not press), bounded by the window
    await expect(preview(page).getByText(/^Reply \d+:/)).toHaveCount(12);
    expect((await preview(page).boundingBox())!.height).toBeLessThanOrEqual(600);
    const last = preview(page).getByText(/^Reply 12:/);
    await expect(last).not.toBeInViewport();
    // The wheel over the preview scrolls the thread, not the page
    await hover(page, preview(page));
    const scrollY = await page.evaluate(() => window.scrollY);
    for (let index = 0; index < 10; index++) await page.mouse.wheel(0, 400);
    await expect(last).toBeInViewport();
    await expect(preview(page)).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Opened from the preview, the thread keeps every message, its reply box focused
    await page.mouse.down();
    await page.mouse.up();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(thread.getByText(/^Reply \d+:/)).toHaveCount(12);

    await context.close();
});
