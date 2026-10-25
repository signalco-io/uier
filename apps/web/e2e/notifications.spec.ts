import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { commentBubble, newVisitor, openThread } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

test('guest comments without email, then separately verifies and revokes reply notifications', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('notification-owner'));
    const projectId = await createProject(page, { urls: [site.origin()], name: 'Notification review' });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const guest = await newVisitor(browser, testInfo);
    try {
        await guest.page.goto(`${site.origin()}/${projectId}/pricing?toolbar-code=${projectId}`);
        await guest.page.getByRole('button', { name: 'Add comment', exact: true }).click();
        const heading = await guest.page.getByRole('heading', { level: 1 }).boundingBox();
        await guest.page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
        await guest.page.getByRole('textbox', { name: 'Your name' }).fill('Ana notifications');
        expect(await guest.page.getByRole('textbox', { name: /email/i }).count()).toBe(0);
        const composer = guest.page.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill('Can the plan labels be clearer?');
        await composer.press('Enter');
        await expect(commentBubble(guest.page, 1)).toBeVisible();
        await openThread(guest.page).getByRole('button', { name: 'Email me replies' }).click();
        await guest.page.getByLabel('Email for replies').fill(uniqueEmail('notification-guest'));
        await guest.page.screenshot({ path: testInfo.outputPath('guest-reply-opt-in.png') });
        await guest.page.getByRole('button', { name: 'Send verification link' }).click();
        await expect(guest.page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();
        const url = await guest.page.getByRole('link', { name: 'Open verification link' }).getAttribute('href');
        const verification = await guest.context.newPage();
        await verification.goto(url!);
        await expect(verification.getByRole('button', { name: 'Confirm reply notifications' })).toBeVisible();
        await verification.reload();
        // GETs (including scanners and reload) have no side effects.
        await expect(verification.getByRole('button', { name: 'Confirm reply notifications' })).toBeVisible();
        for (const colorScheme of ['light', 'dark'] as const) {
            await verification.emulateMedia({ colorScheme });
            await verification.reload();
            await expect(verification.getByRole('button', { name: 'Confirm reply notifications' })).toBeVisible();
            await expect(verification.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
            await verification.evaluate(async () => {
                // Flush the new theme before waiting for its finite color transitions.
                getComputedStyle(document.body).color;
                await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
            });
            await expectNoAxeViolations(verification);
            await verification.screenshot({ path: testInfo.outputPath(`notifications-${colorScheme}.png`) });
        }
        await verification.getByRole('button', { name: 'Confirm reply notifications' }).click();
        await expect(verification.getByRole('status').filter({ hasText: 'Reply notifications confirmed' })).toBeVisible();
        await guest.page.reload();
        await commentBubble(guest.page, 1).click();
        await openThread(guest.page).getByRole('button', { name: 'Unfollow thread' }).click();
        await expect(openThread(guest.page).getByRole('button', { name: 'Email me replies' })).toBeVisible();
        await verification.close();
    } finally { await guest.context.close(); }

    await page.goto(`/app/projects/${projectId}`);
    await page.getByRole('button', { name: 'Mute project emails', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unmute project emails' })).toBeVisible();
    const article = page.getByRole('article', { name: 'Comment by Ana notifications' });
    await article.getByRole('button', { name: 'Follow thread', exact: true }).click();
    await expect(article.getByRole('button', { name: 'Unfollow thread', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unmute project emails' })).toBeVisible();
    await expect(article.getByRole('button', { name: 'Unfollow thread', exact: true })).toBeVisible();
});
