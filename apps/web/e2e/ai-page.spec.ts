import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

// /features/ai: the MCP connector for coding tools and rewrite suggestions, in the app's own words
// (the operation labels of src/components/app/mcp/scopes.ts, the prompts of src/lib/mcp/workflows.ts)

const path = '/features/ai';

test('the AI page explains the coding tool connection and rewrite suggestions', async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`AI for website feedback · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Hand the feedback to your coding agent' })).toBeVisible();
    for (const name of ['How it works', 'Connect your coding tool', 'What your agent can do', 'Prompts and a skill', 'You stay in control', 'Rewrite suggestions', 'Try it', 'Questions'])
        await expect(page.getByRole('region', { name, exact: true }), name).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    await main.getByRole('link', { name: 'Connect a coding tool' }).click();
    await expect(page).toHaveURL(/#connect$/);
    const connect = page.getByRole('region', { name: 'Connect your coding tool', exact: true });
    await expect(connect).toContainText(`claude mcp add --transport http ${brand.name} ${brand.url}/api/mcp`);
    for (const tool of ['Claude Code', 'Codex', 'Cursor'])
        await expect(connect.getByRole('heading', { name: tool, exact: true })).toBeVisible();

    const operations = page.getByRole('table', { name: 'Operations a coding tool connection can have and what each allows' });
    for (const operation of ['Read feedback', 'Read screenshots', 'Reply to feedback', 'Change status', 'Assign feedback'])
        await expect(operations.getByRole('rowheader', { name: operation, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What your agent can do', exact: true })).toContainText('cannot edit code, run commands, deploy, delete feedback or confirm a fix');
    const prompts = page.getByRole('region', { name: 'Prompts and a skill', exact: true });
    for (const prompt of ['triage-feedback', 'fix-feedback', 'report-back'])
        await expect(prompts.getByText(prompt, { exact: true })).toBeVisible();
    await expect(prompts).toContainText('watch a project for new feedback, replies and status changes');

    await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
    await expect(main.getByRole('link', { name: 'main questions' })).toHaveAttribute('href', '/#faq');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'AI features' })).toHaveAttribute('href', path);

    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    const confirm = questions.locator('details').filter({ hasText: 'Can an agent confirm a fix?' });
    await confirm.locator('summary').click();
    await expect(confirm.getByRole('link', { name: 'Fix verification' })).toHaveAttribute('href', '/features/fix-verification');
    const model = questions.locator('details').filter({ hasText: 'send my feedback to an AI model?' });
    await model.locator('summary').click();
    await expect(model.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/legal/privacy-policy');
    const cost = questions.locator('details').filter({ hasText: 'What does it cost?' });
    await cost.locator('summary').click();
    await expect(cost.getByText(brand.pricing)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the landing page leads to the AI page', async ({ page }) => {
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    await expect(features.getByRole('heading', { name: 'Let your coding agent fix it' })).toBeVisible();
    await expect(features.getByRole('link', { name: `AI in ${brand.name}` })).toHaveAttribute('href', path);
    await expect(features.getByRole('link', { name: 'AI rewrite suggestions' })).toHaveAttribute('href', `${path}#rewrite-suggestions`);
    const question = page.getByRole('region', { name: 'Questions' }).locator('details').filter({ hasText: 'Can developers and AI agents use the feedback?' });
    await question.locator('summary').click();
    await expect(question.getByRole('link', { name: 'AI features' })).toHaveAttribute('href', path);
});

test('the AI page is accessible', ({ page }) => assertAccessibility(page, path));
