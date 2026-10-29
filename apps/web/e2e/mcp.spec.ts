import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { signIn, uniqueEmail, createProject, appNavigation, closeAppNavigation } from './support/app';
import { PUBLIC_PROJECT_ID } from '../src/lib/comments/publicProject';
import { expectNoAxeViolations } from './accessibility';

test('a person grants selected feedback access, connects a compatible client, and revokes it', async ({ page, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('mcp'));
    const projectId = await createProject(page, { name: 'Client review', urls: ['https://reviewed.example'] });
    await page.goto('/app/account');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await expect(section.getByRole('region', { name: 'Connected apps' })).toContainText('No connected apps yet.');
    // Access tokens (for environments without a browser) are collapsed by default.
    await expect(section.getByLabel('Token label')).toHaveCount(0);
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await expect(section).toContainText('For feedback about uier itself, switch to the uier workspace');
    await section.getByLabel('Token label').fill('My coding tool');
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('Choose at least one project.');
    await expect(section.getByLabel('Token label')).toHaveValue('My coding tool');
    await section.getByRole('checkbox', { name: 'Client review', exact: true }).check();
    await expect(section.getByRole('checkbox', { name: 'Read feedback', exact: true })).toBeChecked();
    await expect(section.getByRole('checkbox', { name: 'Reply to feedback', exact: true })).not.toBeChecked();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    const token = (await code.textContent())!;
    // Check every setup while the newly created secret is still visible elsewhere.
    await section.getByText('Prompts and agent skill', { exact: true }).click();
    const skill = section.locator('details').filter({ has: page.getByText('Prompts and agent skill', { exact: true }) });
    await skill.getByText('View and copy SKILL.md', { exact: true }).click();
    const skillText = await skill.locator('pre code').innerText();
    expect(skillText).toMatch(/^---\nname: uier-feedback\ndescription: /);
    expect(skillText).not.toContain('uier_mcp.');
    expect(skillText).not.toContain(token);
    const downloadPromise = page.waitForEvent('download');
    await skill.getByRole('link', { name: 'Download SKILL.md' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('SKILL.md');
    expect(await readFile((await download.path())!, 'utf8')).toBe(skillText);
    await skill.getByText('View and copy SKILL.md', { exact: true }).click();
    const endpoint = new URL('/api/mcp', baseURL).toString();
    for (const clientName of ['Claude Code', 'Codex', 'Cursor']) {
        await section.getByRole('tab', { name: clientName, exact: true }).click();
        const panel = section.getByRole('tabpanel');
        await expect(panel).toContainText(endpoint);
        // Claude Code signs in with OAuth: no token, no header, and a note to remove an old header.
        if (clientName === 'Claude Code') {
            await expect(panel).toContainText(`claude mcp add --transport http uier ${endpoint}`);
            await expect(panel).toContainText('Remove that header first.');
            await expect(panel).not.toContainText('UIER_MCP_TOKEN');
        } else await expect(panel).toContainText('UIER_MCP_TOKEN');
        await expect(panel).not.toContainText('uier_mcp.');
        await expect(panel).not.toContainText(token);
        await expect(panel.getByRole('link', { name: `${clientName} documentation` })).toHaveAttribute('href', /^https:/);
    }
    await expect(section).not.toContainText('OAuth login is not supported');
    await section.getByRole('button', { name: 'Hide token' }).click();
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
            for (const clientName of ['Codex', 'Claude Code', 'Cursor']) {
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

test('feedback on a customer project page exports its uier owner and needs a grant from the uier workspace', async ({ page, baseURL, playwright }) => {
    await signIn(page, uniqueEmail('mcp-uier'));
    const projectId = await createProject(page, { name: 'Customer project', urls: ['https://customer.example'] });
    const response = await page.request.post('/api/comments', { data: {
        path: `/app/projects/${projectId}`, kind: 'feedback', position: { type: 'page' }, text: 'Move this action into the header'
    } });
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    const packet = await (await page.request.get(`/api/comments/${saved.id}/context`)).json();
    expect(packet.context.identity.projectId).toBe(PUBLIC_PROJECT_ID);
    expect(packet.markdown).toContain(`Project: \` ${PUBLIC_PROJECT_ID} \``);
    expect(packet.context.source.path).toBe(`/app/projects/${projectId}`);
    const stranger = await playwright.request.newContext({ baseURL });
    try { expect((await stranger.get(`/api/comments/${saved.id}/context`)).status()).toBe(404); }
    finally { await stranger.dispose(); }

    const connect = async (name: string, project: string, status = false) => {
        await page.goto('/app/account');
        const section = page.getByRole('region', { name: 'Coding agents' });
        await section.getByRole('button', { name: 'Show access tokens' }).click();
        await section.getByLabel('Token label').fill(name);
        await section.getByRole('checkbox', { name: project, exact: true }).check();
        if (status) await section.getByRole('checkbox', { name: 'Change status', exact: true }).check();
        await section.getByRole('button', { name: 'Create token', exact: true }).click();
        const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
        await expect(code).toBeVisible();
        const token = (await code.textContent())!;
        const client = new Client({ name: 'feedback-owner-test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        return client;
    };
    const customer = await connect('Customer access', 'Customer project');
    try {
        const missing = await customer.callTool({ name: 'get_feedback', arguments: { projectId: packet.context.identity.projectId, commentId: saved.id } });
        expect(missing.isError).toBe(true);
        expect(missing.structuredContent).toMatchObject({ error: 'not_found' });
        expect(JSON.stringify(missing)).not.toContain('Move this action into the header');
        const wrong = await customer.callTool({ name: 'get_feedback', arguments: { projectId, commentId: saved.id } });
        expect(wrong.isError).toBe(true);
    } finally { await customer.close(); }

    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: /uier.*Commenter/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback', exact: true }))
        .toHaveAttribute('href', `/app/projects/${PUBLIC_PROJECT_ID}`);
    await closeAppNavigation(page);
    const uier = await connect('uier access', 'uier.io public feedback', true);
    try {
        const args = { projectId: packet.context.identity.projectId, commentId: saved.id };
        const read = await uier.callTool({ name: 'get_feedback', arguments: args });
        expect(read.isError).not.toBe(true);
        expect(read.structuredContent).toMatchObject({ context: { identity: { projectId: PUBLIC_PROJECT_ID, commentId: saved.id }, feedback: { text: 'Move this action into the header' } } });
        const resolved = await uier.callTool({ name: 'set_feedback_status', arguments: { ...args, resolved: true, idempotencyKey: crypto.randomUUID() } });
        expect(resolved.isError).not.toBe(true);
        expect((await (await page.request.get(`/api/comments/${saved.id}/context`)).json()).context.status).toBe('done');
    } finally { await uier.close(); }
});
