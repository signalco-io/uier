import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { integrationCatalog, isIntegrationCatalogKey } from '../src/lib/integrations/catalog';
import { assertAccessibility } from './accessibility';
import { toolbar } from './support/toolbar';
import { integrationPublication, replySyncQualification } from '../src/lib/integrations/publication';

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
        const qualification = page.getByRole('region', { name: 'Availability and verification' });
        const evidence = integrationPublication[provider as keyof typeof integrationPublication];
        await expect(qualification.locator('time')).toHaveAttribute('datetime', evidence.recordedOn);
        await expect(qualification).toContainText(replySyncQualification);
        await expect(qualification.getByRole('link', { name: 'Read the verification record' })).toHaveAttribute('href', `${brand.repository}/blob/main/docs/integration-activation.md`);
        if (provider === 'azure-devops')
            await expect(qualification).toContainText('real work-item delivery are still pending verification');
        if (provider === 'slack')
            await expect(qualification).toContainText('has not been submitted to Slack Marketplace');
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

test('the integrations cover moves nothing around it and follows reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/integrations');
    await page.locator('[data-integrations-cover]').scrollIntoViewIfNeeded();
    const heading = page.getByRole('heading', { name: 'Choose a service' });
    const top = () => heading.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
    const caption = page.locator('[data-integrations-caption] p:not(.invisible)');
    const start = await top();
    // The caption changes with the phases; the section under the cover stays where it is
    for (const text of ['With reply sync', 'Mark it done', 'Shared feedback becomes']) {
        await expect(caption).toContainText(text, { timeout: 15_000 });
        expect(await top()).toBe(start);
    }
    // Reduced motion turned on after load stops the loop on the still frame, and off again plays it
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(caption).toHaveText('Shared feedback becomes a page, an issue, a work item or a message, and replies can come back.');
    await expect(page.getByRole('button', { name: /^(Pause|Play) the animation$/ })).toHaveCount(0);
    // Without Pause the caption is wider, so the row settles once; then the frame stays still
    const still = await top();
    await expect(caption).toHaveText(/replies can come back\.$/);
    await page.waitForTimeout(3_000);
    await expect(caption).toHaveText(/replies can come back\.$/);
    expect(await top()).toBe(still);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByRole('button', { name: 'Pause the animation' })).toBeVisible();
    await expect(caption).toContainText('Mark it done', { timeout: 15_000 });
});

test('the integrations index collects suggestions through the toolbar', async ({ page }) => {
    await page.goto('/integrations');
    await expect(toolbar(page)).toBeVisible();
    const suggest = page.getByRole('region', { name: 'Suggest an integration' });
    await suggest.getByRole('button', { name: 'Suggest an integration' }).click();
    await expect(page.getByRole('dialog', { name: 'Send feedback' }).getByRole('textbox', { name: 'Feedback' })).toBeFocused();
});

test('unknown integration guides return a missing page', async ({ page }) => {
    expect((await page.goto('/integrations/unknown'))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not');
});

test('guide preflight uses the decoded provider pathname', async ({ page }) => {
    expect((await page.goto('/integrations/%67ithub'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: integrationCatalog.github.title })).toBeVisible();
    expect((await page.goto('/integrations/%75nknown'))?.status()).toBe(404);
});
