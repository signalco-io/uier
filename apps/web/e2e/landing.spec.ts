import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { expectNoAxeViolations } from './accessibility';
import { showcaseHint, toolbar } from './support/toolbar';

test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${brand.name} · ${brand.tagline}`);
    await expect(page.getByRole('heading', { level: 1, name: brand.tagline })).toBeVisible();
    // Get started opens the app like the navigation's Sign in: sign in, or the app when signed in
    const getStarted = page.getByRole('link', { name: 'Get started' });
    await expect(getStarted.first()).toBeVisible();
    for (const link of await getStarted.all())
        await expect(link).toHaveAttribute('href', '/app');
    await expect(page.getByRole('main').getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how-it-works');
    // Sign in leads into the app: signed-out visitors land on sign in, signed-in people in the app
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/app');
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

test('landing page sections are reachable from the navigation', async ({ page }) => {
    await page.goto('/');
    for (const [id, heading] of [
        ['how-it-works', 'How it works'],
        ['features', 'What it does'],
        ['get-started', 'Get started'],
        ['pricing', 'Free, and it stays free'],
        ['faq', 'Questions']
    ] as const) {
        await expect(page.locator(`#${id}`), id).toHaveRole('heading');
        await expect(page.locator(`#${id}`), id).toHaveText(heading);
    }

    const sectionLinks = await page.getByRole('banner').locator('a[href^="/#"]')
        .evaluateAll(links => links.map(link => link.getAttribute('href')));
    expect(sectionLinks).toEqual(['/#how-it-works', '/#features', '/#pricing', '/#faq']);
});

test('pricing states the free offering and nothing else', async ({ page }) => {
    await page.goto('/');
    const pricing = page.getByRole('region', { name: 'Free, and it stays free' });
    await expect(pricing.getByText(brand.pricing)).toBeVisible();
    await expect(pricing.getByRole('heading', { level: 2, name: 'Free, and it stays free' })).toBeVisible();
    await expect(pricing.getByRole('heading', { level: 3, name: 'Included today' })).toBeVisible();
    await expect(pricing.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    // No invented prices, tiers or trials
    await expect(pricing).not.toContainText(/[$€£]\s?\d|\/\s?mo\b|per month|per year|trial|pro plan|enterprise/i);
});

test('FAQ answers open and close with the keyboard', async ({ page }) => {
    await page.goto('/');
    const faq = page.getByRole('region', { name: 'Questions' });
    const questions = faq.locator('summary');
    await expect(questions).not.toHaveCount(0);

    const ownSite = faq.locator('details').filter({ hasText: 'Can I use uier on my own website?' });
    await ownSite.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(ownSite).toHaveAttribute('open', '');
    await expect(ownSite.getByText(/^Yes\./)).toBeVisible();

    // A link in an open answer is the next stop for Tab
    await page.keyboard.press('Tab');
    await expect(ownSite.getByRole('link', { name: 'uier app' })).toBeFocused();
    await expect(ownSite.getByRole('link', { name: 'uier app' })).toHaveAttribute('href', '/app');

    await ownSite.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(ownSite).not.toHaveAttribute('open');

    const cost = faq.locator('details').filter({ hasText: 'What does it cost?' });
    await cost.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(cost.getByText(brand.pricing)).toBeVisible();

    // Every answer open at once still passes the accessibility checks
    for (const question of await questions.all())
        await question.evaluate(summary => summary.parentElement?.setAttribute('open', ''));
    await expectNoAxeViolations(page);
});
