import { expect, test, type Page } from '@playwright/test';
import { commentBubble, commentBubbles, isolatedOrigin, newVisitor, openLanding, openThread } from './support/toolbar';

type Box = { x: number; y: number; width: number; height: number };
const inside = (box: Box, x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

/**
 * Add comment, then a click on `selector`'s element: the new comment's composer. On uier's own
 * pages an open thread stays open while pointing (it can be commented on too), so the click is on a
 * part of the element the thread does not cover.
 */
async function pointAt(page: Page, selector: string) {
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const box = (await page.locator(selector).first().boundingBox())!;
    const threads = await Promise.all((await page.getByRole('dialog', { name: 'Comment thread', exact: true }).all()).map(thread => thread.boundingBox()));
    const points = [0.5, 0.15, 0.85].flatMap(y => [20, box.width / 2, box.width - 20].map(x => [box.x + x, box.y + box.height * y] as const));
    const [x, y] = points.find(([x, y]) => !threads.some(thread => thread && inside(thread, x, y))) ?? points[0]!;
    await page.mouse.click(x, y);
    return page.getByRole('dialog', { name: 'New comment', exact: true });
}

test('a new comment after closing a thread is its own pin, never a reply', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });

    const first = await pointAt(page, 'h1');
    await page.keyboard.type('The heading could be shorter.');
    await page.keyboard.press('Enter');
    // The saved thread opens with the focus in its reply box
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await expect(first).toBeHidden();

    const second = await pointAt(page, 'main p');
    await expect(second.getByRole('textbox', { name: 'Comment', exact: true })).toBeFocused();
    await page.keyboard.type('This sentence is long.');
    await page.keyboard.press('Enter');

    await expect(commentBubbles(page)).toHaveCount(2);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await expect(commentBubble(page, 1, 2)).toBeVisible();
    await expect(openThread(page)).toContainText('This sentence is long.');
    await expect(openThread(page)).not.toContainText('The heading could be shorter.');
    await context.close();
});

test('Add comment while a thread is open starts a new comment', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });

    await pointAt(page, 'h1');
    await page.keyboard.type('The heading could be shorter.');
    await page.keyboard.press('Enter');
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();

    // The thread is still open: on uier's own pages it stays open while pointing, and closes once a
    // new comment is started on the page
    const second = await pointAt(page, 'main p');
    await expect(thread).toBeHidden();
    await expect(second.getByRole('textbox', { name: 'Comment', exact: true })).toBeFocused();
    await page.keyboard.type('This sentence is long.');
    await page.keyboard.press('Enter');
    await expect(commentBubbles(page)).toHaveCount(2);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await expect(commentBubble(page, 1, 2)).toBeVisible();

    // From the keyboard too, with the focus on the pin the closed thread returned it to
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await commentBubble(page, 1, 1).click();
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await page.getByRole('button', { name: 'Add comment', exact: true }).focus();
    await page.keyboard.press('Enter');
    const third = page.getByRole('dialog', { name: 'New comment', exact: true });
    await expect(third.getByRole('textbox', { name: 'Comment', exact: true })).toBeFocused();
    await page.keyboard.type('A third one.');
    await page.keyboard.press('Enter');
    await expect(commentBubbles(page)).toHaveCount(3);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await context.close();
});

test('posting keeps one popover open: the draft goes on as its thread, without closing and opening again', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    // The comment stays on its way until released
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname === '/api/comments', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        await held;
        await route.fallback();
    });

    const draft = await pointAt(page, 'h1');
    await page.keyboard.type('The heading could be shorter.');
    // From now on, every change in the toolbar has a popover of the comment on the page
    await page.evaluate(() => {
        const root = document.querySelector('#uier-toolbar')!.shadowRoot!;
        const state = window as unknown as { uierPopoverGaps: number };
        state.uierPopoverGaps = 0;
        const check = () => {
            const popovers = [...root.querySelectorAll('[role="dialog"]')].filter(dialog =>
                ['New comment', 'Sending comment', 'Comment thread'].includes(dialog.getAttribute('aria-label') ?? ''));
            if (!popovers.some(popover => popover.getBoundingClientRect().width > 0)) state.uierPopoverGaps++;
        };
        new MutationObserver(check).observe(root, { childList: true, subtree: true, attributes: true });
    });
    await page.keyboard.press('Enter');

    // At once: the comment's thread, its reply box (with the focus) waiting until it is saved, not animated in
    const sending = page.getByRole('dialog', { name: 'Sending comment', exact: true });
    await expect(sending).toContainText('The heading could be shorter.');
    await expect(draft).toHaveCount(0);
    const reply = sending.getByRole('textbox', { name: 'Reply', exact: true });
    await expect(reply).toBeFocused();
    await expect(reply).not.toBeEditable();
    expect(await sending.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await sending.evaluate(element => element.setAttribute('data-e2e-continued', ''));

    // Saved: the same popover, now the saved thread, its reply box ready
    release();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread).toHaveAttribute('data-e2e-continued', '');
    const ready = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await expect(ready).toBeEditable();
    await expect(ready).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Comment posted' })).toBeAttached();
    expect(await page.evaluate(() => (window as unknown as { uierPopoverGaps: number }).uierPopoverGaps)).toBe(0);

    // Opened again later, it animates as any thread does
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await commentBubble(page, 1).click();
    expect(await thread.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
    await context.close();
});
