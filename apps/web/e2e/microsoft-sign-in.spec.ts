import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail } from './support/app';

test('Microsoft sign-in confirms a chosen inbox once, signs in again and unlinks', async ({ page }) => {
    const email = uniqueEmail('microsoft-browser');
    await page.goto('/app/sign-in?next=/app/account');
    const button = page.getByRole('link', { name: 'Sign in with Microsoft' });
    await expect(button).toHaveAttribute('href', '/app/sign-in/microsoft?next=%2Fapp%2Faccount');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await button.click();
    await expect(page.getByRole('heading', { name: 'Choose a Microsoft test account' })).toBeVisible();
    const subject = await page.getByLabel('Subject').inputValue();
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail('microsoft-suggestion'));
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in/microsoft/link');
    await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.getByRole('status')).toContainText(email);
    await page.getByLabel('Sign-in code', { exact: true }).fill((await page.locator('[data-sign-in-code]').textContent())!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/app/account');
    const section = page.getByRole('region', { name: 'Microsoft account' });
    await expect(section).toContainText('Linked to');

    // Linked sign-in needs no email claim or repeat email proof.
    await page.context().clearCookies();
    await page.goto('/app/sign-in?next=/app/account');
    await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
    await page.getByLabel('Subject').fill(subject);
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(url => url.pathname === '/app/account');
    await expect(page.getByRole('main')).toContainText(email);
    await section.getByRole('button', { name: 'Unlink Microsoft account' }).click();
    await expect(section.getByRole('status')).toHaveText('Microsoft account unlinked. Sign in with your email from now on.');
    await expect(section).toContainText('No Microsoft account is linked.');
    await expect(section.getByRole('link', { name: 'Link Microsoft account' })).toHaveAttribute('href', '/app/sign-in/microsoft?intent=link');
});

test('Microsoft cancellation returns a bounded reason and Account can link without an email claim', async ({ page }) => {
    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in' && url.searchParams.get('microsoft') === 'cancelled');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Microsoft sign-in was cancelled.');
    await signIn(page, uniqueEmail('ms-link-account'));
    await page.goto('/app/account');
    const section = page.getByRole('region', { name: 'Microsoft account' });
    await section.getByRole('link', { name: 'Link Microsoft account' }).click();
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(url => url.pathname === '/app/account' && url.searchParams.get('microsoft') === 'linked');
    await expect(section).toContainText('A Microsoft account is linked.');
    await expect(section.getByRole('button', { name: 'Unlink Microsoft account' })).toBeVisible();
});

test('a Microsoft account without an email claim can choose an inbox', async ({ page }) => {
    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(url => url.pathname === '/app/sign-in/microsoft/link');
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
    const email = uniqueEmail('ms-missing-claim');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await page.getByLabel('Sign-in code', { exact: true }).fill((await page.locator('[data-sign-in-code]').textContent())!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
});
