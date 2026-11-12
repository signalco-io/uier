import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, setProjectAccess, signIn, uniqueEmail, openComment } from './support/app';
import { inboxSearch, openThread, toolbar, threadOptions } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

for (const colorScheme of ['light', 'dark'] as const) {
    test(`assignment and mentions persist across toolbar and app in ${colorScheme} mode`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme });
        const email = uniqueEmail('mention');
        const name = email.split('@')[0]!;
        await signIn(page, email);
        const projectId = await createProject(page, { urls: [site.origin()], name: 'Mention review' });
        const url = `${site.origin()}/${projectId}/pricing`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(url)}`);
        await expect(toolbar(page)).toBeVisible();
        await page.getByRole('button', { name: 'Add comment', exact: true }).click();
        const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
        await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
        const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill('Please review @');
        const options = page.getByRole('listbox', { name: 'Mention people' });
        await expect(options).toBeVisible();
        await page.getByRole('dialog', { name: 'New comment' }).evaluate(async dialog => {
            await Promise.all(dialog.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
        });
        await expectNoAxeViolations(page);
        if (testInfo.project.name.startsWith('Mobile')) {
            await options.getByRole('option').first().tap();
        } else {
            await composer.press('ArrowDown');
            await expect(composer).toHaveAttribute('aria-activedescendant', /.+/);
            await composer.press('Enter');
        }
        await expect(composer).toHaveText(`Please review @${name} `, { useInnerText: true });
        // Picking an identity does not submit the composer.
        await expect(page.locator('[data-uier-comment="new"]')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`mention-${colorScheme}.png`) });
        await page.getByRole('button', { name: 'Post comment', exact: true }).click();
        const thread = openThread(page);
        await expect(thread).toContainText(`Please review @${name}`);
        // Assigning is in Thread options; the people open under the header
        await (await threadOptions(page, thread)).getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
        await thread.getByRole('group', { name: 'Assign thread' }).getByRole('button', { name, exact: true }).click();
        // The assignee is an avatar beside the status: its tooltip and accessible name say who it is
        await expect(thread.getByRole('img', { name: 'Assigned to you', exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`assigned-thread-${colorScheme}.png`) });
        const appPage = await page.context().newPage();
        await appPage.goto(`/app/projects/${projectId}`);
        await expect((await openComment(appPage, /^Comment/)).getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();
        await appPage.close();
        await expectNoAxeViolations(page);
        await page.reload();
        await page.locator('[data-uier-comment]').click();
        await expect(openThread(page).getByRole('img', { name: 'Assigned to you', exact: true })).toBeVisible();
        await expect(openThread(page)).toContainText(`Please review @${name}`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^Inbox/ }).click();
        const inbox = page.getByRole('complementary', { name: 'Comments' });
        await inbox.getByRole('button', { name: 'Assigned to me', exact: true }).click();
        await expect(inbox.getByRole('article')).toHaveCount(1);
        await (await inboxSearch(inbox)).fill('missing');
        await expect(inbox.getByRole('article')).toHaveCount(0);
        await (await inboxSearch(inbox)).fill('');
        await (await threadOptions(page, inbox.getByRole('article'))).getByRole('button', { name: 'Assigned to you. Change assignee', exact: true }).click();
        await inbox.getByRole('button', { name: 'Unassign', exact: true }).click();
        await expect(inbox.getByRole('article')).toHaveCount(0);
        await inbox.getByRole('button', { name: 'Assigned to me', exact: true }).click();
        await expect(inbox.getByRole('article')).toHaveCount(1);
        await expect(inbox.getByRole('img', { name: /^Assigned to / })).toHaveCount(0);
        // The app consumes the same saved assignment and selected mention text.
        await page.goto(`/app/projects/${projectId}`);
        const card = await openComment(page, /^Comment/);
    await expect(card).toHaveAccessibleName('Comment by you');
        await expect(card).toContainText(`Please review @${name}`);
        await expect(card.getByRole('button', { name: 'Unassigned. Change assignee', exact: true })).toBeVisible();
    });
}

test('signing out removes cached member suggestions and assignment controls in a guest-enabled project', async ({ page }) => {
    await signIn(page, uniqueEmail('directory'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await page.getByRole('textbox', { name: 'Feedback', exact: true }).fill('@');
    await expect(page.getByRole('listbox', { name: 'Mention people' })).toBeVisible();
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('dialog', { name: 'Options', exact: true }).getByRole('button', { name: 'Sign out...', exact: true }).click();
    await page.getByRole('dialog', { name: 'Options', exact: true }).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Options', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your name' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Feedback', exact: true }).fill('@');
    await expect(page.getByRole('listbox', { name: 'Mention people' })).toHaveCount(0);
    await expect(page.getByText('Type @ to mention someone with access.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change assignee' })).toHaveCount(0);
});
