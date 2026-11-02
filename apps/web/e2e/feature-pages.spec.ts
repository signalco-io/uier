import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

// The claims on /features/feedback-triage are the shipped bounds (docs/review-workflow.md,
// "Search, priority and bulk triage"); keep them in step with the app.

test('feedback triage states the shipped workflow, its bounds and its next steps', async ({ page }) => {
    const response = await page.goto('/features/feedback-triage');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Feedback triage · ${brand.name}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Feedback triage' })).toBeVisible();
    for (const link of await main.getByRole('link', { name: 'Get started' }).all())
        await expect(link).toHaveAttribute('href', '/app');
    await main.getByRole('link', { name: 'See the limits' }).click();
    await expect(page).toHaveURL(/#limits$/);

    const limits = page.getByRole('region', { name: 'Limits' });
    await expect(limits.getByRole('heading', { name: '1,000 recent threads' })).toBeVisible();
    await expect(limits.getByRole('heading', { name: '50 threads per action' })).toBeVisible();
    await expect(limits).toContainText('There is no search across projects');
    await expect(limits).toContainText('They do not delete threads');
    const selection = page.getByRole('region', { name: 'Act on a selection' });
    for (const action of ['Assign selected', 'Set priority', 'Mark selected as done', 'Reopen selected'])
        await expect(selection.getByRole('heading', { name: action, exact: true })).toBeVisible();
    const results = page.getByRole('region', { name: 'Partial results and retries' });
    for (const outcome of ['Changed', 'Unchanged', 'Stale', 'Unavailable', 'Failed'])
        await expect(results.getByRole('listitem').filter({ hasText: outcome }).first()).toBeVisible();
    await expect(results).toContainText('Retry failed threads');
    await expect(page.getByRole('region', { name: 'Who can triage' })).toContainText('cannot change it');
    // Done is the ordinary status; reviewer confirmation is not described until it ships.
    await expect(main).not.toContainText(/unlimited|confirm|verif/i);

    const start = page.getByRole('region', { name: 'Try it in a project' });
    await expect(start.getByText(brand.pricing, { exact: true })).toBeVisible();
    await expect(start.getByRole('link', { name: 'integrations' })).toHaveAttribute('href', '/integrations');
    await expect(start.getByRole('link', { name: `what else ${brand.name} does` })).toHaveAttribute('href', '/#features');
    await expect(start.getByRole('link', { name: 'review workflow guide' }))
        .toHaveAttribute('href', `${brand.repository}/blob/main/docs/review-workflow.md#search-priority-and-bulk-triage`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the homepage, its questions and the footer lead to feedback triage', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'What it does' }).getByRole('link', { name: 'bulk triage' }))
        .toHaveAttribute('href', '/features/feedback-triage');
    const question = page.getByRole('region', { name: 'Questions' }).locator('details').filter({ hasText: 'How do I sort through a lot of feedback?' });
    await question.locator('summary').click();
    await expect(question.getByRole('link', { name: 'Feedback triage' })).toHaveAttribute('href', '/features/feedback-triage');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Feedback triage', exact: true })).toHaveAttribute('href', '/features/feedback-triage');
});

test('feedback triage is accessible', ({ page }) => assertAccessibility(page, '/features/feedback-triage'));
