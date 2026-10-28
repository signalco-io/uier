import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';

async function clipboard(page: import('@playwright/test').Page) {
    await page.addInitScript(() => {
        Object.assign(window, { copiedIssue: '', rejectClipboard: false });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async (value: string) => {
                if ((window as unknown as { rejectClipboard: boolean }).rejectClipboard) throw new Error('Denied');
                (window as unknown as { copiedIssue: string }).copiedIssue = value;
            }
        } });
    });
}

async function copyWithConfirmation(page: Page, thread: Locator, testInfo: TestInfo, screenshot: string) {
    await animationsFinished(thread);
    const originalHeight = (await thread.boundingBox())!.height;
    const button = thread.getByRole('button', { name: 'Copy issue', exact: true });
    await button.click();
    const confirmation = button.locator('..').getByText('Issue copied.', { exact: true });
    await expect(confirmation).toBeVisible();
    await animationsFinished(confirmation);
    const buttonBox = (await button.boundingBox())!;
    const confirmationBox = (await confirmation.boundingBox())!;
    expect(confirmationBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
    expect(confirmationBox.y - buttonBox.y - buttonBox.height).toBeLessThanOrEqual(8);
    expect(confirmationBox.x).toBeGreaterThanOrEqual(0);
    expect(confirmationBox.x + confirmationBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect((await thread.boundingBox())!.height).toBeCloseTo(originalHeight, 0);
    await expect(page.getByRole('status').filter({ hasText: /^Issue copied$/ })).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(screenshot) });
    await expect(confirmation).toBeHidden({ timeout: 4000 });
}

for (const colorScheme of ['light', 'dark'] as const) {
    test(`toolbar copy succeeds, provides a manual fallback and rejects stale deleted feedback in ${colorScheme}`, async ({ browser }, testInfo) => {
        const { context, page } = await newVisitor(browser, testInfo);
        await page.emulateMedia({ colorScheme });
        await clipboard(page);
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const saved = await page.evaluate(async () => (await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Saved issue\nwith exact details'
        }) })).json()) as { id: string; number: number };
        await page.reload();
        await page.locator('[data-uier-comment]').click();
        let thread = openThread(page);
        await copyWithConfirmation(page, thread, testInfo, `toolbar-copy-success-${colorScheme}.png`);
        const copied = await page.evaluate(() => (window as unknown as { copiedIssue: string }).copiedIssue);
        expect(copied).toContain('Saved issue\nwith exact details');
        expect(copied).toContain('No saved image is available.');
        await page.keyboard.press('Escape');
        await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
        thread = page.getByRole('complementary', { name: 'Comments' })
            .getByRole('article', { name: `Comment #${saved.number}`, exact: true });
        await copyWithConfirmation(page, thread, testInfo, `inbox-copy-success-${colorScheme}.png`);
        await page.evaluate(() => { (window as unknown as { rejectClipboard: boolean }).rejectClipboard = true; });
        await thread.getByRole('button', { name: 'Copy issue', exact: true }).click();
        const manual = thread.getByRole('textbox', { name: 'Issue Markdown' });
        await expect(manual).toHaveValue(copied);
        await expect(thread.getByText('Issue copied.', { exact: true })).toHaveCount(0);
        await manual.focus();
        expect(await manual.evaluate(element => (element as HTMLTextAreaElement).selectionEnd - (element as HTMLTextAreaElement).selectionStart)).toBe(copied.length);
        await expectNoAxeViolations(page);
        await page.screenshot({ path: testInfo.outputPath(`toolbar-copy-${colorScheme}.png`) });
        await thread.getByRole('button', { name: 'Close copy text' }).click();
        await page.evaluate(async id => { await fetch(`/api/comments/${id}`, { method: 'DELETE' }); }, saved.id);
        await thread.getByRole('button', { name: 'Copy issue', exact: true }).click();
        await expect(thread.getByRole('alert')).toContainText('This comment no longer exists');
        await expect(thread.getByRole('textbox', { name: 'Issue Markdown' })).toHaveCount(0);
        await context.close();
    });

    test(`app and member toolbar export the same authorized packet in ${colorScheme}`, async ({ page, baseURL }, testInfo) => {
        const site = await startReviewedSite(new URL(baseURL!).origin);
        try {
            await page.emulateMedia({ colorScheme });
            await clipboard(page);
            await signIn(page, uniqueEmail('copy'));
            const projectId = await createProject(page, { urls: [site.origin()], name: 'Issue export' });
            await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
            await expect(toolbar(page)).toBeVisible();
            await page.getByRole('button', { name: 'Add comment', exact: true }).click();
            const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
            await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
            await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Please fix this heading');
            await page.getByRole('button', { name: 'Post comment', exact: true }).click();
            const thread = openThread(page);
            await thread.getByRole('button', { name: 'Copy issue', exact: true }).click();
            await expect(thread).toContainText('Issue copied.');
            const copied = await page.evaluate(() => (window as unknown as { copiedIssue: string }).copiedIssue);
            expect(copied).toContain('Original browser context');
            expect(copied).toContain('Saved screenshot');
            expect(copied).not.toContain('uier-token');
            await page.goto(`/app/projects/${projectId}`);
            const card = page.getByRole('article', { name: 'Comment by you', exact: true });
            await card.getByRole('button', { name: 'Copy issue', exact: true }).click();
            await expect(card.getByRole('status').filter({ hasText: 'Issue copied.' })).toBeVisible();
            expect(await page.evaluate(() => (window as unknown as { copiedIssue: string }).copiedIssue)).toBe(copied);
            await page.evaluate(() => { (window as unknown as { rejectClipboard: boolean }).rejectClipboard = true; });
            await card.getByRole('button', { name: 'Copy issue', exact: true }).click();
            await expect(card.getByRole('textbox', { name: 'Issue Markdown' })).toHaveValue(copied);
            await card.getByRole('textbox', { name: 'Issue Markdown' }).scrollIntoViewIfNeeded();
            await expectNoAxeViolations(page);
            await page.screenshot({ path: testInfo.outputPath(`app-copy-${colorScheme}.png`) });
        } finally { await site.close(); }
    });
}
