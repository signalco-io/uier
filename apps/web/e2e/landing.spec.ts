import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function assertAccessibility(page: Page, url: string) {
    await page.goto(url);
    await page.waitForTimeout(1000);
    const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag21aaa'])
        .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
}

test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('uier');
    await expect(page.getByRole('heading', { level: 1, name: 'uier' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/app');
    await expect(page.getByText(/Copyright © \d{4} uier\. All rights reserved\./)).toBeVisible();
});

test('landing page sends security headers', async ({ request }) => {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'];
    expect(csp).toContain('default-src \'self\'');
    expect(csp).toContain('frame-ancestors \'none\'');
    expect(response.headers()['strict-transport-security']).toContain('max-age=345600');
});

test('landing page is accessible', ({ page }) => assertAccessibility(page, '/'));
