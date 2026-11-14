import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

// /features/page-checks: the toolbar's Accessibility and SEO panels and the app's Page checks view,
// in their shipped words and bounds (packages/toolbar/docs/page-checks.md, apps/web/docs/page-checks.md)

const path = '/features/page-checks';

test('the page checks page explains the panels, the comments and the app view', async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Accessibility, SEO and security checks · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Check each page as you review it' })).toBeVisible();
    // The animated cover under the header: a picture, with Pause for its loop
    await expect(page.locator('[data-feature-cover="page-checks"]')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('button', { name: 'Pause the animation' })).toBeVisible();
    for (const name of ['How it works', 'Accessibility', 'SEO', 'Security and compliance', 'From finding to comment', 'Across your pages', 'What the checks cannot tell you', 'Try it', 'Questions'])
        await expect(page.getByRole('region', { name, exact: true }), name).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
    await main.getByRole('link', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/#how-it-works$/);

    const accessibility = page.getByRole('region', { name: 'Accessibility', exact: true });
    await expect(accessibility).toContainText('WCAG 2.2 target size');
    await expect(accessibility).toContainText('It is not counted as an issue.');
    const seo = page.getByRole('region', { name: 'SEO', exact: true });
    await expect(seo).toContainText('measured in your browser against 2.5 s, 0.1 and 200 ms');
    await expect(seo).toContainText('up to 100 of its own links');

    const security = page.getByRole('region', { name: 'Security and compliance', exact: true });
    await expect(security).toContainText('explicitly request this page without cookies');
    await expect(security).toContainText('Sensitive files are not probed');
    await expect(security).toContainText('do not certify security or legal compliance');

    const findings = page.getByRole('region', { name: 'From finding to comment', exact: true });
    for (const action of ['Highlight', 'Comment on all', 'Not an issue'])
        await expect(findings.getByRole('listitem').filter({ hasText: action }).first(), action).toBeVisible();
    await expect(findings).toContainText('Hides a finding in this browser only.');
    await expect(findings.getByRole('link', { name: 'MCP connector' })).toHaveAttribute('href', '/features/ai');

    const across = page.getByRole('region', { name: 'Across your pages', exact: true });
    await expect(across).toContainText('Guests and public viewers send none');
    await expect(across).toContainText('up to 200 pages, each for 90 days after its last check');
    const limits = page.getByRole('region', { name: 'What the checks cannot tell you', exact: true });
    await expect(limits).toContainText('Automated checks find only some accessibility issues.');
    await expect(limits).toContainText('Confirming a fix is up to a person.');

    await expect(main.getByRole('link', { name: 'main questions' })).toHaveAttribute('href', '/#faq');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Page checks', exact: true })).toHaveAttribute('href', path);

    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    const privacy = questions.locator('details').filter({ hasText: 'Does it send my page anywhere?' });
    await privacy.locator('summary').click();
    await expect(privacy).toContainText('only when you ask for them');
    await expect(privacy.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/legal/privacy-policy');
    const recheck = questions.locator('details').filter({ hasText: 'Can a fixed finding be checked again?' });
    await recheck.locator('summary').click();
    await expect(recheck.getByRole('link', { name: 'Fix verification' })).toHaveAttribute('href', '/features/fix-verification');
    const extension = questions.locator('details').filter({ hasText: 'Does it work in the browser extension?' });
    await extension.locator('summary').click();
    await expect(extension.getByRole('link', { name: 'browser extension' })).toHaveAttribute('href', '/browser-extension');
    const cost = questions.locator('details').filter({ hasText: 'What does it cost?' });
    await cost.locator('summary').click();
    await expect(cost.getByText(brand.pricing)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the landing page leads to the page checks page', async ({ page }) => {
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    await expect(features.getByRole('heading', { name: 'Accessibility and SEO checks' })).toBeVisible();
    // The tile is one link, to this page
    await expect(features.getByRole('link', { name: 'More on page checks', exact: true })).toHaveAttribute('href', path);
    const question = page.getByRole('region', { name: 'Questions' }).locator('details').filter({ hasText: 'What do the accessibility and SEO checks look at?' });
    // The keyboard, as in landing.spec.ts: on a phone the toolbar can cover the summary while it settles
    await question.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(question.getByRole('link', { name: 'Page checks' })).toHaveAttribute('href', path);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Page checks', exact: true })).toHaveAttribute('href', path);
});

test('the page checks page is accessible', ({ page }) => assertAccessibility(page, path));

test('the cover shows one still frame with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    await page.locator('[data-feature-cover="page-checks"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-feature-cover-caption] p:not(.invisible)')).toHaveText('The Accessibility panel beside the page, and a contrast issue it found posted as a comment on the price.');
    await expect(page.getByRole('button', { name: /^(Pause|Play) the animation$/ })).toHaveCount(0);
});
