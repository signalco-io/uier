import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { backToComments, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('thread details collect PRs from messages and replies, with one quiet mark in list and board', async ({ page, request }, testInfo) => {
    const cspViolations: string[] = [];
    page.on('console', message => { if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text()); });
    await signIn(page, uniqueEmail('pull-requests'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: { path: '/pricing', kind: 'feedback', authorName: 'Reviewer', text: 'Check the checkout button', position: { type: 'page' } } });
    expect(response.status()).toBe(201);
    await page.goto(`/app/projects/${project}`);
    let thread = await openComment(page, 'Check the checkout button');
    await expect(thread.getByText('Pull requests', { exact: true })).toBeVisible();
    await expect(commentRows(page).getByLabel('Linked pull request')).toHaveCount(0);
    const manualUrl = 'https://github.com/acme/site/pull/2';
    // A quiet control until chosen; it opens the field with focus in it, and Escape closes it again
    const linkTrigger = thread.getByRole('button', { name: 'Link a pull request', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Pull request URL', exact: true })).toHaveCount(0);
    await linkTrigger.click();
    await expect(thread.getByRole('textbox', { name: 'Pull request URL', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(linkTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await thread.getByRole('textbox', { name: 'Pull request URL', exact: true }).fill(manualUrl);
    await thread.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(1);
    await page.reload();
    thread = page.getByRole('article');
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(1);
    // The open thread's read colours its row's mark too (hidden behind the thread on a phone): its one pull request is merged
    await expect(thread.locator('[data-pull-request-color="merged"]')).toHaveCount(1);
    await expect(page.locator('[data-comment-id] [data-pull-request-mark]')).toHaveAttribute('data-pull-request-color', 'merged');
    await thread.getByRole('button', { name: 'Remove link to GitHub acme/site #2', exact: true }).click();
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(0);
    await thread.getByRole('button', { name: 'Link a pull request', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Pull request URL', exact: true }).fill(manualUrl);
    await thread.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(1);
    // Merged and Open: the mark shows the least advanced state, the one that still needs attention
    await thread.getByRole('button', { name: 'Link a pull request', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Pull request URL', exact: true }).fill('https://gitlab.com/acme/site/-/merge_requests/1');
    await thread.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(2);
    await expect(page.locator('[data-comment-id] [data-pull-request-mark]')).toHaveAttribute('data-pull-request-color', 'open');
    await thread.getByRole('button', { name: 'Remove link to GitLab acme/site !1', exact: true }).click();
    await expect(thread.locator('[data-pull-request-links]').getByRole('link')).toHaveCount(1);
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Also https://github.com/acme/site/pull/1 https://github.com/acme/site/pull/3 https://gitlab.com/acme/site/-/merge_requests/4 https://dev.azure.com/acme/Website/_git/site/pullrequest/9');
    await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(thread.getByRole('status').filter({ hasText: 'Reply posted' })).toBeVisible();
    const values = thread.locator('[data-pull-request-links]');
    await expect(values.getByRole('link')).toHaveCount(5);
    await expect(values.getByText('Merged', { exact: true })).toBeVisible();
    await expect(values.getByText('Open', { exact: true })).toBeVisible();
    await expect(values.getByText('Closed', { exact: true })).toBeVisible();
    await expect(values.getByText('Draft', { exact: true })).toBeVisible();
    // The icon and the name take their state's colour, the same as the badge's dot
    for (const state of ['open', 'merged', 'closed', 'draft']) {
        const row = values.locator(`[data-pull-request-color="${state}"]`).first();
        const dot = values.locator(`[data-pull-request-state="${state}"] > span`).first();
        const color = await dot.evaluate(element => getComputedStyle(element).backgroundColor);
        await expect(row.locator('svg').first()).toHaveCSS('color', color);
        // Closed's red is too faint for text on dark: its name stays in ink
        if (state !== 'closed') await expect(row).toHaveCSS('color', color);
    }
    await expect(values.getByRole('link', { name: 'Azure DevOps acme/Website/site #9' })).toHaveAttribute('href', 'https://dev.azure.com/acme/Website/_git/site/pullrequest/9');
    // Link destinations stay external, while the row/card's one existing link still opens the thread.
    await expect(values.getByRole('link', { name: 'GitHub acme/site #2' })).toHaveAttribute('rel', 'noopener noreferrer');
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await animationsFinished(thread);
        const overflow = await thread.evaluate(element => element.scrollWidth > element.clientWidth);
        expect(overflow).toBe(false);
        expect(cspViolations).toEqual([]);
        expect((await new AxeBuilder({ page }).include('[data-thread-details]').analyze()).violations).toEqual([]);
        cspViolations.length = 0;
    }
    if (testInfo.project.name.startsWith('Mobile')) await backToComments(page);
    await expect(commentRows(page).getByLabel('Linked pull request')).toHaveCount(1);
    // Azure DevOps #9 has no known state, so the row's mark stays uncoloured
    await expect(commentRows(page).locator('[data-pull-request-mark]')).not.toHaveAttribute('data-pull-request-color');
    // Hovering the mark (a tap on touch screens) lists the pull requests with their provider and state
    const mark = commentRows(page).getByRole('button', { name: /^Linked pull request, comment #\d+$/ });
    const card = page.getByRole('dialog', { name: 'Pull requests', exact: true });
    if (testInfo.project.name.startsWith('Mobile')) await mark.tap();
    // The list may still settle after the reply, moving the row from under the pointer: hover again until it shows
    else await expect(async () => { await mark.hover(); await expect(card).toBeVisible({ timeout: 1000 }); }).toPass();
    await expect(card.getByRole('link')).toHaveCount(5);
    // PR #2 is only manually linked; it shares the detected links' card and state badge.
    await expect(card.getByRole('link', { name: /^GitHub acme\/site #2/ })).toHaveAttribute('href', manualUrl);
    await expect(card.locator('[data-provider-mark="gitlab"]')).toHaveCount(1);
    await expect(card.getByRole('link', { name: /^GitLab acme\/site !4/ })).toHaveAttribute('href', 'https://gitlab.com/acme/site/-/merge_requests/4');
    await expect(card.locator('[data-pull-request-state="merged"]')).toHaveText('Merged');
    await expect(card.locator('[data-pull-request-color="merged"]')).toHaveCount(1);
    await animationsFinished(card);
    expect((await new AxeBuilder({ page }).include('[data-pull-request-card]').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.locator('[data-board-card]').getByLabel('Linked pull request')).toHaveCount(1);
    thread = await openComment(page, 'Check the checkout button');
    await expect(thread.locator('[data-pull-request-links]').getByText('Merged', { exact: true })).toBeVisible();
});
