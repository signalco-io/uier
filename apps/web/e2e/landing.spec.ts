import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${brand.name} · ${brand.tagline}`);
    await expect(page.getByRole('heading', { level: 1, name: brand.tagline })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    await expect(page.getByText(new RegExp(`© \\d{4} ${brand.name}`))).toBeVisible();
});

test('landing page sends security headers', async ({ request }) => {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'];
    expect(csp).toContain('default-src \'self\'');
    expect(csp).toContain('frame-ancestors \'none\'');
    expect(response.headers()['strict-transport-security']).toContain('max-age=345600');
});

test('landing page is accessible', ({ page }) => assertAccessibility(page, '/'));
