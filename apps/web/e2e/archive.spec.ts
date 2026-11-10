import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { backToComments, createProject, openComment, signIn, uniqueEmail } from './support/app';
import { animationsFinished, commentBubble, openThread, threadOptions } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

async function fixture(page: Page) {
    await signIn(page, uniqueEmail('archive'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    const path = `/${projectId}/pricing`;
    const reviewUrl = `/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}${path}`)}`;
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Keep this feedback for later');
    const posted = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/review\/[^/]+\/comments$/.test(new URL(response.url()).pathname));
    await composer.press('Enter');
    const response = await posted;
    expect(response.status()).toBe(201);
    const comment = await response.json() as { id: string };
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    return { projectId, comment, reviewUrl };
}

test('app archive stays separate from Done and All, reloads and restores the prior status', async ({ page }) => {
    const f = await fixture(page);
    await page.goto(`/app/projects/${f.projectId}`);
    let card = await openComment(page, 1);
    await card.getByRole('button', { name: /^Status: Open/ }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await backToComments(page);
    const tabs = page.getByRole('group', { name: 'Status', exact: true });
    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    card = await openComment(page, 1);
    await card.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Archive comment', exact: true }).click();
    await expect(page.getByText('Nothing done yet', { exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Done 0', exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'All 0', exact: true }).click();
    await expect(page.locator('[data-comment-row]')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Archive 1', exact: true }).click();
    await page.reload();
    card = await openComment(page, 1);
    await expect(card.getByText('Archived', { exact: true })).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
    }
    await expect(card.getByRole('button', { name: /^Status: Done/ })).toBeVisible();
    await card.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Restore comment', exact: true }).click();
    await expect(page.getByText('Nothing archived', { exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    card = await openComment(page, 1);
    await expect(card).toContainText('Keep this feedback for later');
    await expect(card.getByRole('button', { name: /^Status: Done/ })).toBeVisible();
    // Archive remains reachable from the board, with no archived cards in its workflow columns.
    await backToComments(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await page.getByRole('button', { name: 'Archive 0', exact: true }).click();
    await expect(page.getByText('Nothing archived', { exact: true })).toBeVisible();
});

test('toolbar archive removes the pin, restores from Archive and rolls back a failed save', async ({ page }) => {
    const f = await fixture(page);
    await page.goto(f.reviewUrl);
    if (!await openThread(page).isVisible()) await commentBubble(page, 1, 1).click();
    await (await threadOptions(page, openThread(page))).getByRole('button', { name: 'Archive comment', exact: true }).click();
    await expect(commentBubble(page, 1, 1)).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    const tabs = inbox.getByRole('group', { name: 'Show comments' });
    await expect(tabs.getByRole('button', { name: 'Active 0', exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'All 0', exact: true }).click();
    await expect(inbox.getByRole('article')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Archive 1', exact: true }).click();
    const archived = inbox.getByRole('article');
    await expect(archived).toContainText('Keep this feedback for later');
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await animationsFinished(page.locator('#uier-toolbar'));
        await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    }
    await expect(archived.getByRole('button', { name: 'Show on page', exact: true })).toHaveCount(0);
    const restored = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/comments/${f.comment.id}`));
    await (await threadOptions(page, archived)).getByRole('button', { name: 'Restore comment', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await expect(inbox.getByRole('article')).toHaveCount(0);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await tabs.getByRole('button', { name: 'Active 1', exact: true }).click();
    const thread = inbox.getByRole('article');
    await expect(thread).toContainText('Keep this feedback for later');
    const endpoint = `**/api/review/*/comments/${f.comment.id}`;
    await page.route(endpoint, route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error', message: 'Could not archive the comment.' }) })
        : route.continue());
    await (await threadOptions(page, thread)).getByRole('button', { name: 'Archive comment', exact: true }).click();
    await expect(thread).toContainText('Keep this feedback for later');
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' }).first()).toBeVisible();
    await page.unroute(endpoint);
});
