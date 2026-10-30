import { expect, test } from '@playwright/test';
import { uniqueEmail } from './support/app';

// The browser journey through the local Google stand-in (e2e/support/googleStub.ts). Linking rules,
// replays and bindings are covered by google-sign-in.api.spec.ts.
test('Continue with Google confirms a non-Gmail address by email, links the account and can be unlinked', async ({ page }) => {
    const email = uniqueEmail('google-browser');
    await page.goto('/app/sign-in?next=/app/account');
    const google = page.getByRole('link', { name: 'Continue with Google' });
    await expect(google).toHaveAttribute('href', '/app/sign-in/google?next=%2Fapp%2Faccount');
    await google.click();

    await expect(page.getByRole('heading', { name: 'Choose a Google test account' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Allow' }).click();

    // Google is not authoritative for this address: the inbox is proven once, in this browser
    await page.waitForURL(url => url.pathname === '/app/sign-in/google/link');
    await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(`Confirm ${email} once with an email code`);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.getByRole('status')).toContainText(`We sent a code and a sign-in link to ${email}`);
    await page.getByLabel('Sign-in code', { exact: true }).fill((await page.locator('[data-sign-in-code]').textContent())!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await page.waitForURL(url => url.pathname === '/app/account');
    const section = page.getByRole('region', { name: 'Google account' });
    await expect(section).toContainText(`Linked to ${email}.`);

    await section.getByRole('button', { name: 'Unlink Google account' }).click();
    await expect(section.getByRole('status')).toHaveText('Google account unlinked. Sign in with your email from now on.');
    await expect(section).toContainText('No Google account is linked.');
    await expect(section.getByRole('link', { name: 'Link Google account' })).toHaveAttribute('href', '/app/sign-in/google?intent=link');

    // A cancelled consent comes back to sign in with the reason
    await page.context().clearCookies();
    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in' && url.searchParams.get('google') === 'cancelled');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Google sign-in was cancelled.');
});
