import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { projectPublicId, createProject, hydrated, openProjectInvite, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { commentBubble, newVisitor, openThread, toolbar } from './support/toolbar';
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
            await expect(toolbar(verification)).toBeVisible();
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

    await page.goto(`/app/projects/${projectId}/settings/notifications`);
    const emails = page.getByRole('switch', { name: 'Emails from this project', exact: true });
    await expect(emails).toBeChecked();
    await hydrated(emails);
    const muted = page.waitForResponse(response => response.request().method() === 'POST' && Boolean(response.request().headers()['next-action']));
    await emails.click();
    await expect(emails).not.toBeChecked();
    await muted;
    await page.reload();
    await expect(emails).not.toBeChecked();
    // The account lists the same setting with every other project's
    await page.goto('/app/account/notifications');
    await expect(page.getByRole('switch', { name: 'Emails from Notification review', exact: true })).not.toBeChecked();
    await page.goto(`/app/projects/${projectId}`);
    const article = page.getByRole('article', { name: 'Comment by Ana notifications' });
    // Following is in the comment's More actions menu
    const moreActions = article.getByRole('button', { name: /^More actions for the comment/ });
    await moreActions.click();
    await page.getByRole('menuitem', { name: 'Follow thread', exact: true }).click();
    await expect(page.getByText('You follow this thread now.', { exact: true })).toBeVisible();
    await page.reload();
    await moreActions.click();
    await expect(page.getByRole('menuitem', { name: 'Unfollow thread', exact: true })).toBeVisible();
});


test('admins control excerpts in both themes; commenters see saved state and cannot change it', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('excerpt-admin'));
    const projectId = await createProject(page, { urls: [site.origin()], name: 'Excerpt policy' });
    await page.goto(`/app/projects/${projectId}/settings/notifications`);
    // The project's setting has its own card, apart from the admin's own emails
    const content = page.getByRole('region', { name: 'Email content' });
    const excerpts = content.getByRole('switch', { name: 'Include comment excerpts' });
    await expect(excerpts).not.toBeChecked();
    await expect(content).toContainText('every recipient, verified guests included');
    await expect(page.getByRole('region', { name: 'Email notifications' }).getByRole('switch')).toHaveCount(1);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await page.reload();
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        // A switch saves at once
        await hydrated(excerpts);
        const saveRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
        await excerpts.focus();
        await page.keyboard.press('Space');
        await expect(excerpts).toBeChecked();
        const actionRequest = await saveRequest;
        await expect(content.getByRole('status')).toContainText('The email setting is saved.');
        await page.reload();
        await expect(excerpts).toBeChecked();
        await page.evaluate(async () => {
            getComputedStyle(document.body).color;
            await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
        });
        await expectNoAxeViolations(page);
        await content.screenshot({ path: testInfo.outputPath(`email-excerpts-${colorScheme}.png`) });
        // Replay this valid admin action as a commenter below. It must fail on the server.
        if (colorScheme === 'dark') {
            // Settings has the project header invite (in who can comment), without the empty-feedback invite CTA.
            await openProjectInvite(page);
            const dialog = page.getByRole('dialog');
            await dialog.getByLabel('Email').fill(uniqueEmail('excerpt-commenter'));
            await dialog.getByRole('button', { name: 'Send invitation' }).click();
            const invitation = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
            const person = await newVisitor(browser, testInfo);
            try {
                await person.page.goto(invitation!);
                await person.page.getByRole('button', { name: 'Accept invitation' }).click();
                await expect(person.page).toHaveURL(new RegExp(`toolbar-code=${await projectPublicId(page, projectId)}`));
                await person.page.goto(`/app/projects/${projectId}/settings/notifications`);
                // Commenters set only their own emails and learn what the emails carry
                const personEmails = person.page.getByRole('region', { name: 'Email notifications' });
                await expect(personEmails).toContainText('These emails include short comment excerpts.');
                await expect(person.page.getByRole('switch', { name: 'Include comment excerpts' })).toHaveCount(0);
                await expect(person.page.getByRole('region', { name: 'Email content' })).toHaveCount(0);
                const response = await person.page.request.post(actionRequest.url(), { headers: {
                    'next-action': actionRequest.headers()['next-action']!,
                    'content-type': actionRequest.headers()['content-type']!,
                    origin: new URL(actionRequest.url()).origin
                }, data: actionRequest.postDataBuffer()! });
                expect(await response.text()).toContain('Only admins can do this.');
                for (const commenterTheme of ['light', 'dark'] as const) {
                    await person.page.emulateMedia({ colorScheme: commenterTheme });
                    await person.page.reload();
                    await expect(personEmails).toContainText('These emails include short comment excerpts.');
                    await expectNoAxeViolations(person.page);
                }
            } finally { await person.context.close(); }
        } else {
            await hydrated(excerpts);
            const saved = page.waitForResponse(response => response.request().method() === 'POST' && Boolean(response.request().headers()['next-action']));
            await excerpts.click();
            await expect(excerpts).not.toBeChecked();
            await saved;
            await page.reload();
            await expect(excerpts).not.toBeChecked();
        }
    }
});
