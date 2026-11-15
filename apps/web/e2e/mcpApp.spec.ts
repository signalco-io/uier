import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';

const fixture = (stage = 'open') => ({
    content: [], structuredContent: { context: {
        schemaVersion: 1, contentTrust: 'untrusted', identity: { projectId: 'project-test', commentId: 'comment-test', number: 12 },
        title: 'Make the navigation easier to read', status: stage === 'done' ? 'done' : 'open', stage,
        source: { path: '/pricing', environment: 'Production' }, links: { comment: 'https://uier.io/app/review/project-test?comment=comment-test' },
        assignees: [{ name: 'Ana' }], feedback: { id: 'first', deleted: false, text: 'The navigation needs more contrast.' },
        discussion: [{ id: 'reply', deleted: false, text: 'I can reproduce this on mobile.', authorName: 'Luka' }],
    } },
});

async function mount(page: Page, theme: 'light' | 'dark' = 'light') {
    const html = await readFile(new URL('../dist/mcp/thread.html', import.meta.url), 'utf8');
    // This is a host implementation, not a direct component mount: the built resource runs
    // in an iframe and receives the same handshake, tool results and calls as a real MCP host.
    await page.route('https://mcp-host.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html lang="en"><title>MCP test host</title><body><main><iframe title="uier thread" style="width:100%;height:650px;border:0"></iframe></main></body></html>' }));
    await page.goto('https://mcp-host.test/');
    await page.evaluate(({ html, result, theme }) => {
        const frame = document.querySelector('iframe')!;
        const host = { result, calls: [] as { method: string; params: unknown }[], silent: false, rpcError: false };
        Object.assign(window, { host });
        window.addEventListener('message', event => {
            if (event.source !== frame.contentWindow) return;
            const { id, method, params } = event.data;
            const respond = (result: unknown) => frame.contentWindow!.postMessage({ jsonrpc: '2.0', id, result }, '*');
            if (method === 'ui/initialize') respond({ protocolVersion: '2026-01-26', hostInfo: { name: 'Test host', version: '1' }, hostCapabilities: { serverTools: {}, openLinks: {} }, hostContext: { theme } });
            if (method === 'ui/notifications/initialized') {
                frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { projectId: 'project-test', commentId: 'comment-test' } } }, '*');
                frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: host.result }, '*');
            }
            if (method === 'tools/call' || method === 'ui/open-link') {
                host.calls.push({ method, params });
                if (host.silent) return;
                if (host.rpcError) frame.contentWindow!.postMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Access denied' } }, '*');
                else respond(method === 'tools/call' ? host.result : {});
            }
        });
        frame.srcdoc = html;
    }, { html, result: fixture(), theme });
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Make the navigation easier to read' })).toBeVisible();
    await expect(frame.getByText('Updates every 30 seconds')).toBeVisible();
    return frame;
}

async function setResult(page: Page, result: unknown) {
    await page.evaluate(value => { (window as unknown as { host: { result: unknown } }).host.result = value; }, result);
}

test('thread card refreshes status through the read-only bridge and opens the approved link', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    await expect(frame.getByText('Open', { exact: true })).toBeVisible();
    await expect(frame.getByText('Ana', { exact: true })).toBeVisible();
    await expect(frame.getByText('I can reproduce this on mobile.')).toBeVisible();
    await setResult(page, fixture('in-progress'));
    await page.clock.runFor(30_001);
    await expect(frame.getByText('In progress', { exact: true })).toBeVisible();
    await setResult(page, { ...fixture('done'), structuredContent: { ...fixture('done').structuredContent, workflowStatus: { label: 'Shipped', category: 'done' } } });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('Shipped', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Open in uier' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { host: { calls: { method: string }[] } }).host.calls.at(-1)?.method)).toBe('ui/open-link');
    const calls = await page.evaluate(() => (window as unknown as { host: { calls: { method: string; params: unknown }[] } }).host.calls);
    expect(calls.filter(call => call.method === 'tools/call').map(call => call.params)).toEqual(Array(3).fill({ name: 'get_feedback', arguments: { projectId: 'project-test', commentId: 'comment-test' } }));
    expect(calls.at(-1)).toEqual({ method: 'ui/open-link', params: { url: 'https://uier.io/app/review/project-test?comment=comment-test' } });
});

test('thread card shows archive neutrally and stops updates on host teardown', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    const result = fixture('done');
    await setResult(page, { ...result, structuredContent: { ...result.structuredContent,
        context: { ...result.structuredContent.context, archivedAt: '2026-01-01T00:00:00Z' },
        workflowStatus: { category: 'archive', label: 'Archived' },
    } });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('Archived', { exact: true })).toHaveCount(1);
    await expect(frame.locator('span[aria-hidden="true"]')).toHaveClass(/bg-muted-foreground/);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', id: 111, method: 'ui/resource-teardown', params: {} }, '*'));
    await expect(frame.getByText('Updates paused. Reconnect your client, then refresh.')).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { host: { calls: unknown[] } }).host.calls.length);
    await page.clock.runFor(60_001);
    expect(await page.evaluate(() => (window as unknown as { host: { calls: unknown[] } }).host.calls.length)).toBe(calls);
});

test('thread card shows stale state after timeout, recovers, and clears denied thread data', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    await page.evaluate(() => { (window as unknown as { host: { silent: boolean } }).host.silent = true; });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.clock.runFor(15_001);
    await expect(frame.getByText('Updates paused. Reconnect your client, then refresh.')).toBeVisible();
    await expect(frame.getByRole('heading')).toHaveText('Make the navigation easier to read');
    await page.evaluate(() => { (window as unknown as { host: { silent: boolean } }).host.silent = false; });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('Updates every 30 seconds')).toBeVisible();
    await setResult(page, { isError: true, structuredContent: { error: 'not_found', message: 'Thread not found.' }, content: [] });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('This thread is unavailable. Access may have changed.')).toBeVisible();
    await expect(frame.getByRole('heading')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Open in uier' })).toHaveCount(0);
    const calls = await page.evaluate(() => (window as unknown as { host: { calls: unknown[] } }).host.calls.length);
    await page.clock.runFor(60_001);
    expect(await page.evaluate(() => (window as unknown as { host: { calls: unknown[] } }).host.calls.length)).toBe(calls);
});

test('thread card treats content as text, rejects unsafe links, and clears host errors', async ({ page }) => {
    const frame = await mount(page);
    const result = fixture();
    result.structuredContent.context.title = '<img src=x onerror=alert(1)> [click](javascript:alert(1))';
    result.structuredContent.context.links.comment = 'javascript:alert(1)';
    await setResult(page, result);
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByRole('heading')).toHaveText(result.structuredContent.context.title);
    await expect(frame.locator('img')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Open in uier' })).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { host: { rpcError: boolean } }).host.rpcError = true; });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByRole('heading')).toHaveCount(0);
    await expect(frame.getByText('This thread is unavailable. Access may have changed.')).toBeVisible();
});

test('thread card fits a narrow viewport and follows the host theme with accessible controls', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', message => { if (message.type() === 'error') violations.push(message.text()); });
    const frame = await mount(page, 'dark');
    await expect(frame.locator('html')).toHaveClass('dark');
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
    expect(violations).toEqual([]);
    await expectNoAxeViolations(page);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } }, '*'));
    await expect(frame.locator('html')).not.toHaveClass('dark');
    await expectNoAxeViolations(page);
});
