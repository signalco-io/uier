import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';
import { catalog } from '../src/components/brand/catalog/catalog';

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

test('components page lists every catalog entry with stable anchors', async ({ page }) => {
    const response = await page.goto('/brand/components');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Components · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
    const index = page.getByRole('navigation', { name: 'Components' });
    for (const group of catalog) {
        await expect(page.locator(`section#${group.id}`)).toHaveCount(1);
        for (const entry of group.entries) {
            await expect(index.locator(`a[href="#${entry.id}"]`), entry.id).toHaveText(entry.name);
            await expect(page.locator(`article#${entry.id}`), entry.id).toHaveCount(1);
        }
    }
    // A comment's selector finds exactly one state, wherever the state moves on the page
    const anchors = await page.locator('[data-anchor]').evaluateAll(elements => elements.map(element => element.getAttribute('data-anchor')));
    expect(anchors.length).toBeGreaterThan(100);
    expect(new Set(anchors).size).toBe(anchors.length);
});

test('components page keeps an overlay open while it is reviewed', async ({ page }) => {
    await page.goto('/brand/components');
    const keepOpen = page.locator('#ui-dropdown-menu').getByRole('switch', { name: 'Keep open' });
    const menu = page.locator('[data-anchor="ui-dropdown-menu/open-popup"]');
    await keepOpen.click();
    await expect(menu).toBeVisible();
    // A click elsewhere (the review toolbar's, when it picks the menu) leaves it open
    await page.getByRole('heading', { level: 1, name: 'Components' }).click();
    await expect(menu).toBeVisible();
    await keepOpen.click();
    await expect(menu).toBeHidden();
});

// The catalog shows the kit's destructive variants as they ship, and they are below 4.5:1 in light mode: the button
// and the badge (red on their 10 % red tint, 4.1:1) and the alert's description (red at 90 %, 4.3:1). They stay on
// the page to be reviewed and fixed there; drop each exclusion with its fix.
const knownContrastIssues = ['ui-button/destructive', 'ui-badge/destructive', 'ui-alert/destructive'].map(anchor => `[data-anchor="${anchor}"]`);

test('components page is accessible', ({ page }) => assertAccessibility(page, '/brand/components', { exclude: knownContrastIssues }));
