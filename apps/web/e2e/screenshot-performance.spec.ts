import { expect, test } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding, toolbar } from './support/toolbar';

// Trace snapshots synchronously read every scrollTop themselves, obscuring capture's work.
test.use({ trace: 'off' });

test('screenshots: large-page preparation yields to the browser before scanning every element', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.evaluate(() => {
        const state = { reads: 0, readsAtTurn: -1 };
        Object.assign(window, { screenshotScan: state });
        const scheduler = (window as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler;
        const originalYield = scheduler.yield.bind(scheduler);
        scheduler.yield = async () => {
            await originalYield();
            if (state.reads > 0 && state.readsAtTurn < 0) state.readsAtTurn = state.reads;
        };
        const heavy = document.createElement('section');
        // Below the window so the existing offscreen pruning keeps the rendered image small.
        heavy.style.marginTop = '200vh';
        for (let i = 0; i < 2_000; i++) {
            const node = document.createElement('div');
            node.textContent = `Feedback ${i}`;
            Object.defineProperty(node, 'scrollTop', { get() {
                // Give the synthetic read a small fixed cost so even a fast host crosses a
                // time slice. This checks task ordering, without a wall-clock assertion.
                const start = performance.now();
                while (performance.now() - start < 0.05) { /* simulate a costly layout read */ }
                state.reads++;
                return 0;
            } });
            heavy.appendChild(node);
        }
        document.body.appendChild(heavy);
    });
    await toolbar(page).getByRole('button', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    await dialog.getByRole('textbox').fill('Typing while the screenshot is prepared.');
    await expect.poll(() => page.evaluate(() => (window as unknown as {
        screenshotScan: { reads: number; readsAtTurn: number }
    }).screenshotScan.readsAtTurn)).toBeGreaterThan(0);
    const scan = await page.evaluate(() => (window as unknown as {
        screenshotScan: { reads: number; readsAtTurn: number }
    }).screenshotScan);
    expect(scan.readsAtTurn).toBeLessThan(2_000);
    await expect(dialog.getByRole('status').filter({ hasText: 'A screenshot of the visible page will be attached.' })).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveText('Typing while the screenshot is prepared.', { useInnerText: true });
    expect(await page.locator('[data-uier-screenshot-scroll]').count()).toBe(0);
    await context.close();
});
