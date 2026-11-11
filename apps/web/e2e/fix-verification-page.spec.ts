import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

// /features/fix-verification: the reviewer's confirmation stays apart from Done, a connected
// service's closure and MCP status, in the shipped thread labels (#333)

const path = '/features/fix-verification';

test('fix verification page explains who can confirm a fix', async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Fix verification for website feedback · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ask the reviewer to confirm the fix' })).toBeVisible();
    for (const name of ['How it works', 'Who can decide', 'Done is not the same as confirmed', 'Fix links', 'Where it helps', 'Try it', 'Questions'])
        await expect(page.getByRole('region', { name, exact: true }), name).toBeVisible();

    const actions = page.getByRole('table', { name: 'Fix verification actions, who can take them and what happens' });
    const row = (action: string) => actions.getByRole('row').filter({ has: page.getByRole('rowheader', { name: action, exact: true }) });
    await expect(row('Request verification')).toContainText('even if it was done');
    await expect(row('Confirm fix')).toContainText('The requested reviewer');
    await expect(row('Still needs work')).toContainText('In progress, marked Still needs work.');
    await expect(row('Cancel request')).toContainText('where it was before the request');
    await expect(row('Confirm fix as admin, Still needs work as admin')).toContainText('labeled as an admin override');
    await expect(row('Done without verification')).toContainText('Done without reviewer confirmation.');
    await expect(row('Reopen')).toContainText('history only');

    const useCases = page.getByRole('region', { name: 'Where it helps', exact: true });
    for (const name of ['Client review', 'Bug reports', 'Acceptance testing'])
        await expect(useCases.getByRole('heading', { level: 3, name, exact: true }).locator('xpath=../..').locator('svg'), name).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
    await expect(main.getByRole('link', { name: 'main questions' })).toHaveAttribute('href', '/#faq');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Fix verification' })).toHaveAttribute('href', path);
    const done = page.getByRole('region', { name: 'Done is not the same as confirmed', exact: true });
    await expect(done).toContainText(/ordinary completion, never a reviewer.s confirmation/);
    await expect(done.getByRole('link', { name: 'bulk triage' })).toHaveAttribute('href', '/features/feedback-triage');

    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    const tracker = questions.locator('details').filter({ hasText: 'Does closing the issue in GitHub or Linear confirm the fix?' });
    await tracker.locator('summary').click();
    await expect(tracker.getByRole('link', { name: 'connected service' })).toHaveAttribute('href', '/integrations');
    const cost = questions.locator('details').filter({ hasText: 'What does it cost?' });
    await cost.locator('summary').click();
    await expect(cost.getByText(brand.pricing)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the landing questions link to fix verification', async ({ page }) => {
    await page.goto('/');
    const question = page.getByRole('region', { name: 'Questions' }).locator('details').filter({ hasText: 'Can the reviewer confirm that a fix works?' });
    await question.locator('summary').click();
    await expect(question.getByRole('link', { name: 'Fix verification' })).toHaveAttribute('href', path);
});

test('fix verification page is accessible', ({ page }) => assertAccessibility(page, path));
