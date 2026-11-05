import { expect, test, type Page } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail, openComment } from './support/app';
import { commentBubble, openThread, threadOptions } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

/** A new project of a new member ("maya-..."), who comments through the toolbar on its site */
async function memberComment(page: Page) {
    await signIn(page, uniqueEmail('maya'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    const reviewUrl = `/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`;
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('The plan names are hard to tell apart.');
    await composer.press('Enter');
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    return { projectId, reviewUrl };
}

test('a member\'s toolbar comment reads the same in the app: number, avatar and follow state', async ({ page }) => {
    const { projectId, reviewUrl } = await memberComment(page);
    // The pin on the reviewed site shows the thread's number, like the thread and the app
    await expect(commentBubble(page, 1, 1)).toHaveText('1');
    // Following is in Thread options
    await expect((await threadOptions(page, openThread(page))).getByRole('button', { name: 'Unfollow thread', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/app/projects/${projectId}`);
    const card = await openComment(page, /^Comment/);
    await expect(card).toHaveAccessibleName('Comment by you');
    await expect(card).toContainText('#1');
    // The avatar is the person's initial, not the Y of "You"
    await expect(card.locator('[data-slot="avatar-fallback"]').first()).toHaveText('M');
    await card.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Unfollow thread', exact: true }).click();
    await expect(page.getByText('You no longer follow this thread.', { exact: true })).toBeVisible();

    await page.goto(reviewUrl);
    await commentBubble(page, 1, 1).click();
    await expect((await threadOptions(page, openThread(page))).getByRole('button', { name: 'Follow thread', exact: true })).toBeVisible();
});

test('with nobody else to check a fix, the request form says so and offers an invite', async ({ page }) => {
    const { projectId } = await memberComment(page);
    const thread = openThread(page);
    await (await threadOptions(page, thread)).getByRole('button', { name: 'Request verification', exact: true }).click();
    const toolbarForm = thread.getByRole('form', { name: 'Request verification' });
    await expect(toolbarForm).toContainText('Nobody else can check this fix yet.');
    await expect(toolbarForm.getByRole('button', { name: 'Request verification', exact: true })).toHaveAccessibleDescription(/Nobody else can check this fix yet\./);

    await page.goto(`/app/projects/${projectId}`);
    const card = await openComment(page, /^Comment/);
    await expect(card).toHaveAccessibleName('Comment by you');
    await card.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ready to verify', exact: true }).click();
    const form = card.getByRole('form', { name: 'Request verification' });
    await expect(form).toContainText('Nobody else can check this fix yet.');
    await expect(form.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
    const submit = form.getByRole('button', { name: 'Request verification', exact: true });
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAccessibleDescription(/Nobody else can check this fix yet\./);
});
