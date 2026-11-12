import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, hydrated, openBoardMove, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
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
async function addStatus(section: Locator, category: string, name: string) {
    await section.getByRole('button', { name: `Add status to ${category}`, exact: true }).click();
    const group = section.getByRole('group', { name: category, exact: true });
    await group.getByLabel('Status name', { exact: true }).last().fill(name);
    await group.getByLabel('Description', { exact: true }).last().fill(`${name} workflow description`);
}

test('workspace statuses inherit, project overrides save/discard, and board/menu moves keep the workflow categories', async ({ page, request, baseURL }) => {
    test.setTimeout(120_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('custom-status'));
        const project = await createProject(page, { name: 'Custom workflow', urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        await page.goto('/app/workspace/settings');
        const workspace = page.getByRole('region', { name: 'Statuses', exact: true });
        await hydrated(workspace.locator('form'));
        for (const [category, name] of [['Open', 'Approved'], ['In progress', 'Merging'], ['Ready to verify', 'QA'], ['Done', 'Production'], ['Archive', 'Rejected']])
            await addStatus(workspace, category!, name!);
        await workspace.getByRole('button', { name: 'Move up Merging', exact: true }).click();
        await choose(page, workspace.getByRole('combobox', { name: 'New comments start in' }), 'Approved');
        await choose(page, workspace.getByRole('combobox', { name: 'Done action uses' }), 'Production');
        await choose(page, workspace.getByRole('combobox', { name: 'Archive action uses' }), 'Rejected');
        await save(workspace);
        await expectNoAxeViolations(page, { include: ['#statuses'] });
        await page.goto(`/app/projects/${project}/settings/review`);
        const review = page.getByRole('region', { name: 'Review', exact: true });
        await hydrated(review.locator('form'));
        const openGroup = review.getByRole('group', { name: 'Open', exact: true });
        await expect(openGroup.getByLabel('Status name', { exact: true }).last()).toHaveValue('Approved');
        await expect(openGroup.getByLabel('Status name', { exact: true }).last()).toBeDisabled();
        await choose(page, review.getByRole('combobox', { name: 'Status defaults' }), 'Project override');
        await openGroup.getByLabel('Status name', { exact: true }).last().fill('Project approval');
        await review.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(openGroup.getByLabel('Status name', { exact: true }).last()).toHaveValue('Approved');
        await choose(page, review.getByRole('combobox', { name: 'Status defaults' }), 'Project override');
        await openGroup.getByLabel('Status name', { exact: true }).last().fill('Project approval');
        await save(review);
        await page.reload();
        await expect(openGroup.getByLabel('Status name', { exact: true }).last()).toHaveValue('Project approval');
        await hydrated(review.locator('form'));
        await choose(page, review.getByRole('combobox', { name: 'Status defaults' }), 'Workspace defaults');
        await save(review);
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const created = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: '/workflow', text: 'Custom workflow thread', kind: 'feedback', authorName: 'Reviewer', position: { type: 'page' }
        } });
        expect(created.status()).toBe(201);
        const comment = await created.json();
        await page.goto(`/app/projects/${project}?view=board`);
        const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
        await expect(column('Approved').getByRole('listitem')).toHaveCount(1);
        expect(await page.locator('[data-board-scroll] > section').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([
            'Open comments', 'Approved comments', 'Merging comments', 'In progress comments', 'Ready to verify comments', 'QA comments', 'Done comments', 'Production comments', 'Archived comments', 'Rejected comments'
        ]);
        const menu = await openBoardMove(page, comment.number);
        await expect(menu).toContainText('Merging workflow description');
        await menu.getByRole('menuitem', { name: /^Merging/ }).click();
        await expect(column('Merging').getByRole('listitem')).toHaveCount(1);
        await page.reload();
        await expect(column('Merging').getByRole('listitem')).toHaveCount(1);
        const readyMenu = await openBoardMove(page, comment.number);
        await readyMenu.getByRole('menuitem', { name: /^QA/ }).click();
        const thread = page.getByRole('article');
        await expect(thread.getByRole('form', { name: 'Request verification' })).toBeVisible();
        await thread.getByRole('button', { name: 'Request verification', exact: true }).click();
        await expect(thread.getByRole('button', { name: /Status: QA/ })).toBeVisible();
        await thread.getByRole('button', { name: /Status: QA/ }).click();
        await page.getByRole('menuitem', { name: /^Merging/ }).click();
        await expect(thread.getByRole('button', { name: /Status: Merging/ })).toBeVisible();
        await thread.getByRole('button', { name: /Status: Merging/ }).click();
        await page.getByRole('menuitem', { name: /^Production/ }).click();
        await expect(thread.getByRole('button', { name: /Status: Production/ })).toBeVisible();
        await thread.getByRole('button', { name: /^More actions for the comment/ }).click();
        await page.getByRole('menuitem', { name: 'Rejected', exact: true }).click();
        await expect(thread.getByText('Archived', { exact: true })).toBeVisible();
        await thread.getByRole('button', { name: 'Back to comments' }).click();
        await page.getByRole('button', { name: 'Rejected 1', exact: true }).click();
        await expect(column('Rejected').getByRole('listitem')).toHaveCount(1);
        await openComment(page, comment.number);
        await page.getByRole('article').getByRole('button', { name: /^More actions for the comment/ }).click();
        await page.getByRole('menuitem', { name: 'Restore comment', exact: true }).click();
        await page.getByRole('article').getByRole('button', { name: 'Back to comments' }).click();
        await expect(column('Production').getByRole('listitem')).toHaveCount(1);
        await expectNoAxeViolations(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await site.close(); }
});

test('toolbar custom status menu groups descriptions and persists moves within a category and into archive', async ({ page, baseURL }) => {
    const { commentBubble, openThread } = await import('./support/toolbar');
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('toolbar-workflow'));
        const project = await createProject(page, { urls: [site.origin()] });
        await page.goto(`/app/projects/${project}/settings/review`);
        const review = page.getByRole('region', { name: 'Review', exact: true });
        await hydrated(review.locator('form'));
        await choose(page, review.getByRole('combobox', { name: 'Status defaults' }), 'Project override');
        await addStatus(review, 'Open', 'Approved');
        await addStatus(review, 'Archive', 'Rejected');
        await save(review);
        await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`);
        await page.getByRole('button', { name: 'Add comment', exact: true }).click();
        const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
        await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
        const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill('Custom toolbar statuses');
        await composer.press('Enter');
        await expect(commentBubble(page, 1, 1)).toBeVisible();
        const thread = openThread(page);
        await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
        const menu = page.getByRole('dialog', { name: 'Status', exact: true });
        await expect(menu).toContainText('Approved workflow description');
        await menu.getByRole('button', { name: /^Approved/ }).click();
        await expect(thread.getByRole('button', { name: 'Status: Approved. Change status', exact: true })).toBeVisible();
        await page.reload();
        await commentBubble(page, 1, 1).click();
        await thread.getByRole('button', { name: 'Status: Approved. Change status', exact: true }).click();
        await menu.getByRole('button', { name: /^Rejected/ }).click();
        await expect(commentBubble(page, 1, 1)).toBeHidden();
    } finally { await site.close(); }
});
