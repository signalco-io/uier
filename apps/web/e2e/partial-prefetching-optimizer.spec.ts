import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { instant } from '@next/playwright';
import { createProject, hydrated, signIn, uniqueEmail } from './support/app';

async function capture(page: Page, testInfo: TestInfo, name: string) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function statusFixture(page: Page) {
    await signIn(page, uniqueEmail('prefetch-status'));
    await createProject(page, { urls: ['https://ongoing.example.com'], name: 'Ongoing site' });
    await createProject(page, { urls: ['https://finished.example.com'], name: 'Finished site' });
    await page.goto('/app/projects');
    const active = page.getByRole('list', { name: 'Active projects' });
    await active.getByRole('button', { name: 'More actions for Finished site' }).click();
    await page.getByRole('menuitem', { name: 'Mark as done', exact: true }).click();
    await expect(active.getByRole('listitem')).toHaveCount(1);
}

test('Projects Active → Done is already immediate with its query-only opt-out', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await statusFixture(page);
    const tabs = page.getByRole('navigation', { name: 'Project status' });
    const link = tabs.getByRole('link', { name: 'Done 1', exact: true });
    await hydrated(link);
    await expect(link).toHaveAttribute('href', '/app/projects?status=done');
    await instant(page, async () => {
        await link.click();
        await expect(page).toHaveURL(url => url.pathname === '/app/projects' && url.search === '?status=done');
        await expect(page.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Done projects' }).getByRole('link', { name: 'Finished site', exact: true })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Active projects' })).toBeHidden();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await capture(page, testInfo, 'done-list-immediate');
    });
    await page.goBack();
    await expect(page).toHaveURL(url => url.pathname === '/app/projects' && url.search === '');
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Ongoing site', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(url => url.pathname === '/app/projects' && url.search === '?status=done');
    await expect(page.getByRole('list', { name: 'Done projects' }).getByRole('link', { name: 'Finished site', exact: true })).toBeVisible();
    await page.reload();
    await expect(link).toHaveAttribute('aria-current', 'page');
});

test('Projects Done → Active is already immediate with keyboard focus retained', async ({ page }) => {
    test.setTimeout(60_000);
    await statusFixture(page);
    await page.goto('/app/projects?status=done');
    await expect(page.getByRole('list', { name: 'Done projects' }).getByRole('link', { name: 'Finished site', exact: true })).toBeVisible();
    const link = page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: 'Active 1', exact: true });
    await hydrated(link);
    await expect(link).toHaveAttribute('href', '/app/projects');
    await instant(page, async () => {
        await link.focus();
        await link.press('Enter');
        await expect(page).toHaveURL(url => url.pathname === '/app/projects' && url.search === '');
        await expect(page.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Ongoing site', exact: true })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Done projects' })).toBeHidden();
        await expect(link).toBeFocused();
    });
    await page.reload();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Ongoing site', exact: true })).toBeVisible();
});

test('Projects card → Project reads a changed private name at navigation', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await signIn(page, uniqueEmail('prefetch-freshness'));
    const project = await createProject(page, { urls: ['https://fresh.example.com'], name: 'Before navigation' });
    await page.goto('/app/projects');
    const link = page.getByRole('list', { name: 'Active projects' }).locator(`a[href="/app/projects/${project}"]`);
    await expect(link).toHaveText('Before navigation');
    await link.scrollIntoViewIfNeeded();
    await hydrated(link);

    const editor = await page.context().newPage();
    try {
        await editor.goto(`/app/projects/${project}/settings`);
        const general = editor.getByRole('region', { name: 'General', exact: true });
        await hydrated(general.locator('form'));
        await general.getByLabel('Project name', { exact: true }).fill('After navigation');
        await general.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(general.getByRole('status')).toHaveText('Saved.');
    } finally { await editor.close(); }

    await instant(page, async () => {
        await link.click();
        await expect(page).toHaveURL(url => url.pathname === `/app/projects/${project}` && url.search === '');
        await expect(page.getByRole('button', { name: 'Toggle sidebar' }).last()).toBeVisible();
        await expect(page.getByRole('status', { name: 'Loading project', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name: 'Before navigation', exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 1, name: 'After navigation', exact: true })).toHaveCount(0);
        await capture(page, testInfo, 'project-shell-before-private-read');
    });
    await expect(page.getByRole('heading', { level: 1, name: 'After navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Before navigation', exact: true })).toHaveCount(0);
    await capture(page, testInfo, 'project-fresh-name-after-navigation');
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { level: 1, name: 'After navigation', exact: true })).toBeVisible();
});
