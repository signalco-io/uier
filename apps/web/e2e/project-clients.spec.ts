import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

test('client names validate, normalize, persist in details and can be cleared', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('client'));
    await page.getByLabel('Main site address').fill('clients.example.com');
    const input = page.getByLabel('Client name (optional)');
    await expect(input).toHaveAttribute('maxlength', '80');
    // Bypass the input limit to exercise server validation before creating anything.
    await input.evaluate(element => element.removeAttribute('maxlength'));
    await input.fill('x'.repeat(81));
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Use at most 80 characters for the client name.');
    await expect(input).toHaveValue('x'.repeat(81));
    await input.fill('  North   & South  ');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-z]{12}\/install$/);
    const projectId = page.url().split('/').at(-2)!;
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByText('Client: North & South', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Client: North & South', { exact: true })).toBeVisible();

    await page.goto(`/app/projects/${projectId}/settings`);
    const client = page.getByRole('region', { name: 'Client', exact: true });
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('North & South');
    await client.getByLabel('Client name (optional)').evaluate(element => element.removeAttribute('maxlength'));
    await client.getByLabel('Client name (optional)').fill('x'.repeat(81));
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('alert')).toHaveText('Use at most 80 characters for the client name.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('North & South');
    await client.getByLabel('Client name (optional)').fill('A'.repeat(80));
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('The client name is saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('A'.repeat(80));
    await client.getByLabel('Client name (optional)').fill('  New   client  ');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('The client name is saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('New client');
    await expect(page.getByText('Client: New client', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await client.screenshot({ path: testInfo.outputPath('client-settings-dark.png') });

    await client.getByLabel('Client name (optional)').fill('   ');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('The client name is saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('');
    await expect(page.getByText(/^Client: /)).toHaveCount(0);
    await page.goto('/app/projects?client=none');
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'clients.example.com' })).toBeVisible();
});

test('client filtering combines with status and survives reloads', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('client-filter'));
    await createProject(page, { urls: ['active.example.com'], name: 'Active north', clientName: 'North & South' });
    const doneId = await createProject(page, { urls: ['done.example.com'], name: 'Done north', clientName: 'North & South' });
    await page.goto(`/app/projects/${doneId}/settings`);
    await page.getByRole('button', { name: 'Mark as done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen project' })).toBeVisible();
    await createProject(page, { urls: ['another.example.com'], name: 'Another client', clientName: 'none' });
    await createProject(page, { urls: ['no-client.example.com'], name: 'No client site' });
    await page.goto('/app/projects');
    const filter = page.getByRole('combobox', { name: 'Client', exact: true });
    const chooseClient = async (name: string) => {
        await filter.click();
        await page.getByRole('option', { name, exact: true }).click();
        await expect(filter).toContainText(name);
        await expect(page).toHaveURL(url => url.searchParams.get('client') === (name === 'All clients' ? null : name === 'No client' ? 'none' : `name:${name}`));
    };
    await chooseClient('North & South');
    const active = page.getByRole('list', { name: 'Active projects' });
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('Active north');
    await expect(active).toContainText('Client: North & South');
    await expect(page.getByRole('link', { name: 'Active 1', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Done 1', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('client-filter-light.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Done/ }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('status') === 'done');
    await page.reload();
    await expect(filter).toContainText('North & South');
    await expect(page.getByRole('list', { name: 'Done projects' })).toContainText('Done north');
    await chooseClient('No client');
    await expect(page.getByText('No done projects', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Done/ })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Active/ }).click();
    await expect(filter).toContainText('No client');
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('No client site');
    await chooseClient('none'); // A client literally named "none" is distinct from No client.
    await page.reload();
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('Another client');
    await chooseClient('All clients');
    await expect(active.getByRole('listitem')).toHaveCount(3);
    await expect(page).toHaveURL(/\/app\/projects$/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('client-filter-dark.png'), fullPage: true });
});

test('client names and updates stay in the current workspace and out of guest DTOs', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('client-owner'));
    const projectId = await createProject(page, { urls: ['private-client.example.com'], clientName: 'Private client' });
    const other = await newVisitor(browser, testInfo);
    await signIn(other.page, uniqueEmail('client-other'));
    const otherId = await createProject(other.page, { urls: ['other-client.example.com'], clientName: 'Other client' });
    await other.page.goto('/app/projects?client=name%3APrivate%20client');
    await other.page.getByRole('combobox', { name: 'Client', exact: true }).click();
    await expect(other.page.getByRole('option', { name: 'Private client', exact: true })).toHaveCount(0);
    await expect(other.page.getByRole('option', { name: 'Other client', exact: true })).toBeVisible();
    await other.page.keyboard.press('Escape');
    expect((await other.page.request.get(`/app/projects/${projectId}`)).status()).toBe(404);
    await other.page.goto(`/app/projects/${otherId}/settings`);
    const client = other.page.getByRole('region', { name: 'Client', exact: true });
    // An admin of a different workspace cannot use a known project id to update it.
    await client.locator('input[name="projectId"]').evaluate((element, id) => { (element as HTMLInputElement).value = id; }, projectId);
    await client.getByLabel('Client name (optional)').fill('Unauthorized change');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('alert')).toHaveText('This project no longer exists.');
    await other.page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('Other client');
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByText('Client: Private client', { exact: true })).toBeVisible();
    const response = await other.page.request.get(`/api/review/${projectId}`, { headers: { Origin: 'https://private-client.example.com' } });
    expect(response.status()).toBe(200);
    expect((await response.json()).project).not.toHaveProperty('clientName');
    await other.context.close();
});
