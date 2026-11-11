import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { instant } from '@next/playwright';
import { appNavigation, createProject, hydrated, signIn, uniqueEmail } from './support/app';

async function capture(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: 'image/png' });
}

for (const populated of [false, true]) {
    const variant = populated ? 'populated workspace' : 'empty workspace';

    test(`Projects → Create project: ${variant}`, async ({ page }, info) => {
        test.setTimeout(60_000);
        await signIn(page, uniqueEmail('instant-new'));
        if (populated) await createProject(page, {
            urls: ['https://instant.example.com'], name: 'Existing project', clientName: 'Existing client',
        });
        await page.goto('/app/projects');
        const link = page.getByRole('link', { name: 'Create project', exact: true }).filter({ visible: true }).first();
        await hydrated(link);
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/projects\/new$/);
            await capture(page, info, 'locked');
            await expect(page.getByTestId('new-project-heading')).toBeVisible();
            await expect(page.getByRole('list', { name: 'Onboarding progress' })).toBeVisible();
            await expect(page.getByRole('status', { name: 'Loading new', exact: true })).toBeVisible();
            await expect(page.getByLabel('Main site address')).toHaveCount(0);
            await expect(page.getByText('Tell uier which site you want to review. Then add the script and invite a reviewer.', { exact: true })).toBeVisible();
            await expect(page.getByRole('list', { name: 'Onboarding progress' }).getByRole('listitem')).toHaveCount(4);
        });
        await expect(page.getByLabel('Main site address')).toBeVisible();
        await expect(page.getByLabel('Project name', { exact: true })).toBeVisible();
        if (populated) {
            const client = page.getByLabel('Client name (optional)');
            await client.fill('Existing');
            await expect(page.getByRole('option', { name: 'Existing client' })).toBeVisible();
            await client.press('Escape');
        }
        await capture(page, info, 'completed');
    });

    test(`Projects → Account: ${variant}`, async ({ page }, info) => {
        test.setTimeout(60_000);
        const email = uniqueEmail('instant-account');
        await signIn(page, email);
        if (populated) await createProject(page, { urls: ['https://instant.example.com'], name: 'Existing project' });
        await page.goto('/app/projects');
        await appNavigation(page);
        const account = page.getByRole('button', { name: /^Account:/ });
        await hydrated(account);
        await account.click();
        const link = page.getByRole('menuitem', { name: 'Account', exact: true });
        await expect(link).toBeVisible();
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/account$/);
            await capture(page, info, 'locked');
            await expect(page.getByTestId('account-heading')).toBeVisible();
            const sections = page.getByRole('navigation', { name: 'Account', exact: true });
            await expect(sections).toBeVisible();
            await expect(sections.getByRole('link')).toHaveText(['General', 'Sign-in', 'Notifications', 'Usage', 'Coding agents']);
            await expect(page.getByRole('status', { name: 'Loading account', exact: true })).toBeVisible();
            await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
            await expect(page.getByRole('main').getByText(email, { exact: true })).toHaveCount(0);
            await sections.getByRole('link', { name: 'General', exact: true }).focus();
        });
        await expect(page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: 'General', exact: true })).toBeFocused();
        await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible();
        await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Your workspace access', exact: true }))
            .toContainText(populated ? 'Existing project' : 'None yet');
        await capture(page, info, 'completed');
    });
}

test('Status initial load already provides its useful shell', async ({ page, baseURL }, info) => {
    await instant(page, async () => {
        await page.goto('/status', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'How this works', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Checking services…' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Loading service checks…' })).toBeVisible();
        await expect(page.locator('time')).toHaveCount(0);
        await expect(page.locator('[data-state="operational"]')).toHaveCount(0);
        await capture(page, info, 'locked');
    }, { baseURL });
    await expect(page.locator('time')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All services are operational.' })).toBeVisible();
});
