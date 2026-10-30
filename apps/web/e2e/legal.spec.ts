import { expect, test } from '@playwright/test';
import { assertAccessibility } from './accessibility';

const documents = [
    { path: '/legal/privacy-policy', title: 'Privacy policy' },
    { path: '/legal/terms-of-service', title: 'Terms of service' },
    { path: '/legal/cookie-policy', title: 'Cookie policy' },
    { path: '/legal/acceptable-use-policy', title: 'Acceptable use policy' },
    { path: '/legal/sla', title: 'Service level agreement' }
];

for (const document of documents) {
    test(`${document.title} is published`, async ({ page }) => {
        const response = await page.goto(document.path);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { level: 1, name: document.title })).toBeVisible();
        await expect(page.getByText(/^Effective \d{1,2} \w+ \d{4}$/)).toBeVisible();
        if (document.path === '/legal/privacy-policy') {
            await expect(page.getByRole('listitem').filter({ hasText: /^Deleted data can stay in backups for up to seven days\.$/ })).toBeVisible();
            await expect(page.getByRole('listitem').filter({ hasText: /^Passkeys: until you remove them on your Account page, or with your account\./ })).toBeVisible();
            await expect(page.getByText(/Your fingerprint, face or screen lock only unlocks the passkey on your device; none of it reaches us\./)).toBeVisible();
        }
        if (document.path === '/legal/cookie-policy')
            await expect(page.getByRole('main').getByText('__Host-uier_passkey_challenge', { exact: true })).toBeVisible();

        // The legal navigation lists every document and marks this one
        const nav = page.getByRole('navigation', { name: 'Legal documents' });
        await expect(nav.getByRole('link')).toHaveCount(documents.length);
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', document.path);
    });

    test(`${document.title} is accessible`, ({ page }) => assertAccessibility(page, document.path));
}

test('legal navigation and footer links reach the documents', async ({ page, request }) => {
    await page.goto('/');
    const footerLinks = page.getByRole('contentinfo').locator('a[href^="/legal/"]');
    await expect(footerLinks).toHaveCount(documents.length);
    for (const href of await footerLinks.evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))) {
        expect((await request.get(href)).status(), href).toBe(200);
    }

    await page.goto(documents[0]!.path);
    const navLinks = page.getByRole('navigation', { name: 'Legal documents' }).getByRole('link');
    for (const href of await navLinks.evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))) {
        expect((await request.get(href)).status(), href).toBe(200);
    }
});
