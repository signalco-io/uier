import { expect, test } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from './support/app';
import { animationsFinished, newVisitor } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

test('admins review and confirm member roles, retain explicit grants and see Activity', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('role-admin'));
    const alpha = await createProject(page, { name: 'Alpha role project', urls: ['https://alpha.example'] });
    const beta = await createProject(page, { name: 'Beta role project', urls: ['https://beta.example'] });
    await page.goto('/app/workspace/users');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const email = uniqueEmail('role-person');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByRole('radio', { name: 'All projects, now and later' }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const reviewer = await newVisitor(browser, testInfo);
    try {
        await reviewer.page.goto(invitation!);
        await reviewer.page.getByRole('button', { name: 'Accept invitation' }).click();
        await reviewer.page.waitForURL(/\/app\/projects$/);
        await page.reload();
        await page.getByRole('list', { name: 'People', exact: true }).getByRole('listitem').filter({ hasText: email }).getByRole('link', { name: /^Manage access for/ }).click();
        await page.waitForURL(/\/app\/workspace\/users\/u_/);
        const personUrl = page.url();
        const form = page.getByRole('region', { name: 'Role, teams and direct access' });
        const role = form.getByRole('combobox', { name: 'Role', exact: true });
        const review = form.getByRole('button', { name: 'Review access changes' });
        await expect(role).toContainText('Commenter');
        await expect(review).toBeDisabled();
        await role.click();
        await expect(page.getByRole('option')).toHaveText(['Admin', 'Commenter']);
        await page.getByRole('option', { name: 'Admin', exact: true }).click();
        await review.click();
        await expect(dialog).toContainText('Role: Commenter → Admin');
        await expect(dialog).toContainText('Workspace admin');
        // Cancelling the review leaves the stored role unchanged.
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(review).toBeFocused();
        await page.reload();
        await expect(role).toContainText('Commenter');
        await role.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('option', { name: 'Admin', exact: true }).click();
        await review.click();
        await animationsFinished(dialog);
        await expectNoAxeViolations(page);
        await dialog.getByRole('button', { name: 'Confirm changes' }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^Admin$/ })).toBeVisible();
        await expect(review).toBeDisabled();
        await reviewer.page.goto(`/app/projects/${beta}/settings`);
        await expect(reviewer.page.getByRole('heading', { level: 1, name: 'Beta role project' })).toBeVisible();

        // Demote and narrow the explicit all-project grant in one confirmation.
        await role.click();
        await page.getByRole('option', { name: 'Commenter', exact: true }).click();
        await form.getByRole('combobox', { name: 'Direct access' }).click();
        await page.getByRole('option', { name: 'Selected projects', exact: true }).click();
        await form.getByRole('checkbox', { name: 'Alpha role project', exact: true }).check();
        await review.click();
        await expect(dialog).toContainText('Role: Admin → Commenter');
        await expect(dialog).toContainText('Alpha role project: Keeps access');
        await expect(dialog).toContainText('Beta role project: Loses access');
        await dialog.getByRole('button', { name: 'Confirm changes' }).click();
        await expect(dialog).not.toBeVisible();
        await expect(role).toContainText('Commenter');
        await expect(review).toBeDisabled();
        expect((await reviewer.page.goto(`/app/projects/${beta}/settings`))?.status()).toBe(404);
        expect((await reviewer.page.goto(`/app/projects/${beta}`))?.status()).toBe(404);
        await reviewer.page.goto('/app/account');
        const accountAccess = reviewer.page.getByRole('region', { name: 'Your workspace access' });
        await expect(accountAccess).toContainText('Commenter');
        await expect(accountAccess).toContainText('Alpha role project');
        await expect(accountAccess).not.toContainText('Beta role project');
        expect((await reviewer.page.goto(personUrl))?.status()).toBe(404);
        await page.goto('/app/workspace/activity');
        const activity = page.getByRole('list', { name: 'Access changes' });
        await expect(activity).toContainText('Role: Commenter → Admin.');
        await expect(activity).toContainText('Role: Admin → Commenter.');
        await page.goto(personUrl);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await reviewer.page.goto(`/app/projects/${alpha}`))?.status()).toBe(200);
    } finally {
        await reviewer.context.close();
    }
});

test('the sole admin sees a clear error when confirming self-demotion', async ({ page }) => {
    const email = uniqueEmail('sole-role-admin');
    await signIn(page, email);
    await page.goto('/app/workspace/users');
    await page.getByRole('list', { name: 'People', exact: true }).getByRole('listitem').filter({ hasText: email }).getByRole('link', { name: /^Manage access for/ }).click();
    await page.getByRole('combobox', { name: 'Role', exact: true }).click();
    await page.getByRole('option', { name: 'Commenter', exact: true }).click();
    await page.getByRole('button', { name: 'Review access changes' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Role: Admin → Commenter');
    await dialog.getByRole('button', { name: 'Confirm changes' }).click();
    await expect(dialog).toContainText('A workspace needs at least one admin.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toContainText('Admin');
});
