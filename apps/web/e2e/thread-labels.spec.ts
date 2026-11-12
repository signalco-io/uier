import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, hydrated, openComment, openCommentFilters, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

async function choose(page: Page, select: Locator, name: string) {
    await select.click();
    await page.getByRole('option', { name, exact: true }).click();
}
async function save(section: Locator) {
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(section.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
}

test('workspace labels inherit, project overrides save/discard/reset, and palette/icons persist', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('label-settings'));
    const project = await createProject(page, { name: 'Labels', urls: ['https://labels.example.test'] });
    await page.goto('/app/workspace/settings');
    const workspace = page.getByRole('region', { name: 'Labels', exact: true });
    await hydrated(workspace.locator('form'));
    await workspace.getByRole('button', { name: 'Add label', exact: true }).click();
    await workspace.getByLabel('Label name', { exact: true }).fill('Design');
    await workspace.getByLabel('Label description', { exact: true }).fill('Layout and visual feedback');
    await choose(page, workspace.getByRole('combobox', { name: 'Label color' }), 'Violet');
    await choose(page, workspace.getByRole('combobox', { name: 'Label icon' }), 'Paintbrush');
    await save(workspace);
    await page.reload();
    await expect(workspace.getByLabel('Label name', { exact: true })).toHaveValue('Design');
    await expect(workspace.getByRole('combobox', { name: 'Label color' })).toContainText('Violet');
    await expect(workspace.getByRole('combobox', { name: 'Label icon' })).toContainText('Paintbrush');
    await expectNoAxeViolations(page, { include: ['#labels'] });
    await page.goto(`/app/projects/${project}/settings/review`);
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await hydrated(review.locator('form'));
    const name = review.getByLabel('Label name', { exact: true });
    await expect(name).toHaveValue('Design');
    await expect(name).toBeDisabled();
    await choose(page, review.getByRole('combobox', { name: 'Label defaults' }), 'Project override');
    await name.fill('Project design');
    await review.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(name).toHaveValue('Design');
    await expect(name).toBeDisabled();
    await choose(page, review.getByRole('combobox', { name: 'Label defaults' }), 'Project override');
    await name.fill('Project design');
    await save(review);
    await page.reload();
    await expect(name).toHaveValue('Project design');
    await hydrated(review.locator('form'));
    await choose(page, review.getByRole('combobox', { name: 'Label defaults' }), 'Workspace defaults');
    await save(review);
    await expect(name).toHaveValue('Design');
});

test('members add/remove thread labels, rows and board show them, and label filters persist in the URL', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('label-thread'));
        const project = await createProject(page, { name: 'Label triage', urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        await page.goto('/app/workspace/settings');
        const workspace = page.getByRole('region', { name: 'Labels', exact: true });
        await hydrated(workspace.locator('form'));
        await workspace.getByRole('button', { name: 'Add label', exact: true }).click();
        await workspace.getByLabel('Label name', { exact: true }).fill('Bug');
        await workspace.getByLabel('Label description', { exact: true }).fill('A reproducible failure');
        await save(workspace);
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const post = (text: string) => request.post(`/api/review/${project}/comments`, { headers, data: {
            path: '/labels', text, kind: 'feedback', authorName: 'Reviewer', position: { type: 'page' }
        } });
        const first = await post('Label this thread');
        expect(first.status()).toBe(201);
        const comment = await first.json();
        expect((await post('Leave this one unlabeled')).status()).toBe(201);
        await page.goto(`/app/projects/${project}?view=list`);
        const thread = await openComment(page, comment.number);
        const actionRoute = `**/app/projects/${project}*`;
        await page.route(actionRoute, route => route.request().headers()['next-action'] && route.request().postData()?.includes('label_') ? route.abort('failed') : route.continue());
        await thread.getByRole('button', { name: 'Edit labels' }).click();
        await page.getByRole('menuitemcheckbox', { name: /Bug/ }).click();
        if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape');
        await expect(page.getByText('Could not update labels. Try again.', { exact: true })).toBeVisible();
        await expect(thread.getByText('No labels', { exact: true })).toBeVisible();
        await expect(thread.getByRole('button', { name: 'Edit labels' })).toBeEnabled();
        await page.unroute(actionRoute);
        await thread.getByRole('button', { name: 'Edit labels' }).click();
        await page.getByRole('menuitemcheckbox', { name: /Bug/ }).click();
        if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape');
        await expect(thread.locator('[data-slot=badge]').filter({ hasText: /^Bug$/ })).toBeVisible();
        await expect(thread.getByRole('button', { name: 'Edit labels' })).toBeEnabled();
        await expectNoAxeViolations(page, { include: ['[role=article]'] });
        await page.goto(`/app/projects/${project}?view=list`);
        await expect(page.locator('[data-comment-row]').filter({ hasText: 'Label this thread' }).getByText('Bug', { exact: true })).toBeVisible();
        await openCommentFilters(page);
        await choose(page, page.getByRole('combobox', { name: 'Label filter' }), 'Bug');
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/label=label_/);
        await expect(page.locator('[data-comment-row]')).toHaveCount(1);
        await page.reload();
        await expect(page.locator('[data-comment-row]')).toHaveCount(1);
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.locator('[data-board-card]')).toHaveCount(1);
        await expect(page.locator('[data-board-card]').getByText('Bug', { exact: true })).toBeVisible();
        await openComment(page, comment.number);
        await thread.getByRole('button', { name: 'Edit labels' }).click();
        await page.getByRole('menuitemcheckbox', { name: /Bug/ }).click();
        if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape');
        await expect(page.locator('[data-board-card]')).toHaveCount(0);
        await page.goto(`/app/projects/${project}?view=list`);
        await openComment(page, comment.number);
        await expect(thread.getByText('No labels', { exact: true })).toBeVisible();
        await thread.getByRole('button', { name: 'Activity (2)', exact: true }).click();
        await expect(thread.getByText(/changed labels\./)).toHaveCount(2);
    } finally { await site.close(); }
});
