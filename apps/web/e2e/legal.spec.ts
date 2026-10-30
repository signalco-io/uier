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
        if (document.path === '/legal/privacy-policy')
            await expect(page.getByRole('listitem').filter({ hasText: /^Deleted data can stay in backups for up to seven days\.$/ })).toBeVisible();

        // The legal navigation lists every document and marks this one
        const nav = page.getByRole('navigation', { name: 'Legal documents' });
        await expect(nav.getByRole('link')).toHaveCount(documents.length);
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', document.path);
    });

    test(`${document.title} is accessible`, ({ page }) => assertAccessibility(page, document.path));
}

test('the privacy and cookie policies describe Google sign-in', async ({ page }) => {
    await page.goto('/legal/privacy-policy');
    await expect(page.getByText(/^If you choose Continue with Google, you sign in at Google/)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /^A linked Google account: until you unlink it or ask us to delete your account\./ })).toBeVisible();
    await page.goto('/legal/cookie-policy');
    const cookie = page.getByRole('listitem').filter({ has: page.getByText('__Host-uier_google_sign_in', { exact: true }) });
    await expect(cookie).toContainText('Holds a signed record id, with no email address or Google data.');
    await expect(cookie).toContainText('at most 15 minutes');
});

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
