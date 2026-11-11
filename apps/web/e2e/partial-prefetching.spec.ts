import { expect, test } from '@playwright/test';
import { instant } from '@next/playwright';
import { appNavigation, createProject, hydrated, signIn, uniqueEmail } from './support/app';

test('Security → Status keeps the public shell and streams live checks', async ({ page }) => {
    await page.goto('/security');
    const link = page.getByRole('link', { name: 'Status', exact: true });
    await link.scrollIntoViewIfNeeded();
    await hydrated(link);
    await instant(page, async () => {
        await link.click();
        await expect(page).toHaveURL(/\/status$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'How this works', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Checking services…' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Loading service checks…' })).toBeVisible();
        await expect(page.locator('time')).toHaveCount(0);
    });
    await expect(page.locator('time')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All services are operational.' })).toBeVisible();
});

for (const populated of [false, true]) {
    test(`Projects → My work retains navigation; ${populated ? 'populated' : 'empty'} workspace`, async ({ page }) => {
        test.setTimeout(60_000);
        await signIn(page, uniqueEmail('partial'));
        if (populated) await createProject(page, { urls: ['https://partial.example.com'], name: 'Partial project' });
        await page.goto('/app/projects');
        const navigation = await appNavigation(page);
        const link = navigation.getByRole('link', { name: 'My work', exact: true });
        await hydrated(link);
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/my-work$/);
            // The existing layout remains useful while private, fresh page data waits.
            await expect(page.getByRole('button', { name: 'Toggle sidebar' }).last()).toBeVisible();
            await expect(page.getByRole('status', { name: 'Loading my work', exact: true })).toBeVisible();
            await expect(page.getByRole('heading', { level: 1, name: 'My work', exact: true })).toHaveCount(0);
        });
        await expect(page.getByRole('heading', { level: 1, name: 'My work', exact: true })).toBeVisible();
        await expect(page.getByText('Nothing needs you', { exact: true })).toBeVisible();
    });
}
