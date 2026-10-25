import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { signIn, uniqueEmail, createProject } from './support/app';
import { expectNoAxeViolations } from './accessibility';

test('a person grants selected feedback access, connects a compatible client, and revokes it', async ({ page, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('mcp'));
    const projectId = await createProject(page, { name: 'Client review', urls: ['https://reviewed.example'] });
    await page.goto('/app/account');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByLabel('Credential label').fill('My coding tool');
    await section.getByRole('button', { name: 'Create credential', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('Choose at least one project.');
    await expect(section.getByLabel('Credential label')).toHaveValue('My coding tool');
    await section.getByRole('checkbox', { name: 'Client review', exact: true }).check();
    await expect(section.getByRole('checkbox', { name: 'Read feedback', exact: true })).toBeChecked();
    await expect(section.getByRole('checkbox', { name: 'Reply to feedback', exact: true })).not.toBeChecked();
    await section.getByRole('button', { name: 'Create credential', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    const token = (await code.textContent())!;
    await section.getByRole('button', { name: 'Hide credential' }).click();
    await expect(code).toHaveCount(0);
    const client = new Client({ name: 'explicit-user-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
        const projects = (await client.callTool({ name: 'list_projects', arguments: {} })).structuredContent;
        expect(projects).toMatchObject({ items: [{ id: projectId, name: 'Client review' }] });
        for (const theme of ['Light', 'Dark']) {
            await page.getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio', { name: theme, exact: true }).click();
            await expect(page.locator('html')).toHaveClass(new RegExp(theme.toLowerCase()));
            await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
            await expectNoAxeViolations(page);
            await section.screenshot({ path: testInfo.outputPath(`mcp-${theme.toLowerCase()}.png`) });
            await section.getByRole('button', { name: 'Revoke My coding tool' }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath(`mcp-${theme.toLowerCase()}-credential.png`) });
        }
        await section.getByRole('button', { name: 'Revoke My coding tool' }).click();
        await expect(section.getByRole('button', { name: 'Revoke My coding tool' })).toHaveCount(0);
        await expect(client.listTools()).rejects.toThrow();
        await page.reload();
        await expect(code).toHaveCount(0);
    } finally { await client.close(); }
});
