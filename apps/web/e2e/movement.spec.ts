import { expect, test, type Locator, type Page } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

/** Browser-generated touch events, including pointer capture; synthetic DOM events miss scrolling/cancel behavior. */
async function drag(page: Page, handle: Locator, target: { x: number; y: number }, touch: boolean) {
    const box = (await handle.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (touch) {
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        for (let step = 1; step <= 8; step++) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (target.x - start.x) * step / 8, y: start.y + (target.y - start.y) * step / 8 }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
    } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await page.mouse.up();
    }
}

async function expectInsideViewport(page: Page) {
    await expect.poll(async () => {
        const box = await toolbar(page).boundingBox();
        const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        return Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1);
    }).toBe(true);
}

test('toolbar moves with mouse or touch, persists and stays reachable after collapse and resize', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    const origin = isolatedOrigin(testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const handle = page.getByRole('button', { name: 'Move toolbar', exact: true });
    const before = (await toolbar(page).boundingBox())!;
    await drag(page, handle, { x: 80, y: 150 }, Boolean(testInfo.project.use.hasTouch));
    await expect.poll(async () => (await toolbar(page).boundingBox())!.y).toBeLessThan(before.y - 100);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectInsideViewport(page);
    const stored = await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'));
    expect(stored).not.toBeNull();
    await page.getByRole('button', { name: 'Collapse toolbar' }).click();
    await expect(handle).toBeVisible();
    await expectInsideViewport(page);
    await page.getByRole('button', { name: 'Expand toolbar' }).click();
    await page.reload();
    await expect(handle).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).toBe(stored);
    await page.setViewportSize({ width: 320, height: 480 });
    await expectInsideViewport(page);
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Reset toolbar position' }).click();
    await expect(handle).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).toBeNull();
    await expectInsideViewport(page);
    await handle.press('ArrowUp');
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).not.toBeNull();
    await handle.press('Home');
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).toBeNull();
    await context.close();
});

test('inbox docks on either side with mouse or touch without losing filters or reply text', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.setViewportSize({ width: 1000, height: 800 });
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.evaluate(async () => {
        await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0 }, text: 'Keep this discussion.' }) });
    });
    await page.reload();
    await page.locator('[data-uier-comment]').click();
    await openThread(page).getByRole('textbox', { name: 'Reply' }).fill('Unsent panel reply');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    const handle = inbox.getByRole('button', { name: 'Move comments panel' });
    await inbox.getByRole('searchbox').fill('discussion');
    await drag(page, handle, { x: 70, y: 100 }, Boolean(testInfo.project.use.hasTouch));
    await expect(inbox).toHaveAttribute('data-side', 'left');
    await expect.poll(async () => (await inbox.boundingBox())!.x).toBeLessThan(30);
    await expect(inbox.getByRole('searchbox')).toHaveValue('discussion');
    await drag(page, handle, { x: 920, y: 100 }, Boolean(testInfo.project.use.hasTouch));
    await expect(inbox).toHaveAttribute('data-side', 'right');
    await inbox.getByRole('button', { name: 'Move to left side' }).click();
    await expect(inbox).toHaveAttribute('data-side', 'left');
    await handle.press('ArrowRight');
    await expect(inbox).toHaveAttribute('data-side', 'right');
    await page.setViewportSize({ width: 393, height: 650 });
    await expect(inbox).toHaveAttribute('data-side', 'right');
    await expect.poll(async () => (await inbox.boundingBox())!.x).toBeLessThan(30);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(async () => (await inbox.boundingBox())!.x).toBeGreaterThan(600);
    await expectNoAxeViolations(page);
    await inbox.getByRole('button', { name: 'Show on page' }).click();
    await expect(openThread(page).getByRole('textbox', { name: 'Reply' })).toHaveValue('Unsent panel reply');
    await page.reload();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(inbox).toHaveAttribute('data-side', 'right');
    await context.close();
});

test('canceling a drag leaves its saved placement intact', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const handle = page.getByRole('button', { name: 'Move toolbar', exact: true });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(80, 120, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).toBeNull();
    await expectInsideViewport(page);
    await context.close();
});
