import { enableProjectVerification } from './support/app';
import { expect, test, type Page } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail } from './support/app';
import { animationsFinished, commentBubble, openThread, threadOptions, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

/** A member's new thread on the project's site, open in its popover */
async function memberThread(page: Page) {
    await signIn(page, uniqueEmail('popover'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    await enableProjectVerification(page, projectId);
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('The plan names are hard to tell apart.');
    await composer.press('Enter');
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    const thread = openThread(page);
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
    return thread;
}

/** The visible name an icon button shows (its tooltip, in the toolbar's shadow root) */
const tooltip = (page: Page, text: string) => page.locator('[data-uier-tooltip]').filter({ hasText: new RegExp(`^${text}$`) });

test('a new thread shows its comment and reply box; triage and email controls are in Thread options', async ({ page }) => {
    const thread = await memberThread(page);
    await expect(thread).toContainText('The plan names are hard to tell apart.');
    // Not in the thread itself any more
    for (const name of [/Change priority/, /Change assignee/, /^Request verification$/, /follow thread$/i, /project emails$/, /^Copy issue$/, /^Copy link$/])
        await expect(thread.getByRole('button', { name })).toHaveCount(0);
    await expect(thread).not.toContainText('Priority: Normal');
    // The header: the status menu, number, then Copy and Thread options (no separate Mark as done)
    for (const name of ['Status: Open. Change status', 'Copy', 'Thread options'])
        await expect(thread.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(thread.getByRole('button', { name: /^(Mark as done|Reopen)$/ })).toHaveCount(0);

    // The status menu: every status, as in the app, the current one pressed and focused
    await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    const statusMenu = page.getByRole('dialog', { name: 'Status', exact: true });
    await expect(statusMenu.getByRole('button')).toHaveText(['Open', 'In progress', 'Ready to verify', 'Done', 'Archive']);
    await expect(statusMenu.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(statusMenu.getByRole('button', { name: 'Open', exact: true })).toBeFocused();
    await animationsFinished(statusMenu);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(statusMenu).toBeHidden();
    await expect(thread.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeFocused();

    const options = await threadOptions(page, thread);
    for (const name of ['Unassigned. Change assignee', 'Priority: Normal. Change priority', 'Request verification', 'Unfollow thread', 'Mute project emails'])
        await expect(options.getByRole('button', { name, exact: true })).toBeVisible();
    await animationsFinished(options);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    await expect(thread.getByRole('button', { name: 'Thread options', exact: true })).toBeFocused();

    await thread.getByRole('button', { name: 'Copy', exact: true }).click();
    const copy = page.getByRole('dialog', { name: 'Copy', exact: true });
    await expect(copy.getByRole('button', { name: /^Copy issue/ })).toContainText('for an issue or a coding tool');
    await expect(copy.getByRole('button', { name: /^Copy link/ })).toContainText('Opens this page at the thread');
});

test('the toolbar\'s icon buttons show their names on hover and keyboard focus', async ({ page }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'A tap acts; there is no hover');
    const thread = await memberThread(page);
    await thread.getByRole('button', { name: 'Thread options', exact: true }).hover();
    await expect(tooltip(page, 'Thread options')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toBeHidden();
    // Keyboard focus shows it at once, above the pill (the pill's buttons are one tab stop: the arrows move between them)
    const add = toolbar(page).getByRole('button', { name: 'Add comment', exact: true });
    await add.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(add).toBeFocused();
    // The name, then its shortcut (C)
    const name = page.locator('[data-uier-tooltip]').filter({ hasText: /^Add comment/ });
    await expect(name).toBeVisible();
    const box = (await name.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual((await add.boundingBox())!.y);
    await page.keyboard.press('Tab');
    await expect(name).toBeHidden();
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).hover();
    await expect(tooltip(page, 'Inbox')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('toolbar-tooltip.png') });
});

test('a pin shows its thread\'s status but Open, in its dot and its name (uier #364)', async ({ page }) => {
    const thread = await memberThread(page);
    const pin = commentBubble(page, 1, 1);
    await expect(pin.locator('[data-uier-pin-status]')).toHaveCount(0);

    await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    await page.getByRole('dialog', { name: 'Status', exact: true }).getByRole('button', { name: 'In progress', exact: true }).click();
    // At once (optimistic), the status dot on the pin and the status in its name; the pin keeps its size
    const inProgress = page.getByRole('button', { name: 'Comment #1, 1 message, In progress', exact: true });
    await expect(inProgress.locator('[data-uier-pin-status="in-progress"]')).toBeVisible();
    const box = (await inProgress.boundingBox())!;
    expect(Math.round(box.width)).toBeLessThanOrEqual(44);

    await thread.getByRole('button', { name: 'Status: In progress. Change status', exact: true }).click();
    await page.getByRole('dialog', { name: 'Status', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(pin.locator('[data-uier-pin-status]')).toHaveCount(0);
});
