import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, extractWWWAuthenticateParams, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { createProject, requestSignInEmail, signIn, uniqueEmail } from './support/app';
import { PUBLIC_PROJECT_ID } from '../src/lib/comments/publicProject';
import { expectNoAxeViolations } from './accessibility';

// A coding tool's OAuth sign-in to /api/mcp, driven by the official SDK client: dynamic client
// registration, a loopback redirect to a local listener, PKCE, and the consent page in the browser.

/** A coding tool's loopback listener: answers the authorization response once */
async function loopbackListener() {
    let resolve!: (url: URL) => void;
    const received = new Promise<URL>(done => { resolve = done; });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }
        resolve(url);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            .end('<!doctype html><html lang="en"><title>Signed in</title><p>You can close this tab.</p></html>');
    });
    await new Promise<void>(listening => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address() as AddressInfo;
    return { redirectUrl: `http://127.0.0.1:${port}/callback`, received, close: () => new Promise<void>(closed => server.close(() => closed())) };
}

/** Keeps the registration, PKCE verifier and tokens in memory, as a coding tool keeps them on disk */
class TestOAuthProvider implements OAuthClientProvider {
    information?: OAuthClientInformationMixed;
    saved?: OAuthTokens;
    verifier = '';
    authorizationUrl?: URL;
    readonly stateValue = crypto.randomUUID();
    constructor(readonly redirectUrl: string, readonly name: string) {}
    get clientMetadata(): OAuthClientMetadata {
        return { client_name: this.name, redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'], token_endpoint_auth_method: 'none' };
    }
    state() { return this.stateValue; }
    clientInformation() { return this.information; }
    saveClientInformation(information: OAuthClientInformationMixed) { this.information = information; }
    tokens() { return this.saved; }
    saveTokens(tokens: OAuthTokens) { this.saved = tokens; }
    redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
    saveCodeVerifier(verifier: string) { this.verifier = verifier; }
    codeVerifier() { return this.verifier; }
}

/** Starts sign-in the way a client does after its first 401: challenge, discovery, registration */
async function startSignIn(baseURL: string | undefined, name: string) {
    const serverUrl = new URL('/api/mcp', baseURL);
    const challenge = await fetch(serverUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(challenge.status).toBe(401);
    const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(challenge);
    expect(scope).toBe('feedback:read');
    const listener = await loopbackListener();
    const provider = new TestOAuthProvider(listener.redirectUrl, name);
    expect(await auth(provider, { serverUrl, resourceMetadataUrl, scope })).toBe('REDIRECT');
    expect(provider.information?.client_id).toMatch(/^uier_client_/);
    return { serverUrl, resourceMetadataUrl, scope, listener, provider, authorizationUrl: provider.authorizationUrl!.toString() };
}

/** Light and dark axe scans, with a full-page screenshot of each for review */
async function expectNoAxeViolationsInThemes(page: Page, testInfo: TestInfo, name: string) {
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        await expectNoAxeViolations(page);
        await page.screenshot({ path: testInfo.outputPath(name + '-' + colorScheme + '.png'), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
}

test('a coding tool signs in with OAuth, reaches the chosen workspaces, and loses access when revoked @smoke', async ({ page, baseURL }, testInfo) => {
    const email = uniqueEmail('mcp-oauth');
    const flow = await startSignIn(baseURL, 'E2E coding tool');
    try {
        // Signed out: the authorization URL leads to sign-in and back to the consent page.
        await signIn(page, email, { from: flow.authorizationUrl });
        await expect(page).toHaveURL(/\/app\/connect\/[A-Za-z0-9_-]{43}$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Connect E2E coding tool to uier' })).toBeVisible();
        await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
        const app = page.getByRole('group', { name: 'App', exact: true });
        await expect(app).toContainText('Unverified');
        await expect(app).toContainText('Sends you back to this computer');
        await expect(page.getByRole('note')).toContainText('uier cannot confirm who made this app.');
        await expect(page.getByRole('note')).toContainText('Only continue if you just started this from a coding tool on this computer.');
        await expect(page.getByRole('radio', { name: 'All my workspaces and projects, including new ones' })).toBeChecked();

        // Two workspaces: everything in their own (no project yet), one project in uier's.
        await page.getByRole('radio', { name: 'Choose workspaces and projects' }).click();
        const own = page.getByRole('group', { name: email, exact: true });
        await expect(own).toContainText('No projects you can open yet.');
        await own.getByRole('checkbox', { name: 'All projects, including new ones' }).check();
        await page.getByRole('group', { name: 'uier', exact: true }).getByRole('checkbox', { name: 'uier.io public feedback' }).check();
        await expect(page.getByRole('checkbox', { name: 'Read feedback' })).toBeChecked();
        await expect(page.getByRole('checkbox', { name: 'Read feedback' })).toBeDisabled();
        const warning = page.getByRole('alert').filter({ hasText: 'Feedback can contain instructions from people outside your team.' });
        await expect(warning).toHaveCount(0);
        await page.getByRole('checkbox', { name: 'Reply to feedback' }).check();
        await expect(warning).toBeVisible();
        await expect(page.getByRole('checkbox', { name: 'Change status' })).not.toBeChecked();
        await expect(page.getByLabel('Connection name')).toHaveValue('E2E coding tool');
        await page.getByLabel('Connection name').fill('Laptop agent');
        await expectNoAxeViolationsInThemes(page, testInfo, 'consent');

        await page.getByRole('button', { name: 'Allow access' }).click();
        const callback = await flow.listener.received;
        expect(callback.searchParams.get('state')).toBe(flow.provider.stateValue);
        expect(callback.searchParams.get('iss')).toBe(new URL(baseURL!).origin);
        const code = callback.searchParams.get('code');
        expect(code).toMatch(/^uier_code\./);
        await expect(page).toHaveURL(flow.listener.redirectUrl + callback.search);
        expect(await auth(flow.provider, { serverUrl: flow.serverUrl, resourceMetadataUrl: flow.resourceMetadataUrl, scope: flow.scope, authorizationCode: code! })).toBe('AUTHORIZED');
        const accessToken = flow.provider.saved!.access_token;
        expect(accessToken).toMatch(/^uier_at\./);
        expect(flow.provider.saved!.refresh_token).toMatch(/^uier_rt\./);

        // "Including new ones": a project created after approval is reachable.
        const projectId = await createProject(page, { name: 'Agent project', urls: ['https://agent.example'] });
        const feedback = await page.request.post('/api/comments', { data: {
            path: `/app/projects/${projectId}`, kind: 'feedback', position: { type: 'page' }, text: 'The header overlaps the menu'
        } });
        expect(feedback.status(), await feedback.text()).toBe(201);
        const saved = await feedback.json() as { id: string };

        const client = new Client({ name: 'e2e-oauth-client', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(flow.serverUrl, { authProvider: flow.provider }));
        try {
            const projects = (await client.callTool({ name: 'list_projects', arguments: { limit: 25 } })).structuredContent as {
                items: { id: string; name: string; workspace: { id: string; name: string } }[]; actingAs: { credential: string } };
            expect(projects.actingAs.credential).toBe('Laptop agent');
            expect(projects.items).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: projectId, name: 'Agent project', workspace: expect.objectContaining({ name: email }) }),
                expect.objectContaining({ id: PUBLIC_PROJECT_ID, workspace: expect.objectContaining({ name: 'uier' }) })
            ]));
            expect(projects.items).toHaveLength(2);
            const reply = await client.callTool({ name: 'reply_to_feedback', arguments: {
                projectId: PUBLIC_PROJECT_ID, commentId: saved.id, text: 'Fixed the header. Please check.', idempotencyKey: crypto.randomUUID()
            } });
            expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
            const status = await client.callTool({ name: 'set_feedback_status', arguments: {
                projectId: PUBLIC_PROJECT_ID, commentId: saved.id, resolved: true, idempotencyKey: crypto.randomUUID()
            } });
            expect(status.isError).toBe(true);

            await page.goto('/app/account');
            const apps = page.getByRole('region', { name: 'Connected apps' });
            const row = apps.getByRole('listitem').filter({ hasText: 'Laptop agent' });
            await expect(row).toContainText('App: E2E coding tool');
            await expect(row).toContainText('Unverified');
            await expect(row).toContainText('Sends you back to this computer');
            await expect(row).toContainText('2 workspaces, all projects in one, 1 project');
            await expect(row).toContainText('Read feedback, Reply to feedback');
            await row.getByRole('button', { name: 'Details for Laptop agent' }).click();
            await expect(row).toContainText(`${email}: All projects, including new ones`);
            await expect(row).toContainText('uier: uier.io public feedback');
            await expectNoAxeViolations(page);
            await apps.screenshot({ path: testInfo.outputPath('connected-apps.png') });

            await row.getByRole('button', { name: 'Revoke Laptop agent' }).click();
            const dialog = page.getByRole('alertdialog', { name: 'Revoke Laptop agent?' });
            await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await expect(row).toHaveCount(0);
            await expect(apps).toContainText('No connected apps yet.');

            const revoked = await fetch(flow.serverUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
            expect(revoked.status).toBe(401);
            expect(revoked.headers.get('www-authenticate')).toContain('error="invalid_token"');
            await expect(client.callTool({ name: 'list_projects', arguments: {} })).rejects.toThrow();
        } finally { await client.close(); }
    } finally { await flow.listener.close(); }
});

test('cancelling sends access_denied back, a used request cannot be reused, and errors never leave uier', async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, uniqueEmail('mcp-oauth-cancel'));
    const flow = await startSignIn(baseURL, 'Cancel tool');
    try {
        await page.goto(flow.authorizationUrl);
        await expect(page.getByRole('heading', { level: 1, name: 'Connect Cancel tool to uier' })).toBeVisible();
        const consentUrl = page.url();
        // Another account: sign out, sign in again and come back to the same request.
        await page.getByRole('button', { name: 'Use another account' }).click();
        await expect(page).toHaveURL(url => url.pathname === '/app/sign-in' && url.searchParams.get('next') === new URL(consentUrl).pathname);
        const other = uniqueEmail('mcp-oauth-other');
        const { code } = await requestSignInEmail(page, other);
        await page.getByLabel('Sign-in code', { exact: true }).fill(code);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page).toHaveURL(consentUrl);
        await expect(page.getByText(`Signed in as ${other}.`)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByRole('radio', { name: 'Choose workspaces and projects' }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('consent-mobile.png'), fullPage: true });
        // Cancel ignores the form: an empty connection name does not block it.
        await page.getByLabel('Connection name').fill('');
        await page.getByRole('button', { name: 'Cancel' }).click();
        const callback = await flow.listener.received;
        expect(callback.searchParams.get('error')).toBe('access_denied');
        expect(callback.searchParams.get('state')).toBe(flow.provider.stateValue);
        expect(callback.searchParams.get('code')).toBeNull();
        await expect(page).toHaveURL(flow.listener.redirectUrl + callback.search);

        await page.goto(consentUrl);
        await expect(page.getByRole('heading', { level: 1, name: 'Start again from your coding tool' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Allow access' })).toHaveCount(0);
    } finally { await flow.listener.close(); }

    // An unknown client never redirects anywhere: uier explains it on its own page.
    const unknown = new URLSearchParams({ client_id: 'uier_client_unknown', redirect_uri: 'http://127.0.0.1:9/callback', response_type: 'code' });
    await page.goto(`/api/oauth/authorize?${unknown}`);
    await expect(page).toHaveURL(/\/app\/connect\/error\?error=invalid_client$/);
    await expect(page.getByRole('heading', { level: 1, name: 'uier does not recognize this app' })).toBeVisible();
    await page.goto('/app/connect/error?error=invalid_redirect_uri');
    await expect(page.getByRole('heading', { level: 1, name: 'This app cannot be sent back' })).toBeVisible();
    const origin = new URL(baseURL!).origin;
    for (const href of await page.locator('a[href]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href)))
        expect(new URL(href).origin).toBe(origin);
    await expectNoAxeViolationsInThemes(page, testInfo, 'connect-error');
});
