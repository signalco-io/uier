import { expect, test, type Page } from '@playwright/test';
import { commentBubble, isolatedOrigin, newVisitor, openLanding } from './support/toolbar';

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
    expect(stackBox.x).toBeGreaterThanOrEqual(shape.x + shape.width);
    expect(Math.abs(stackBox.y + stackBox.height / 2 - (shape.y + shape.height / 2))).toBeLessThan(2);

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
