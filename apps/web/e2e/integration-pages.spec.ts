import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

test('the integrations index leads to the four setup guides', async ({ page }) => {
    await page.goto('/integrations');
    await expect(page).toHaveTitle(`Integrations · ${brand.name}`);
    for (const provider of ['Notion', 'GitHub', 'Linear', 'Slack']) {
        await expect(page.getByRole('main').getByRole('link', { name: `Set up ${provider}` }))
            .toHaveAttribute('href', `/integrations/${provider.toLowerCase()}`);
    }
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Integrations', exact: true })).toHaveAttribute('href', '/integrations');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await assertAccessibility(page, '/integrations');
});

for (const provider of ['notion', 'github', 'linear', 'slack']) {
    test(`${provider} has a public setup, permissions and support guide`, async ({ page }, testInfo) => {
        const response = await page.goto(`/integrations/${provider}`);
        expect(response?.status()).toBe(200);
        const setup = page.getByRole('region', { name: 'Get connected' });
        await expect(setup.getByRole('listitem')).toHaveCount(4);
        await expect(page.getByRole('main').getByRole('link', { name: /^Set up / })).toHaveAttribute('href', '/app');
        await expect(page.getByRole('region', { name: 'Access and data' }).getByText('Private feedback and the public uier showcase are excluded.')).toBeVisible();
        await expect(page.getByRole('main').getByRole('link', { name: 'privacy policy', exact: true })).toHaveAttribute('href', '/legal/privacy-policy');
        await expect(page.getByRole('main').getByRole('link', { name: 'Get help', exact: true })).toHaveAttribute('href', `mailto:${brand.contact.email}`);
        await expect(page.getByText(brand.pricing, { exact: true })).toBeVisible();
        const illustration = page.getByRole('img', { name: /^Illustration of feedback/ });
        await expect(illustration).toBeVisible();
        await expect(illustration).toHaveJSProperty('naturalWidth', 1600);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await assertAccessibility(page, `/integrations/${provider}`);
        if (provider === 'linear') await page.screenshot({ path: testInfo.outputPath('integration-guide.png'), fullPage: true });
    });
}

test('unknown integration guides return a missing page', async ({ page }) => {
    expect((await page.goto('/integrations/unknown'))?.status()).toBe(404);
});
