import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The license a package declares in its package.json */
function declaredLicense(path: string) {
    return (JSON.parse(readFileSync(join(repositoryRoot, path, 'package.json'), 'utf8')) as { license: string }).license;
}

test('security page publishes the reporting contact and the controls', async ({ page }) => {
    const response = await page.goto('/security');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Security · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Report a vulnerability' })).toHaveAttribute('href', `mailto:${brand.contact.security}`);
    await expect(page.getByRole('main').getByRole('link', { name: brand.contact.security })).toHaveAttribute('href', `mailto:${brand.contact.security}`);
    await expect(page.getByRole('region', { name: 'How uier is protected' }).getByRole('heading', { level: 3 })).not.toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: 'Continuous backups', exact: true })).toBeVisible();
    await expect(page.getByText('Production data has continuous backup with a seven-day point-in-time restore window in West Europe.', { exact: true })).toBeVisible();
    await expect(page.getByText('Keys live in the hosting environment, set by the infrastructure code. CI signs in to Azure with short-lived OIDC tokens instead of stored credentials. Deletion protection for data resources applies to Pulumi changes.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Passkey sign-in', exact: true })).toBeVisible();
    await expect(page.getByText('Each challenge works once within five minutes, in the browser that asked for it.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Checked changes', exact: true })).toBeVisible();
    await expect(page.getByText('Production changes go through pull requests with passing checks. An approving review is not required. Selected type declarations and browser-test tools may merge automatically after three days. Other dependency and action updates wait for a maintainer to merge them. Infrastructure is applied only by CI.', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/legal/privacy-policy');
});

test('open source page links the repository, licenses and contribution guide', async ({ page }) => {
    const response = await page.goto('/open-source');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Open source · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Open source' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', brand.repository);
    await expect(page.getByRole('link', { name: 'How to contribute' })).toHaveAttribute('href', `${brand.repository}/blob/main/CONTRIBUTING.md`);

    // Each package shows the license its package.json declares
    const licenses = page.getByRole('region', { name: 'Licenses' });
    for (const path of ['apps/web', 'packages/toolbar', 'packages/brand', 'infra']) {
        const license = declaredLicense(path);
        const row = licenses.getByRole('listitem').filter({ has: page.getByRole('link', { name: path, exact: true }) });
        await expect(row.getByRole('link', { name: path, exact: true })).toHaveAttribute('href', `${brand.repository}/tree/main/${path}`);
        await expect(row.getByRole('link', { name: license, exact: true })).toBeVisible();
    }
});

test('security page is accessible', ({ page }) => assertAccessibility(page, '/security'));
test('open source page is accessible', ({ page }) => assertAccessibility(page, '/open-source'));
