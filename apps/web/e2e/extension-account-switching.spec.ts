import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { createProject, signIn, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

test('extension consent keeps the site and handoff when selecting another signed-in account', async ({ page }) => {
    const a = uniqueEmail('extension-consent-a'), b = uniqueEmail('extension-consent-b');
    await signIn(page, a);
    await createProject(page, { name: 'Site to review', urls: ['https://reviewed.example'] });
    await signIn(page, b, { from: '/app/sign-in?add=1' });
    const clientId = 'abcdefghijklmnopabcdefghijklmnop';
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ clientId, redirectUri: `https://${clientId}.chromiumapp.org/uier`,
        state: randomBytes(32).toString('base64url'), challenge: createHash('sha256').update(verifier).digest('base64url'),
        renewable: 'true', siteOrigin: 'https://reviewed.example' });
    await page.goto(`/app/extension?${query}`);
    const accounts = page.getByRole('region', { name: 'Signed-in accounts' });
    await expect(accounts).toContainText('Projects for https://reviewed.example');
    await expect(accounts).toContainText('No project includes this address');
    await expect(accounts).toContainText('Site to review · Personal');
    const choose = accounts.getByRole('button', { name: 'Use this account', exact: true });
    await choose.focus();
    await choose.press('Enter');
    await expect(accounts.locator('div').filter({ has: page.getByText(a, { exact: true }) }).getByText('active', { exact: true })).toBeVisible();
    for (const [key, value] of query) expect(new URL(page.url()).searchParams.get(key)).toBe(value);
    await expect(page.getByRole('button', { name: 'Sign in to uier', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await animationsFinished(page.locator('main'));
        await expectNoAxeViolations(page);
    }
});
