import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail } from './support/app';

// The browser journey through the local Google stand-in (e2e/support/googleStub.ts). Linking rules,
// replays and bindings are covered by google-sign-in.api.spec.ts.
test('Sign in with Google confirms a non-Gmail address by email, links the account and can be unlinked', async ({ page }) => {
    const email = uniqueEmail('google-browser');
    await page.goto('/app/sign-in?next=/app/account/sign-in');
    const google = page.getByRole('link', { name: 'Sign in with Google' });
    await expect(google).toHaveAttribute('href', '/app/sign-in/google?next=%2Fapp%2Faccount%2Fsign-in');
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

    await page.waitForURL(url => url.pathname === '/app/account/sign-in');
    const section = page.getByRole('region', { name: 'Google account' });
    await expect(section).toContainText(`Linked to ${email}.`);
    // Each sign-in method's card carries its mark: Google's "G" (uier #204)
    await expect(section.locator('h2 [data-section-icon] svg')).toBeVisible();

    await section.getByRole('button', { name: 'Unlink Google account' }).click();
    await expect(section.getByRole('status')).toHaveText('Google account unlinked. Sign in with your email from now on.');
    await expect(section).toContainText('No Google account is linked.');
    await expect(section.getByRole('link', { name: 'Link Google account' })).toHaveAttribute('href', '/app/sign-in/google?intent=link');

    // A cancelled consent comes back to sign in with the reason
    await page.context().clearCookies();
    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Sign in with Google' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in' && url.searchParams.get('google') === 'cancelled');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Google sign-in was cancelled.');
});

test('a Google sign-in is not a recent one unless Google confirms it, and Sign in again says what is', async ({ page }) => {
    // Google is authoritative for Gmail: this signs up at once
    const email = `google-recent-${uniqueEmail().split('@')[0]}@gmail.com`;
    await page.goto('/app/sign-in?next=/app/account/sign-in');
    await page.getByRole('link', { name: 'Sign in with Google' }).click();
    const subject = await page.getByLabel('Subject').inputValue();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(url => url.pathname === '/app/account/sign-in');

    // Google continued its own session: adding a passkey and linking another provider wait for a recent sign-in
    const passkeys = page.getByRole('region', { name: 'Passkeys' });
    await expect(passkeys).toContainText('To add a passkey, sign in again.');
    await expect(passkeys.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Microsoft account' }).getByRole('link', { name: 'Link Microsoft account' })).toHaveCount(0);
    await passkeys.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in again' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('A passkey or an email code always works. Google and Microsoft work only when they confirm you just signed in there.');

    // Google cannot be asked to authenticate again: the same session changes nothing
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/app/sign-in/google?next=%2Fapp%2Faccount%2Fsign-in&add=1&again=1');
    await page.getByRole('link', { name: 'Sign in with Google' }).click();
    await expect(page.getByLabel('Signed in here just now')).not.toBeChecked();
    await page.getByLabel('Subject').fill(subject);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in\?add=1&again=1&next=%2Fapp%2Faccount%2Fsign-in&google=not_recent$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Google did not confirm a new sign-in. Use a passkey or an email code.');

    // An email code is a new sign-in by itself
    await signIn(page, email, { from: page.url() });
    await expect(page).toHaveURL(/\/app\/account\/sign-in$/);
    await expect(passkeys.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Microsoft account' }).getByRole('link', { name: 'Link Microsoft account' })).toBeVisible();
});
