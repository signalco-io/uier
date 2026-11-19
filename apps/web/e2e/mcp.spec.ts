import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { signIn, uniqueEmail, createProject, appNavigation, openFeedbackWorkspace, closeAppNavigation } from './support/app';
import { USER_FEEDBACK_PROJECT_ID } from '../src/lib/comments/publicProject';
import { expectNoAxeViolations } from './accessibility';

test('a person grants selected feedback access, connects a compatible client, and revokes it', async ({ page, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('mcp'));
    const projectId = await createProject(page, { name: 'Client review', urls: ['https://reviewed.example'] });
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    const apps = section.getByRole('region', { name: 'Connected apps' });
    await expect(apps).toContainText('No connected apps yet');
    // The empty state leads to the setup below it
    await apps.getByRole('link', { name: 'Connect a coding tool' }).click();
    await expect(page).toHaveURL(/#connect$/);
    await expect(section.getByRole('region', { name: 'Connect a coding tool' })).toBeInViewport();
    const plugins = section.getByRole('region', { name: 'Install the uier plugin' });
    await expect(plugins).toContainText('/plugin marketplace add signalco-io/uier');
    await expect(plugins).toContainText('/plugin install uier@uier');
    await expect(plugins).toContainText('/uier:uier-monitor');
    await plugins.getByRole('tab', { name: 'Codex plugin', exact: true }).click();
    const codexPlugin = plugins.getByRole('tabpanel', { name: 'Codex plugin', exact: true });
    await expect(codexPlugin).toContainText('codex plugin marketplace add signalco-io/uier');
    await expect(codexPlugin).toContainText('codex plugin add uier@uier');
    await expect(codexPlugin.getByRole('link', { name: 'Codex plugin documentation' })).toHaveAttribute('href', /^https:/);
    await expect(plugins).toContainText('Installing it starts no monitor.');
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
    await expect(plugins).not.toContainText(token);
    // Check every setup while the newly created secret is still visible elsewhere.
    const skill = section.getByRole('region', { name: 'Prompts and agent skill' });
    await expect(skill.getByRole('list', { name: 'Prompts' })).toContainText('report-back');
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
        const panel = section.getByRole('tabpanel', { name: clientName, exact: true });
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
    const tokenRow = section.getByRole('list', { name: 'Your access tokens' }).getByRole('listitem').filter({ hasText: 'My coding tool' });
    await expect(tokenRow).toContainText('Projects: Client review');
    await expect(tokenRow).toContainText('Read feedback');
    const client = new Client({ name: 'explicit-user-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
        const projects = (await client.callTool({ name: 'list_projects', arguments: {} })).structuredContent;
        expect(projects).toMatchObject({ items: [{ id: projectId, name: 'Client review' }] });
        // The running app serves the plugin's skills from its deployment files.
        const skills = (await client.listResources()).resources.map(resource => resource.uri);
        expect(skills).toEqual(expect.arrayContaining(['skill://uier-monitor/SKILL.md', 'skill://uier-monitor-script/SKILL.md']));
        expect((await client.readResource({ uri: 'skill://uier-monitor/scripts/monitor.mjs' })).contents).toHaveLength(1);
        for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme });
            await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
            await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
            for (const clientName of ['Codex', 'Claude Code', 'Cursor']) {
                await section.getByRole('tab', { name: clientName, exact: true }).click();
                await expectNoAxeViolations(page);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await section.screenshot({ path: testInfo.outputPath(`mcp-${theme}.png`) });
            await section.getByRole('button', { name: 'Revoke My coding tool' }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath(`mcp-${theme}-credential.png`) });
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
    expect(packet.context.identity.projectId).toBe(USER_FEEDBACK_PROJECT_ID);
    expect(packet.markdown).toContain(`Project: \` ${USER_FEEDBACK_PROJECT_ID} \``);
    expect(packet.context.source.path).toBe(`/app/projects/${projectId}`);
    const stranger = await playwright.request.newContext({ baseURL });
    try { expect((await stranger.get(`/api/comments/${saved.id}/context`)).status()).toBe(404); }
    finally { await stranger.dispose(); }

    const connect = async (name: string, project: string, status = false) => {
        await page.goto('/app/account/coding-agents');
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

    await openFeedbackWorkspace(page);
    await appNavigation(page);
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io user feedback', exact: true }))
        .toHaveAttribute('href', `/app/projects/${USER_FEEDBACK_PROJECT_ID}`);
    await closeAppNavigation(page);
    const uier = await connect('uier access', 'uier.io user feedback', true);
    try {
        const args = { projectId: packet.context.identity.projectId, commentId: saved.id };
        const read = await uier.callTool({ name: 'get_feedback', arguments: args });
        expect(read.isError).not.toBe(true);
        expect(read.structuredContent).toMatchObject({ context: { identity: { projectId: USER_FEEDBACK_PROJECT_ID, commentId: saved.id }, feedback: { text: 'Move this action into the header' } } });
        const resolved = await uier.callTool({ name: 'set_feedback_status', arguments: { ...args, resolved: true, idempotencyKey: crypto.randomUUID() } });
        expect(resolved.isError).not.toBe(true);
        expect((await (await page.request.get(`/api/comments/${saved.id}/context`)).json()).context.status).toBe('done');
    } finally { await uier.close(); }
});

test('the Server Card and the AI Catalog are public and point to the endpoint', async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const catalog = await request.get('/.well-known/ai-catalog.json');
    expect(catalog.status()).toBe(200);
    expect(catalog.headers()['content-type']).toBe('application/ai-catalog+json');
    const [entry] = (await catalog.json() as { entries: { type: string; url: string }[] }).entries;
    expect(entry).toMatchObject({ type: 'application/mcp-server-card+json', url: `${origin}/api/mcp/server-card` });

    const card = await request.get(entry!.url, { headers: { Accept: 'application/mcp-server-card+json' } });
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('application/mcp-server-card+json');
    expect(card.headers()['access-control-allow-origin']).toBe('*');
    expect(await card.json()).toMatchObject({ name: 'io.uier/uier', remotes: [{ type: 'streamable-http', url: `${origin}/api/mcp`,
        supportedProtocolVersions: expect.arrayContaining(['2026-07-28']) }] });
    expect((await request.get(entry!.url, { headers: { 'If-None-Match': card.headers().etag! } })).status()).toBe(304);
    // The endpoint itself still asks for sign-in.
    expect((await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status()).toBe(401);
});

test('a file-only token reads a published proof through the built MCP endpoint and its browser permalink', async ({ page, baseURL, playwright }) => {
    const { pngImage } = await import('./support/images');
    const { randomUUID } = await import('node:crypto');
    await signIn(page, uniqueEmail('mcp-proof'));
    const projectId = await createProject(page, { name: 'Proof handoff project', urls: ['https://reviewed.example'] });
    const request = page.request;
    const headers = { origin: new URL(baseURL!).origin };
    const root = `/api/proofs/${projectId}/assets`;
    const created = await request.post(root, { headers, data: { name: 'Cover' } });
    expect(created.status(), await created.text()).toBe(201);
    const { asset } = await created.json();
    const assetUrl = `${root}/${asset.id}`;
    const image = Buffer.from(pngImage.split(',')[1]!, 'base64');
    const grantResponse = await request.post(`${assetUrl}/uploads`, { headers, data: {
        filename: 'cover.png', contentType: 'image/png', size: image.length, expectedVersionId: null, requestId: randomUUID()
    } });
    expect(grantResponse.ok(), await grantResponse.text()).toBe(true);
    const grant = await grantResponse.json();
    const versionId = grant.version.id;
    const uploader = await playwright.request.newContext({ baseURL });
    try {
        const put = await uploader.put(grant.uploadUrl, { headers: { ...headers, ...grant.headers }, data: image });
        expect(put.status(), await put.text()).toBe(204);
    } finally { await uploader.dispose(); }
    expect((await request.post(`${assetUrl}/uploads/${versionId}/finalize`, { headers })).ok()).toBe(true);
    const threadResponse = await request.post(`${assetUrl}/threads`, { headers, data: {
        text: 'Adjust the title', location: { versionId, anchor: { kind: 'general' } }, idempotencyKey: randomUUID()
    } });
    expect(threadResponse.status(), await threadResponse.text()).toBe(201);
    const { thread } = await threadResponse.json();
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await section.getByLabel('Token label').fill('Proof reviewer');
    await section.getByRole('checkbox', { name: 'Proof handoff project', exact: true }).check();
    await section.getByRole('checkbox', { name: 'Read file feedback', exact: true }).check();
    await section.getByRole('checkbox', { name: 'Read feedback', exact: true }).uncheck();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const token = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(token).toBeVisible();
    const client = new Client({ name: 'built proof handoff', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL),
        { requestInit: { headers: { Authorization: `Bearer ${await token.textContent()}` } } }));
    try {
        const args = { projectId, assetId: asset.id, commentId: thread.id };
        const list = await client.callTool({ name: 'list_proof_threads', arguments: { projectId, assetId: asset.id } });
        expect(list.structuredContent).toMatchObject({ items: [{ id: thread.id, summary: 'Adjust the title' }] });
        const result = await client.callTool({ name: 'get_feedback', arguments: args });
        const original = new URL(thread.href, baseURL).href;
        expect(result.structuredContent).toMatchObject({ context: { identity: args, links: { comment: original },
            screenshot: { state: 'unavailable' }, feedback: { text: 'Adjust the title' } } });
        const exported = await request.get(`${assetUrl}/threads/${thread.id}/export?version=${versionId}`);
        expect(await exported.json()).toMatchObject({ context: { identity: args, links: { comment: original } } });
        expect((await request.get(original)).status()).toBe(200);
        const site = await client.callTool({ name: 'list_feedback', arguments: { projectId } });
        expect(site.structuredContent).toMatchObject({ error: 'forbidden' });
        expect((await request.delete(assetUrl, { headers })).status()).toBe(204);
        const removed = await client.callTool({ name: 'get_feedback', arguments: args });
        expect(removed.structuredContent).toMatchObject({ error: 'not_found' });
    } finally { await client.close(); }
});
