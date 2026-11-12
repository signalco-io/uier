import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { commentBubble, commentBubbles, isolatedOrigin, newVisitor, openLanding, openThread } from './support/toolbar';

/** A point comment on the first element matching `target`, saved by its exact `nth-of-type` path */
async function postComment(page: Page, target: string, text: string, xNormal = 0.5) {
    return await page.evaluate(async ({ target, text, xNormal }) => {
        const parts: string[] = [];
        for (let node = document.querySelector(target); node && node !== document.documentElement; node = node.parentElement) {
            const siblings = [...node.parentElement!.children].filter(other => other.tagName === node!.tagName);
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
        const selector = parts.join('>');
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', position: { type: 'point', selector, xNormal, yNormal: 0.5 }, text })
        });
        return response.status;
    }, { target, text, xNormal });
}

/** The box of an element's own text (the number fills the pin, its digits do not) */
async function textBox(locator: Locator) {
    return await locator.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const { x, y, width, height } = range.getBoundingClientRect();
        return { x, y, width, height };
    });
}

/** The pin shows the number in its middle and the message count, from two on, as its corner badge */
async function expectPinMarks(pin: Locator, number: number, messages?: number) {
    const shape = (await pin.locator('svg').boundingBox())!;
    const centre = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    const digits = await textBox(pin.getByText(String(number), { exact: true }));
    expect(Math.abs(digits.x + digits.width / 2 - centre.x)).toBeLessThan(3);
    expect(Math.abs(digits.y + digits.height / 2 - centre.y)).toBeLessThan(3);
    if (messages === undefined) {
        await expect(pin).toHaveText(String(number));
        return;
    }
    await expect(pin).toHaveText(`${number} ${messages}`);
    // On the top-right corner, past the pin's edge, clear of the digits
    const badge = (await pin.getByText(String(messages), { exact: true }).boundingBox())!;
    expect(badge.x).toBeGreaterThan(digits.x + digits.width - 1);
    expect(badge.y).toBeLessThan(shape.y);
    expect(badge.x + badge.width).toBeGreaterThan(shape.x + shape.width);
}

test('pins keep their issue number after replies; the message count is a separate badge', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    expect(await postComment(page, 'h1', 'The heading could be shorter.')).toBe(201);
    expect(await postComment(page, 'main p', 'This sentence is long.')).toBe(201);
    // On the same element as #1: overlapping pins stay apart by their numbers
    expect(await postComment(page, 'h1', 'And bolder.')).toBe(201);
    await page.reload();

    await expect(commentBubbles(page)).toHaveCount(3);
    const first = page.getByRole('button', { name: 'Comment #1, 1 message', exact: true });
    await expectPinMarks(first, 1);
    await expectPinMarks(page.getByRole('button', { name: 'Comment #2, 1 message', exact: true }), 2);
    await expect(page.getByRole('button', { name: 'Comment #3, 1 message', exact: true })).toBeVisible();

    // Replies change the count, never the number
    await first.click();
    const thread = openThread(page);
    await expect(thread.getByText('Comment #1', { exact: true })).toBeVisible();
    const reply = thread.getByRole('textbox', { name: 'Reply' });
    await reply.fill('Agreed.');
    await reply.press('Enter');
    await expect(commentBubble(page, 2, 1)).toBeVisible();
    await reply.fill('Maybe four words.');
    await reply.press('Enter');
    const replied = page.getByRole('button', { name: 'Comment #1, 3 messages', exact: true });
    await expect(replied).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await expectPinMarks(replied, 1, 3);

    // After a reload too, and the inbox lists it under the same number
    await page.reload();
    await expectPinMarks(page.getByRole('button', { name: 'Comment #1, 3 messages', exact: true }), 1, 3);
    await expectPinMarks(page.getByRole('button', { name: 'Comment #2, 1 message', exact: true }), 2);
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('article', { name: 'Comment #1' })).toContainText('Maybe four words.');

    await context.close();
});

test('pins on the same or nearby spots move apart, each whole and pressable (uier #367)', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    // Three on the same spot, one a few pixels beside them
    for (const text of ['First.', 'Second.', 'Third.']) expect(await postComment(page, 'h1', text)).toBe(201);
    const near = await page.locator('h1').evaluate(element => 0.5 + 6 / element.getBoundingClientRect().width);
    expect(await postComment(page, 'h1', 'Fourth.', near)).toBe(201);
    await page.reload();

    const pins = [1, 2, 3, 4].map(number => page.getByRole('button', { name: `Comment #${number}, 1 message`, exact: true }));
    await expect(commentBubbles(page)).toHaveCount(4);
    // Each pin and the avatar beside it, clear of every other pin
    const boxes = await Promise.all(pins.map(async pin => {
        const shape = (await pin.locator('svg').boundingBox())!;
        const people = (await pin.locator('[data-uier-participants]').boundingBox())!;
        const left = Math.min(shape.x, people.x);
        const right = Math.max(shape.x + shape.width, people.x + people.width);
        return { left, right, top: shape.y, bottom: shape.y + shape.height };
    }));
    for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
            expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, JSON.stringify([a, b])).toBe(true);
        }
    }
    // The oldest stays on its spot, 16 px below and right of the anchor
    const anchor = (await page.locator('h1').boundingBox())!;
    const first = (await pins[0]!.locator('svg').boundingBox())!;
    expect(Math.abs(first.x + first.width / 2 - (anchor.x + anchor.width / 2 + 16))).toBeLessThan(2);

    // Each opens its own thread: nothing covers it
    for (const [index, pin] of pins.entries()) {
        await pin.click();
        const thread = openThread(page);
        await expect(thread.getByText(`Comment #${index + 1}`, { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(thread).toBeHidden();
    }

    await context.close();
});
