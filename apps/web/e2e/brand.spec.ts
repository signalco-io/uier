import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

test('brand page renders from the brand package', async ({ page }) => {
    const response = await page.goto('/brand');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Brand · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: `${brand.name} brand` })).toBeVisible();
    await expect(page.getByText(brand.tagline).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'BRAND.md' }).first()).toHaveAttribute('href', /packages\/brand\/BRAND\.md$/);
});

test('brand assets are served', async ({ request }) => {
    for (const path of ['/favicon.svg', '/apple-touch-icon.png', '/android-chrome-512x512.png', '/manifest.webmanifest', '/opengraph-image']) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(200);
    }
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.name).toBe(brand.name);
});

test('brand page is accessible', ({ page }) => assertAccessibility(page, '/brand'));
