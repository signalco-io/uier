import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { expectNoAxeViolations } from './accessibility';
import { showcaseHint, toolbar } from './support/toolbar';

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

test('landing page is accessible (with the showcase toolbar)', async ({ page }) => {
    await page.goto('/');
    await expect(toolbar(page)).toBeVisible();
    await expect(showcaseHint(page)).toBeVisible();
    await expectNoAxeViolations(page);
});

test('toolbar bundle is served at /toolbar.js', async ({ request }) => {
    const response = await request.get('/toolbar.js');
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers['content-type']).toMatch(/^application\/javascript\b/);
    expect(headers['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    expect(headers['access-control-allow-origin']).toBe('*');

    // The production build of packages/toolbar, with its CSS inlined
    const body = await response.text();
    expect(body).toContain('uier-toolbar');
    expect(body).not.toContain('__uier_toolbar_css__');
    expect(body).not.toContain('http://localhost:4004');
});
