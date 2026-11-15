import { readFile } from 'node:fs/promises';
import { test, expect, type FrameLocator, type Page } from '@playwright/test';
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

type Host = { result: unknown; calls: { method: string; params: unknown }[]; silent: boolean; rpcError: boolean };
const stale = 'Could not check for updates. Showing the last result.';
const unavailable = 'This thread is unavailable. Access may have changed, or your client disconnected.';

async function mount(page: Page, { theme = 'light', initError = false }: { theme?: 'light' | 'dark'; initError?: boolean } = {}) {
    const html = await readFile(new URL('../dist/mcp/thread.html', import.meta.url), 'utf8');
    // This is a host implementation, not a direct component mount: the built resource runs
    // in an iframe and receives the same handshake, tool results and calls as a real MCP host.
    await page.route('https://mcp-host.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html lang="en"><title>MCP test host</title><body><main><iframe title="uier thread" style="width:100%;height:650px;border:0"></iframe></main></body></html>' }));
    await page.goto('https://mcp-host.test/');
    await page.evaluate(({ html, result, theme, initError }) => {
        const frame = document.querySelector('iframe')!;
        const host = { result, calls: [] as { method: string; params: unknown }[], silent: false, rpcError: false };
        Object.assign(window, { host });
        window.addEventListener('message', event => {
            if (event.source !== frame.contentWindow) return;
            const { id, method, params } = event.data;
            const respond = (result: unknown) => frame.contentWindow!.postMessage({ jsonrpc: '2.0', id, result }, '*');
            const fail = () => frame.contentWindow!.postMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Access denied' } }, '*');
            if (method === 'ui/initialize') {
                if (initError) fail();
                else respond({ protocolVersion: '2026-01-26', hostInfo: { name: 'Test host', version: '1' }, hostCapabilities: { serverTools: {}, openLinks: {} }, hostContext: { theme } });
            }
            if (method === 'ui/notifications/initialized') {
                frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { projectId: 'project-test', commentId: 'comment-test' } } }, '*');
                frame.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: host.result }, '*');
            }
            if (method === 'tools/call' || method === 'ui/open-link') {
                host.calls.push({ method, params });
                if (host.silent) return;
                if (host.rpcError) fail();
                else respond(method === 'tools/call' ? host.result : {});
            }
        });
        frame.srcdoc = html;
    }, { html, result: fixture(), theme, initError });
    const frame = page.frameLocator('iframe');
    if (initError) return frame;
    await expect(frame.getByRole('heading', { name: 'Make the navigation easier to read' })).toBeVisible();
    await expect(frame.getByText('Updates every 30 seconds')).toBeVisible();
    return frame;
}

async function setResult(page: Page, result: unknown) {
    await page.evaluate(value => { (window as unknown as { host: Host }).host.result = value; }, result);
}

async function setHost(page: Page, options: Partial<Pick<Host, 'silent' | 'rpcError'>>) {
    await page.evaluate(value => { Object.assign((window as unknown as { host: Host }).host, value); }, options);
}

const hostCalls = (page: Page) => page.evaluate(() => (window as unknown as { host: Host }).host.calls);
const statusBadge = (frame: FrameLocator) => frame.locator('[data-status-dot]').locator('..');
const announcement = (frame: FrameLocator) => frame.locator('[data-status-announcement]');
const teardown = (page: Page) => page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', id: 111, method: 'ui/resource-teardown', params: {} }, '*'));

test('thread card refreshes status through the read-only bridge and opens the approved link', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    await expect(statusBadge(frame)).toHaveText('Status: Open');
    await expect(frame.getByText('Assigned to Ana', { exact: true })).toBeVisible();
    await expect(frame.getByText('I can reproduce this on mobile.')).toBeVisible();
    await setResult(page, fixture('in-progress'));
    await page.clock.runFor(30_001);
    await expect(frame.getByText('In progress', { exact: true })).toBeVisible();
    await setResult(page, { ...fixture('done'), structuredContent: { ...fixture('done').structuredContent, workflowStatus: { label: 'Shipped', category: 'done' } } });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('Shipped', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Open in uier' }).click();
    await expect.poll(async () => (await hostCalls(page)).at(-1)?.method).toBe('ui/open-link');
    const calls = await hostCalls(page);
    expect(calls.filter(call => call.method === 'tools/call').map(call => call.params)).toEqual(Array(3).fill({ name: 'get_feedback', arguments: { projectId: 'project-test', commentId: 'comment-test' } }));
    expect(calls.at(-1)).toEqual({ method: 'ui/open-link', params: { url: 'https://uier.io/app/review/project-test?comment=comment-test' } });
});

test('thread card draws Open as an ink ring and announces status changes, not check times', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    // BRAND.md: Open is an outlined 1 px ink ring, not a filled dot, and keeps its size beside a long name.
    const dot = frame.locator('[data-status-dot]');
    await expect(dot).toHaveAttribute('data-status-dot', 'open');
    const ink = await frame.getByRole('heading').evaluate(heading => getComputedStyle(heading).color);
    // Chrome snaps a 1 px border to device pixels, so the width is checked as drawn, not as exactly 1.
    expect(await dot.evaluate(element => { const style = getComputedStyle(element); return [parseFloat(style.borderTopWidth) > 0, style.borderTopStyle, style.borderTopColor, style.backgroundColor, style.flexShrink]; }))
        .toEqual([true, 'solid', ink, 'rgba(0, 0, 0, 0)', '0']);
    // The check time changes every 30 seconds, so it stays outside every live region.
    const live = frame.locator('[role="status"], [aria-live]');
    await expect(frame.locator('time')).toBeVisible();
    await expect(frame.locator('[role="status"] time, [aria-live] time')).toHaveCount(0);
    await expect(announcement(frame)).toHaveText('');
    const checked = await frame.locator('time').getAttribute('datetime');
    const spoken = await live.allTextContents();
    await page.clock.runFor(30_001);
    await expect(frame.locator('time')).not.toHaveAttribute('datetime', checked!);
    expect(await live.allTextContents()).toEqual(spoken);
    // A changed workflow status is announced politely, once.
    await setResult(page, fixture('in-progress'));
    await page.clock.runFor(30_001);
    await expect(statusBadge(frame)).toHaveText('Status: In progress');
    await expect(announcement(frame)).toHaveText('Status changed to In progress.');
    await expect(announcement(frame)).toHaveAttribute('role', 'status');
    await expect(announcement(frame)).toHaveAttribute('aria-live', 'polite');
    await expect(dot).toHaveAttribute('data-status-dot', 'in-progress');
});

test('thread card shows archive neutrally and stops updates on host teardown', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    const result = fixture('done');
    // Without a workflow status, the card names it like the default workflow does.
    await setResult(page, { ...result, structuredContent: { ...result.structuredContent,
        context: { ...result.structuredContent.context, archivedAt: '2026-01-01T00:00:00Z' } } });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(statusBadge(frame)).toHaveText('Status: Archive');
    await expect(frame.locator('[data-status-dot]')).toHaveAttribute('data-status-dot', 'archive');
    await expect(frame.locator('[data-status-dot]')).toHaveClass(/bg-muted-foreground/);
    await teardown(page);
    await expect(frame.getByText('Updates stopped. Ask for this thread again to see its current status.')).toBeVisible();
    // The last result stays readable, and Refresh can't pretend to work.
    await expect(frame.getByRole('heading')).toHaveText('Make the navigation easier to read');
    await expect(frame.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    const calls = (await hostCalls(page)).length;
    await page.clock.runFor(60_001);
    expect((await hostCalls(page)).length).toBe(calls);
});

test('thread card disables Refresh when the host refuses the handshake', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page, { initError: true });
    await expect(frame.getByText('Could not connect to your client. Ask for this thread again.')).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    await expect(frame.getByRole('heading')).toHaveCount(0);
    await page.clock.runFor(60_001);
    expect(await hostCalls(page)).toEqual([]);
});

test('thread card keeps Refresh focused and labelled while checking, and recovers after a timeout', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    const refresh = frame.getByRole('button', { name: 'Refresh', exact: true });
    const width = (await refresh.boundingBox())!.width;
    await setHost(page, { silent: true });
    await refresh.focus();
    await page.keyboard.press('Enter');
    // Busy is announced on the button; the name, width and focus stay put while the host is slow.
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(refresh.locator('[data-slot="spinner"]')).toBeVisible();
    expect((await refresh.boundingBox())!.width).toBe(width);
    await page.keyboard.press('Enter');
    await page.clock.runFor(15_001);
    expect((await hostCalls(page)).filter(call => call.method === 'tools/call')).toHaveLength(2);
    // No answer in time: the last result stays, the warning reads as text, and checks continue.
    const warning = frame.getByText(stale);
    await expect(warning).toBeVisible();
    const ink = await frame.getByRole('heading').evaluate(heading => getComputedStyle(heading).color);
    expect(await warning.evaluate(element => getComputedStyle(element).color)).toBe(ink);
    await expect(frame.getByRole('heading')).toHaveText('Make the navigation easier to read');
    await expect(refresh).toHaveAttribute('aria-busy', 'false');
    await expect(refresh).toBeFocused();
    await setHost(page, { silent: false });
    await page.clock.runFor(15_000);
    await expect(frame.getByText('Updates every 30 seconds')).toBeVisible();
    await expect(refresh).toBeFocused();
});

test('thread card shows stale state after timeout, recovers, and clears denied thread data', async ({ page }) => {
    await page.clock.install();
    const frame = await mount(page);
    await setHost(page, { silent: true });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.clock.runFor(15_001);
    await expect(frame.getByText(stale)).toBeVisible();
    await expect(frame.getByRole('heading')).toHaveText('Make the navigation easier to read');
    await setHost(page, { silent: false });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText('Updates every 30 seconds')).toBeVisible();
    await setResult(page, { isError: true, structuredContent: { error: 'not_found', message: 'Thread not found.' }, content: [] });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByText(unavailable)).toBeVisible();
    await expect(frame.getByRole('heading')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Open in uier' })).toHaveCount(0);
    const calls = (await hostCalls(page)).length;
    await page.clock.runFor(60_001);
    expect((await hostCalls(page)).length).toBe(calls);
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
    // A JSON-RPC error can be refused access or a disconnected client: clear either way, say both.
    await setHost(page, { rpcError: true });
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(frame.getByRole('heading')).toHaveCount(0);
    await expect(frame.getByText(unavailable)).toBeVisible();
});

test('thread card fits a narrow viewport and follows the host theme with accessible controls', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', message => { if (message.type() === 'error') violations.push(message.text()); });
    const frame = await mount(page, { theme: 'dark' });
    await expect(frame.locator('html')).toHaveClass('dark');
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
    expect(violations).toEqual([]);
    await expectNoAxeViolations(page);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } }, '*'));
    await expect(frame.locator('html')).not.toHaveClass('dark');
    await expectNoAxeViolations(page);
});
