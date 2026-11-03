import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { integrationCatalog, isIntegrationCatalogKey } from '../src/lib/integrations/catalog';
import { assertAccessibility } from './accessibility';
import { toolbar } from './support/toolbar';

test('the integrations index leads to the five setup guides', async ({ page }) => {
    await page.goto('/integrations');
    await expect(page).toHaveTitle(`Integrations · ${brand.name}`);
    for (const provider of ['Notion', 'GitHub', 'Linear', 'Azure DevOps', 'Slack']) {
        await expect(page.getByRole('main').getByRole('link', { name: `Set up ${provider}` }))
            .toHaveAttribute('href', `/integrations/${provider.toLowerCase().replace(' ', '-')}`);
    }
    const services = page.getByRole('region', { name: 'Choose a service' });
    await expect(services.locator('[data-integration-logo]')).toHaveCount(5);
    await expect(services.getByRole('list', { name: 'Optional for GitHub' }).getByRole('listitem')).toHaveText(['Two-way status sync', 'Reply sync']);
    await expect(services.getByRole('list', { name: 'Optional for Slack' }).getByRole('listitem')).toHaveText(['Reply and status summaries', 'Reply sync']);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Integrations', exact: true })).toHaveAttribute('href', '/integrations');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await assertAccessibility(page, '/integrations');
});

for (const provider of ['notion', 'github', 'linear', 'azure-devops', 'slack']) {
    test(`${provider} has a public setup, permissions and support guide`, async ({ page }, testInfo) => {
        const response = await page.goto(`/integrations/${provider}`);
        expect(response?.status()).toBe(200);
        const setup = page.getByRole('region', { name: 'Get connected' });
        await expect(setup.getByRole('listitem')).toHaveCount(4);
        if (!isIntegrationCatalogKey(provider)) throw new Error(provider);
        const integration = integrationCatalog[provider];
        await expect(page.getByRole('main').locator(`header [data-integration-logo="${provider}"]`)).toBeVisible();
        await expect(page.getByRole('region', { name: 'What it does' }).getByRole('heading', { level: 3 })).toHaveText(integration.features.map(feature => feature.title));
        await expect(page.getByRole('region', { name: 'What it does' }).getByText('Optional', { exact: true })).toHaveCount(integration.features.filter(feature => feature.optional).length);
        await expect(page.getByRole('region', { name: 'What you can configure' }).locator('dt')).toHaveText(integration.settings.map(setting => setting.name + (setting.required ? 'Required' : '')));
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

test('the integrations index collects suggestions through the toolbar', async ({ page }) => {
    await page.goto('/integrations');
    await expect(toolbar(page)).toBeVisible();
    const suggest = page.getByRole('region', { name: 'Suggest an integration' });
    await suggest.getByRole('button', { name: 'Suggest an integration' }).click();
    await expect(page.getByRole('dialog', { name: 'Send feedback' }).getByRole('textbox', { name: 'Feedback' })).toBeFocused();
});

test('unknown integration guides return a missing page', async ({ page }) => {
    expect((await page.goto('/integrations/unknown'))?.status()).toBe(404);
});
