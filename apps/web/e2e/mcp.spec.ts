import { readFile } from 'node:fs/promises';
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
    // Check every setup while the newly created secret is still visible elsewhere.
    await section.getByText('Client configuration', { exact: true }).click();
    await section.getByText('Prompts and agent skill', { exact: true }).click();
    const skill = section.locator('details').filter({ has: page.getByText('Prompts and agent skill', { exact: true }) });
    const skillText = await skill.locator('pre code').innerText();
    expect(skillText).toMatch(/^---\nname: uier-feedback\ndescription: /);
    expect(skillText).not.toContain('uier_mcp.');
    expect(skillText).not.toContain(token);
    const downloadPromise = page.waitForEvent('download');
    await skill.getByRole('link', { name: 'Download SKILL.md' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('SKILL.md');
    expect(await readFile((await download.path())!, 'utf8')).toBe(skillText);
    for (const clientName of ['Codex', 'Claude Code', 'Cursor', 'VS Code']) {
        await section.getByRole('tab', { name: clientName, exact: true }).click();
        const panel = section.getByRole('tabpanel');
        await expect(panel).toContainText(new URL('/api/mcp', baseURL).toString());
        await expect(panel).toContainText(clientName === 'VS Code' ? '${input:uier-mcp-token}' : 'UIER_MCP_TOKEN');
        await expect(panel).not.toContainText('uier_mcp.');
        await expect(panel).not.toContainText(token);
        await expect(panel.getByRole('link', { name: `${clientName} documentation` })).toHaveAttribute('href', /^https:/);
    }
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
            for (const clientName of ['Codex', 'Claude Code', 'Cursor', 'VS Code']) {
                await section.getByRole('tab', { name: clientName, exact: true }).click();
                await expectNoAxeViolations(page);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
