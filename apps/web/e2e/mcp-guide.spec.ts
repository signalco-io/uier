import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { mcpClientConfigurations, mcpPluginCommands } from '../src/lib/mcp/clients';
import { mcpGuide } from '../src/lib/guides/mcp';
import { assertAccessibility } from './accessibility';

test('MCP setup uses the same offered configurations as Account without embedding secrets', async ({ page }) => {
    await page.goto(mcpGuide.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(mcpGuide.title);
    for (const client of mcpClientConfigurations(`${brand.url}/api/mcp`)) {
        const label = client.auth === 'oauth' ? `${client.name} connection command` : `${client.name} MCP configuration`;
        await expect(page.getByRole('region', { name: 'Connect your client', exact: true }).getByLabel(label))
            .toHaveText(client.auth === 'oauth' ? client.command : client.configuration);
    }
    await page.getByText('Install the optional plugin instead', { exact: true }).click();
    await expect(page.getByLabel('Claude Code plugin commands')).toHaveText(mcpPluginCommands.claudeCode);
    await expect(page.getByLabel('Codex plugin commands')).toHaveText(mcpPluginCommands.codex);
    await expect(page.getByRole('region', { name: 'Read one thread', exact: true })).toContainText('Do not reply, assign or change its status.');
    await expect(page.getByRole('main')).toContainText('Installing a plugin starts no monitor');
    await expect(page.getByRole('main')).toContainText('Codex and Cursor use access tokens');
    await expect(page.getByRole('region', { name: 'Display a thread card', exact: true })).toContainText('Refreshing does not approve writes or start monitoring');
    await expect(page.getByRole('region', { name: 'Revoke access', exact: true })).toContainText('cannot erase copies');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('MCP setup is linked from the overview and its internal reference links resolve', async ({ page, request }) => {
    await page.goto('/features/ai');
    await page.getByRole('link', { name: 'Follow the MCP setup guide', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(mcpGuide.title);
    const fragments = await page.getByRole('navigation', { name: 'In this guide' }).getByRole('link')
        .evaluateAll(links => links.map(link => link.getAttribute('href')!));
    for (const fragment of fragments) await expect(page.locator(`main section${fragment}`)).toHaveCount(1);
    const paths = await page.getByRole('main').locator('a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute('href')!));
    for (const path of new Set(paths)) expect((await request.get(path)).status(), path).toBe(200);
});

test('the MCP setup guide is accessible', ({ page }) => assertAccessibility(page, mcpGuide.path));
