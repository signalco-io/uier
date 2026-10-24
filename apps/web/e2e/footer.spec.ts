import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';

// Every public page shares the footer from the marketing layout
const publicPages = ['/', '/brand', '/legal/privacy-policy'];

test('footer is on every public page', async ({ page }) => {
    for (const path of publicPages) {
        await page.goto(path);
        const footer = page.getByRole('contentinfo');
        await expect(footer, path).toBeVisible();
        await expect(footer.getByText(new RegExp(`© \\d{4} ${brand.name}`)), path).toBeVisible();
    }
});

test('footer links to the contact and social destinations', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: brand.contact.email })).toHaveAttribute('href', `mailto:${brand.contact.email}`);
    await expect(footer.getByRole('link', { name: 'Report an issue' })).toHaveAttribute('href', brand.issues);
    await expect(footer.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', brand.social.github);
    await expect(footer.getByRole('link', { name: 'signalco on X' })).toHaveAttribute('href', brand.social.x);
    await expect(footer.getByRole('link', { name: `A ${brand.parent.name} project` })).toHaveAttribute('href', brand.parent.url);
});

test('every internal footer link resolves', async ({ page, request }) => {
    await page.goto('/');
    const hrefs = await page.getByRole('contentinfo').locator('a[href^="/"]')
        .evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
        const response = await request.get(href);
        expect(response.status(), href).toBe(200);
    }
});
