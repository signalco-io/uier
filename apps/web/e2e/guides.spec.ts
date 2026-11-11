import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { guides } from '../src/lib/guides';
import { nextJsSnippet } from '../src/lib/app/integration';
import { assertAccessibility } from './accessibility';

test('guides link the shipped workflow and show the same Next.js snippet as installation', async ({ page }) => {
    await page.goto('/guides');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Guides', exact: true })).toHaveAttribute('href', '/guides');
    await page.locator(`main a[href="${guides.nextJs.path}"]`).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.nextJs.title })).toBeVisible();
    await expect(page.locator('main pre code')).toHaveText(nextJsSnippet(brand.url, 'YOUR_PROJECT_CODE'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Plan a client review' }).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.clientReviews.title })).toBeVisible();
    await expect(page.locator('main a[href="/features/fix-verification"]')).toBeVisible();
    await expect(page.locator('main a[href="/features/feedback-triage"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('each guide links back to the guides and outlines its sections', async ({ page }) => {
    for (const guide of [guides.clientReviews, guides.nextJs, guides.browserExtension]) {
        await page.goto(guide.path);
        await expect(page.getByRole('main').getByRole('link', { name: 'Guides', exact: true })).toHaveAttribute('href', guides.index.path);
        const hrefs = await page.getByRole('navigation', { name: 'In this guide' }).getByRole('link')
            .evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''));
        expect(hrefs.length, guide.path).toBeGreaterThan(2);
        for (const href of hrefs) await expect(page.locator(`main section${href}`), `${guide.path}${href}`).toHaveCount(1);
    }
});

for (const guide of Object.values(guides))
    test(`${guide.path} is accessible`, ({ page }) => assertAccessibility(page, guide.path));
