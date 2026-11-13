import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expectNoAxeViolations } from '../../web/e2e/accessibility';
import { animationsFinished, commentBubble, openPageCheck, openThread, pageCheckName, pageChecksButton, selectText, setThreadStatus, threadOptions, toolbar } from '../../web/e2e/support/toolbar';
import { signIn, createProject, uniqueEmail } from '../../web/e2e/support/app';

import { packageApiProxy } from './packageApi';
import { productionPackage, extensionPath, clientId, apiBase } from './environment';

let context: BrowserContext, origin: string, profile: string;
let publicId: string;
let proxy: Awaited<ReturnType<typeof packageApiProxy>> | undefined;
const server = createServer((req, res) => {
    if (req.url?.startsWith('/embedded')) {
        res.end(`<!doctype html><html lang="en"><title>Embedded review</title><h1>Review this page</h1><script src="${apiBase}/toolbar.js" data-uier-mode="showcase" data-uier-project="${publicId}" defer></script></html>`);
        return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; img-src 'none'; font-src 'none'; style-src 'none'");
    if (req.url?.startsWith('/checks')) {
        // Accessibility issues; on a page of over 1,500 elements nothing checks them unasked
        const paragraphs = req.url.includes('small') ? 3 : 1_600;
        res.end(`<!doctype html><html lang="en"><title>Strict CSP checks</title><main><h1>Check this page</h1><img id="chart" src="/chart.png"><button id="empty-button"></button>${'<p>A paragraph to check.</p>'.repeat(paragraphs)}</main></html>`);
        return;
    }
    res.end('<!doctype html><html lang="en"><title>Strict CSP</title><main><h1>Review this page</h1><p>No embed or page scripts.</p><a href="/next">Next page</a></main></html>');
});
async function launchContext() {
    const launched = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, baseURL: apiBase, ignoreDefaultArgs: ['--disable-back-forward-cache'], args: [...(proxy ? [`--host-resolver-rules=MAP uier.io 127.0.0.1:${proxy.port}, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`, `--ignore-certificate-errors-spki-list=${proxy.spki}`] : []), '--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    launched.setDefaultTimeout(10_000);
    return launched;
}
test.beforeAll(async () => {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    profile = await mkdtemp(resolve(tmpdir(), 'uier-extension-'));
    if (productionPackage) proxy = await packageApiProxy(profile);
    context = await launchContext();

});
test.afterAll(async () => { await context?.close(); await proxy?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(profile, { recursive: true, force: true }); });

test('account and workspace switching finds an unlisted site and replaces an active review', async () => {
    await context.clearCookies();
    const app = await context.newPage();
    const a = uniqueEmail('switch-a'), b = uniqueEmail('switch-b');
    await signIn(app, a);
    const first = await createProject(app, { name: 'Shared site', urls: [origin] });
    await app.goto('/app/projects');
    await app.getByRole('button', { name: /^Workspace:/ }).click();
    await app.getByRole('menuitem', { name: 'Create workspace', exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Create workspace' });
    await dialog.getByLabel('Workspace name').fill('Client work');
    await dialog.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await app.waitForURL(/\/app\/projects\/new$/);
    const second = await createProject(app, { name: 'Shared site', urls: [origin] });
    await signIn(app, b, { from: '/app/sign-in?add=1' });
    const bId = await app.evaluate(async () => (await (await fetch('/api/account/sessions')).json()).userId as string);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${clientId}/popup.html`);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    // This test is independent of any earlier extension login.
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'sign-out' }));
    await popup.reload();
    const login = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
    const auth = await login;
    await auth.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Switch account', exact: true })).toBeVisible();
    const reviewed = await context.newPage();
    await reviewed.goto(`${origin}/private?secret=not-for-consent#anchor`);
    await reviewed.bringToFront();
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targetInfos.find(target => target.url.startsWith(origin))!;
    await cdp.send('Extensions.triggerAction', { id: clientId, targetId: target.targetId });
    const actionPopup = context.pages().find(page => page !== popup && page.url() === `chrome-extension://${clientId}/popup.html`) ?? popup;
    await actionPopup.reload();
    await expect(actionPopup.getByText('No project includes this address', { exact: true })).toBeVisible();
    const switchWindow = context.waitForEvent('page');
    await actionPopup.getByRole('button', { name: 'Switch account', exact: true }).click();
    const consent = await switchWindow;
    await expect(consent.getByRole('region', { name: 'Signed-in accounts' })).toContainText('Shared site · Client work');
    expect(new URL(consent.url()).searchParams.get('siteOrigin')).toBe(origin);
    expect(consent.url()).not.toContain('not-for-consent');
    const accounts = consent.getByRole('region', { name: 'Signed-in accounts' });
    await accounts.locator('div').filter({ has: consent.getByText(a, { exact: true }) }).getByRole('button', { name: 'Use this account', exact: true }).click();
    await expect(accounts.locator('div').filter({ has: consent.getByText(a, { exact: true }) }).getByText('active', { exact: true })).toBeVisible();
    await consent.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
    const personal = actionPopup.getByRole('button', { name: 'Shared site Personal', exact: true });
    const client = actionPopup.getByRole('button', { name: 'Shared site Client work', exact: true });
    await expect(personal).toBeVisible();
    await expect(client).toBeVisible();
    await expect(actionPopup.getByRole('button', { name: 'Start review', exact: true })).toBeDisabled();
    await personal.focus();
    await personal.press('Enter');
    await actionPopup.getByRole('button', { name: 'Start review', exact: true }).click();
    await expect(toolbar(reviewed)).toBeVisible({ timeout: 30_000 });
    await expect(actionPopup.getByRole('button', { name: 'Exit review', exact: true })).toBeEnabled();
    await client.click();
    await actionPopup.getByRole('button', { name: 'Switch review', exact: true }).click();
    await expect(actionPopup.getByText('Reviewing Shared site', { exact: true })).toBeVisible();
    await expect.poll(() => worker.evaluate(async () => (Object.values(await chrome.storage.session.get(null)).find((value: any) => value?.projectId && value?.activation) as { projectId: string } | undefined)?.projectId)).toBe(second);
    const binding = await worker.evaluate(async () => Object.values(await chrome.storage.session.get(null)).find((value: any) => value?.projectId && value?.activation) as { tabId: number; projectId: string });
    expect(binding.projectId).toBe(second);
    expect(binding.projectId).not.toBe(first);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    await expect(actionPopup.getByRole('button', { name: 'Exit review', exact: true })).toBeEnabled();
    for (const colorScheme of ['light', 'dark'] as const) {
        await actionPopup.emulateMedia({ colorScheme });
        await expect(actionPopup.locator('html')).toHaveClass(colorScheme === 'dark' ? 'dark' : '');
        await animationsFinished(actionPopup.getByRole('main'));
        await expectNoAxeViolations(actionPopup);
    }
    // An actual unsent draft belongs to A and must leave with its credentials.
    await reviewed.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await reviewed.getByRole('heading', { level: 1 }).boundingBox())!;
    await reviewed.mouse.click(heading.x + 10, heading.y + 10);
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).fill('Private account A draft');
    await expect.poll(() => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).some(([key, value]) => key.startsWith('drafts:') && JSON.stringify(value).includes('Private account A draft')))).toBe(true);
    // Both accounts now have the same address; selecting B still requires a fresh consent.
    expect(await app.evaluate(async userId => (await fetch('/api/account/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', userId }) })).status, bId)).toBe(200);
    const third = await createProject(app, { name: 'Shared site', urls: [origin] });
    await reviewed.bringToFront();
    await cdp.send('Extensions.triggerAction', { id: clientId, targetId: target.targetId });
    await actionPopup.reload();
    const nextWindow = context.waitForEvent('page');
    await actionPopup.getByRole('button', { name: 'Switch account', exact: true }).click();
    const nextConsent = await nextWindow;
    await expect(nextConsent.getByRole('region', { name: 'Signed-in accounts' })).toContainText(a);
    await expect(nextConsent.getByRole('region', { name: 'Signed-in accounts' })).toContainText(b);
    await expectNoAxeViolations(nextConsent);
    // Leave the consent window without approving: the active extension review survives.
    await nextConsent.close();
    await expect(actionPopup.getByRole('alert')).toBeVisible();
    await expect(toolbar(reviewed)).toBeVisible();
    const retryWindow = context.waitForEvent('page');
    await actionPopup.getByRole('button', { name: 'Switch account', exact: true }).click();
    const retryConsent = await retryWindow;
    await retryConsent.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
    await expect(actionPopup.getByText(b, { exact: true })).toBeVisible();
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);
    const afterSwitch = await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)));
    expect(afterSwitch.some(key => /^(binding|proof|drafts):/.test(key))).toBe(false);
    const result = await actionPopup.evaluate(({ tabId, projectId, publicId }) => chrome.runtime.sendMessage({ type: 'start', tabId, projectId, publicId }),
        { tabId: binding.tabId, projectId: second, publicId: 'invalid-public-id' });
    expect(result.ok).toBe(false);
    await actionPopup.reload();
    await expect(actionPopup.getByRole('button', { name: 'Shared site Personal', exact: true })).toBeVisible();
    await actionPopup.getByRole('button', { name: 'Start review', exact: true }).click();
    await expect(toolbar(reviewed)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => worker.evaluate(async () => (Object.values(await chrome.storage.session.get(null)).find((value: any) => value?.projectId && value?.activation) as { projectId: string } | undefined)?.projectId)).toBe(third);
    await expect(reviewed.getByText('Private account A draft', { exact: true })).toHaveCount(0);
    await expect(actionPopup.getByRole('button', { name: 'Exit review', exact: true })).toBeEnabled();
    await actionPopup.getByRole('button', { name: 'Sign out', exact: true }).click();
    await context.clearCookies();
    const idle = await context.newPage();
    await Promise.all(context.pages().filter(page => page !== idle).map(page => page.close()));
});

test('packaged isolated runtime uses real sign-in, helper and worker under strict CSP', async ({}, info) => {
    const app = await context.newPage();
    const email = uniqueEmail('extension');
    await signIn(app, email);
    const projectId = await createProject(app, { name: 'Strict CSP site', urls: [origin] });
    publicId = await app.evaluate(async id => (await (await fetch(`/api/review/${id}`)).json()).project.id, projectId);
    const otherProjectId = await createProject(app, { name: 'Another project', urls: [origin] });
    const otherPublicId = await app.evaluate(async id => (await (await fetch(`/api/review/${id}`)).json()).project.id, otherProjectId);
    const id = clientId;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByText('Browser extension', { exact: true })).toBeVisible();
    await expect(popup.getByText('development preview', { exact: false })).toHaveCount(0);
    const login = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Sign in to uier' }).click();
    const auth = await login;
    await auth.waitForLoadState();
    if (new URL(auth.url()).pathname.startsWith('/app/sign-in')) await signIn(auth, email, { from: auth.url() });
    await expect(auth.getByText('Stay signed in across browser restarts.', { exact: false })).toBeVisible();
    await auth.getByRole('button', { name: 'Sign in to uier' }).click();
    await expect(popup.getByRole('button', { name: 'Sign out' })).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
        await popup.emulateMedia({ colorScheme });
        await expect(popup.locator('html')).toHaveClass(colorScheme === 'dark' ? 'dark' : '');
        await animationsFinished(popup.getByRole('main'));
        await expectNoAxeViolations(popup);
        await popup.screenshot({ path: info.outputPath(`popup-${colorScheme}.png`) });
    }
    const reviewed = await context.newPage();
    await reviewed.goto(origin);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);
    // Chrome's action API grants activeTab. Persistent Chromium covers the actual package.
    await reviewed.bringToFront();
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targetInfos.find(t => t.url.startsWith(origin));
    expect(target).toBeTruthy();
    await browserCdp.send('Extensions.triggerAction', { id, targetId: target!.targetId });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(async () => {
        const values = await chrome.storage.local.get(null);
        const refresh = Object.entries(values).find(([key]) => key.startsWith('extension-refresh-v1:'))?.[1] as Record<string, unknown>;
        return Object.keys(refresh).sort();
    })).toEqual(['id', 'refreshExpiresAt', 'refreshToken']);
    // Expired access renews without web cookies or interactive login. Packaged acceptance also
    // loses a committed refresh response and checks that the saved attempt recovers it.
    await context.clearCookies();
    await worker.evaluate(async () => {
        const stored = await chrome.storage.session.get('extension-session-v1');
        await chrome.storage.session.set({ 'extension-session-v1': { ...(stored['extension-session-v1'] as object), expiresAt: 0 } });
    });
    if (proxy) {
        proxy.dropNextRefreshResponse();
        expect((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'state' }))).ok).toBe(false);
        expect(await worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((value: any) => Boolean(value?.attempt)))).toBe(true);
    }
    const renewed = await popup.evaluate(() => Promise.all([
        chrome.runtime.sendMessage({ type: 'state' }), chrome.runtime.sendMessage({ type: 'state' })
    ]));
    expect(renewed.every(result => result.ok && result.value.signedIn)).toBe(true);
    // The browser action popup is inspected through its extension document; no fake browser API.
    const pages = context.pages();
    const actionPopup = pages.find(p => p.url() === `chrome-extension://${id}/popup.html` && p !== popup) ?? popup;
    await actionPopup.reload();

    await expect(actionPopup.getByRole('button', { name: 'Strict CSP site' })).toBeVisible();
    await actionPopup.getByRole('button', { name: 'Strict CSP site Personal', exact: true }).click();
    await actionPopup.getByRole('button', { name: 'Start review' }).click();

    await expect(reviewed.getByRole('navigation', { name: 'uier feedback', exact: true })).toBeVisible({ timeout: 30_000 });
    // Repeated activation stays idempotent; a popup cannot impersonate a content broker.
    const tabId = await worker.evaluate(async () => Number(Object.keys(await chrome.storage.session.get(null)).find(key => key.startsWith('binding:'))!.slice(8)));
    const send = (message: object) => actionPopup.evaluate(message => chrome.runtime.sendMessage(message), message);
    expect((await send({ type: 'request', url: `${apiBase}/api/review/${publicId}/comments`, headers: { Authorization: 'forged' } })).ok).toBe(false);
    expect((await send({ type: 'request', url: `${apiBase}/api/review/${publicId}/comments` })).ok).toBe(false);
    expect((await send({ type: 'start', tabId, projectId, publicId })).ok).toBe(true);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    // The popup's update check read uier's version without cookies. Nothing is downloaded, so a
    // restart is refused and the review keeps its toolbar.
    const version = await actionPopup.evaluate(() => chrome.runtime.getManifest().version);
    expect(await send({ type: 'update' })).toEqual({ ok: true, value: { version } });
    expect((await send({ type: 'install-update' })).ok).toBe(false);
    if (proxy) expect(proxy.requests.filter(r => r.path === '/api/extension/version').map(r => r.hasCookie)).toContain(false);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    // Sign-in cookies are no longer needed by the worker or the verification helper.
    await context.clearCookies();
    await reviewed.getByRole('button', { name: 'Add comment', exact: true }).click();
    const box = (await reviewed.getByRole('heading', { level: 1 }).boundingBox())!;
    await reviewed.mouse.click(box.x + 10, box.y + 10);
    const composer = reviewed.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Strict CSP extension feedback'); await composer.press('Enter');
    await expect(reviewed.getByText('Strict CSP extension feedback', { exact: true })).toBeVisible();
    await reviewed.reload();
    await expect(reviewed.getByRole('navigation', { name: 'uier feedback', exact: true })).toBeVisible();
    await expect(commentBubble(reviewed, 1)).toBeVisible();
    await commentBubble(reviewed, 1).click();
    const thread = openThread(reviewed);
    const screenshot = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(screenshot).toBeVisible();
    await expect(screenshot.locator('canvas')).toBeVisible();
    await animationsFinished(thread);
    await reviewed.screenshot({ path: info.outputPath('store-review-1280x800.png') });
    await screenshot.click();
    await expect(reviewed.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();

    await reviewed.getByRole('button', { name: 'Redact screenshot' }).click();
    const editor = reviewed.getByRole('region', { name: 'Redact screenshot' });
    await editor.getByLabel('Left (%)').fill('0'); await editor.getByLabel('Top (%)').fill('0');
    await editor.getByLabel('Width (%)').fill('100'); await editor.getByLabel('Height (%)').fill('100');
    await editor.getByRole('button', { name: 'Add redaction', exact: true }).click();
    await editor.getByRole('button', { name: 'Save redaction' }).click();
    await expect(reviewed.getByRole('status').filter({ hasText: 'Screenshot replaced.' })).toBeVisible();
    // Reopen through the broker, with the host's img-src still set to none.
    await screenshot.click();
    await expect(reviewed.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    await reviewed.getByRole('button', { name: 'Close screenshot', exact: true }).click();
    // Force local cache renewal, which must still use the real bridge and API boundaries.
    await worker.evaluate(async () => {
        const values = await chrome.storage.session.get(null);
        for (const [key, value] of Object.entries(values)) {
            if (key.startsWith('proof:')) await chrome.storage.session.set({ [key]: { ...(value as object), expiresAt: 0 } });
        }
    });
    const reply = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await reply.fill('A reply after proof renewal.'); await reply.press('Enter');
    await expect(commentBubble(reviewed, 2)).toBeVisible({ timeout: 30_000 });
    await setThreadStatus(reviewed, thread, 'Done');
    await reviewed.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = reviewed.getByRole('complementary', { name: 'Comments' });
    await inbox.getByRole('button', { name: /^Done \d/ }).click();
    await setThreadStatus(reviewed, inbox.getByRole('article'), 'Open');
    await expect(commentBubble(reviewed, 2)).toBeVisible();
    await inbox.getByRole('button', { name: /^Active \d/ }).click();
    // Priority is in Thread options; a priority other than Normal shows beside the status
    const options = await threadOptions(reviewed, inbox.getByRole('article'));
    await options.getByRole('button', { name: 'Priority: Normal. Change priority', exact: true }).click();
    await options.getByRole('group', { name: 'Set priority' }).getByRole('button', { name: 'High', exact: true }).click();
    await expect(inbox.getByRole('article')).toContainText('Priority: High');
    // Archive uses the same closed worker transport as list reloads and workflow changes.
    await (await threadOptions(reviewed, inbox.getByRole('article'))).getByRole('button', { name: 'Archive comment', exact: true }).click();
    await expect(commentBubble(reviewed, 2)).toHaveCount(0);
    // Archive is folded under the Done tab's menu
    await inbox.getByRole('button', { name: 'Done and archive', exact: true }).click();
    const doneMenu = reviewed.getByRole('dialog', { name: 'Done and archive' });
    await doneMenu.getByRole('button', { name: /^Archive/ }).click();
    await expect(doneMenu).toBeHidden();
    await expect(inbox.getByRole('button', { name: 'Archive 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(inbox.getByRole('article')).toContainText('Strict CSP extension feedback');
    await (await threadOptions(reviewed, inbox.getByRole('article'))).getByRole('button', { name: 'Restore comment', exact: true }).click();
    await expect(commentBubble(reviewed, 2)).toBeVisible();
    await inbox.getByRole('button', { name: /^Active \d/ }).click();
    await inbox.getByRole('button', { name: 'Close sidebar', exact: true }).click();
    await expect(inbox).toBeHidden();
    // Drafts recover across a real worker shutdown and page reload, with no image records.
    const addComment = reviewed.getByRole('button', { name: 'Add comment', exact: true });
    await addComment.click();
    await expect(addComment).toHaveAttribute('aria-pressed', 'true');
    const paragraph = (await reviewed.locator('p').first().boundingBox())!;
    await reviewed.mouse.click(paragraph.x + 8, paragraph.y + 8);
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).fill('Recovered extension draft');
    await expect.poll(() => worker.evaluate(async () => JSON.stringify(await chrome.storage.session.get(null)))).toContain('Recovered extension draft');
    const draftRecords = await worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).filter(([key]) => key.startsWith('drafts:')));
    expect(JSON.stringify(draftRecords)).not.toContain('data:image/');
    const targets = await browserCdp.send('Target.getTargets');
    const workerTarget = targets.targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${id}/`));
    expect(workerTarget).toBeTruthy();
    const workerStartedAt = await worker.evaluate(() => performance.timeOrigin);
    await browserCdp.send('Target.closeTarget', { targetId: workerTarget!.targetId });
    expect((await send({ type: 'state' })).ok).toBe(true);
    // Playwright preserves its Worker handle across MV3 restarts.
    expect(await worker.evaluate(() => performance.timeOrigin)).not.toBe(workerStartedAt);
    await reviewed.reload();
    await reviewed.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(reviewed.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Recovered extension draft', { useInnerText: true });
    if (proxy) {
        proxy.dropNextReviewWrite();
        await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
        await expect(reviewed.getByRole('dialog', { name: 'New comment', exact: true }).getByRole('alert')).toContainText('Check your connection');
        await reviewed.reload();
        await reviewed.getByRole('button', { name: 'New comment', exact: true }).click();
        await expect(reviewed.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Recovered extension draft', { useInnerText: true });
    }
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(reviewed.getByText('Recovered extension draft', { exact: true })).toBeVisible();
    // The committed-but-lost response is retried under its original submission ID.
    expect(await worker.evaluate(async api => {
        const values = await chrome.storage.session.get(null);
        const binding = Object.values(values).find((value: any) => value?.scope?.token) as { scope: { token: string } };
        const response = await fetch(`${api}/api/extension/review/comments?path=%2F`, { credentials: 'omit', headers: { Authorization: `Bearer ${binding.scope.token}` } });
        if (!response.ok) throw new Error('Could not verify saved comments');
        return (await response.json()).length;
    }, apiBase)).toBe(2);
    await reviewed.keyboard.press('Escape');
    // Text and area anchors use the same packaged runtime and worker image path.
    await selectText(reviewed, 'No embed or page scripts.');
    await reviewed.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Add comment', exact: true }).click();
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).fill('Feedback on selected text');
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(reviewed.getByText('Feedback on selected text', { exact: true })).toBeVisible();
    await reviewed.keyboard.press('Escape');
    await reviewed.evaluate(() => getSelection()?.removeAllRanges());
    await reviewed.getByRole('button', { name: 'Add comment', exact: true }).click();
    const areaBox = (await reviewed.getByRole('heading', { level: 1 }).boundingBox())!;
    await reviewed.mouse.move(areaBox.x + 350, areaBox.y + 5); await reviewed.mouse.down();
    await reviewed.mouse.move(areaBox.x + 500, areaBox.y + areaBox.height - 5, { steps: 5 }); await reviewed.mouse.up();
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).fill('Feedback on an area');
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(reviewed.getByText('Feedback on an area', { exact: true })).toBeVisible();
    await reviewed.keyboard.press('Escape');
    // A capture in an inactive tab fails safely while its text can still be submitted.
    await reviewed.getByRole('button', { name: 'Add comment', exact: true }).click();
    const otherTab = await context.newPage(); await otherTab.goto(`${origin}/other-tab`); await otherTab.bringToFront();
    await reviewed.mouse.click(areaBox.x + 650, areaBox.y + 10);
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).fill('Text survives a tab switch');
    await reviewed.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(reviewed.getByText('Text survives a tab switch', { exact: true })).toBeVisible();
    const switched = await worker.evaluate(async api => {
        const values = await chrome.storage.session.get(null);
        const binding = Object.values(values).find((value: any) => value?.scope?.token) as { scope: { token: string } };
        const response = await fetch(`${api}/api/extension/review/comments?path=%2F`, { credentials: 'omit', headers: { Authorization: `Bearer ${binding.scope.token}` } });
        return (await response.json()).find((comment: any) => comment.thread.items[0]?.text === 'Text survives a tab switch');
    }, apiBase);
    expect(switched).toBeTruthy(); expect(switched.screenshot).toBeUndefined();
    await reviewed.bringToFront(); await otherTab.close();
    // Switching projects in the same document creates a fresh configured runtime.
    expect((await send({ type: 'start', tabId, projectId: otherProjectId, publicId: otherPublicId })).ok).toBe(true);
    await expect(commentBubble(reviewed, 2)).toHaveCount(0);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    expect((await send({ type: 'exit', tabId })).ok).toBe(true);
    await reviewed.reload();
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);
    expect((await send({ type: 'start', tabId, projectId, publicId })).ok).toBe(true);
    await expect(commentBubble(reviewed, 2)).toBeVisible();
    // SPA history changes retain the review without reinjecting a second toolbar.
    await reviewed.evaluate(() => history.pushState(null, '', '/spa'));
    await expect(reviewed.getByRole('navigation', { name: 'uier feedback', exact: true })).toBeVisible();
    await reviewed.goBack();
    await expect(commentBubble(reviewed, 2)).toBeVisible();
    // Credentials stay out of page storage and DOM attributes.
    expect(await reviewed.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    // The Accessibility panel and the on-demand checks run the packaged audit asset (audit.js): the
    // worker runs it in the toolbar's isolated world when a check runs, never as a page script or from
    // the network. Over 1,500 elements nothing checks the page unasked, so only the panel loads it.
    const pageRequests: string[] = [];
    const recordRequest = (request: { url: () => string }) => { pageRequests.push(request.url()); };
    reviewed.on('request', recordRequest);
    const proxied = proxy?.requests.length ?? 0;
    await reviewed.goto(`${origin}/checks`);
    const pill = toolbar(reviewed);
    // The background checks ran (SEO found what is missing in the head), without the audit; both are in the Page checks menu
    await expect(pageChecksButton(reviewed)).toHaveAttribute('data-uier-attention-panels', /\bseo\b/, { timeout: 20_000 });
    expect(await pageCheckName(reviewed, /^SEO/)).toMatch(/^SEO, \d+ to look at$/);
    expect(await pageCheckName(reviewed, /^Accessibility/)).toBe('Accessibility');
    await reviewed.waitForTimeout(1_000);
    // Every script parsed in the reviewed document, including the extension's isolated world
    const debug = await context.newCDPSession(reviewed);
    const parsed: string[] = [];
    debug.on('Debugger.scriptParsed', ({ url }) => { if (url.startsWith(`chrome-extension://${id}/`)) parsed.push(new URL(url).pathname); });
    await debug.send('Debugger.enable');
    expect(parsed).toContain('/content.js');
    expect(parsed).not.toContain('/audit.js');
    await openPageCheck(reviewed, /^Accessibility/);
    const checksPanel = reviewed.getByRole('complementary', { name: 'Accessibility' });
    await expect(checksPanel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 30_000 });
    await expect(checksPanel.locator('[data-uier-rule="image-alt"]')).toContainText('img#chart');
    await expect(checksPanel.locator('[data-uier-rule="button-name"]')).toContainText('button#empty-button');
    await expect(checksPanel).not.toContainText('uier-toolbar');
    expect(await pageCheckName(reviewed, /^Accessibility/)).toMatch(/^Accessibility, \d+ issues? found$/);
    expect(parsed.filter(path => path === '/audit.js')).toHaveLength(1);
    // Check again reuses the loaded asset
    const checkAgain = checksPanel.getByRole('button', { name: 'Check again' });
    await checkAgain.click();
    await expect(checkAgain).not.toHaveAttribute('aria-busy', 'true');
    await expect(checksPanel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/);
    expect(parsed.filter(path => path === '/audit.js')).toHaveLength(1);
    await debug.detach();
    // The page sees none of it: no axe-core or its shared state, no handoff, no script element
    expect(await reviewed.evaluate(() => ['axe' in window, '__core-js_shared__' in window, Symbol.for('uier.toolbar.audit') in window, document.scripts.length]))
        .toEqual([false, false, false, 0]);
    reviewed.off('request', recordRequest);
    expect(pageRequests.filter(url => /audit|\/toolbar(?:\.js|\/)/.test(url))).toEqual([]);
    if (proxy) expect(proxy.requests.slice(proxied).filter(request => request.path.startsWith('/toolbar'))).toEqual([]);
    await animationsFinished(checksPanel);
    await reviewed.screenshot({ path: info.outputPath('accessibility-panel.png') });
    await expectNoAxeViolations(reviewed, { include: ['#uier-toolbar'] });
    await reviewed.keyboard.press('Escape');
    await expect(checksPanel).toBeHidden();
    // A smaller page is audited in the background once the toolbar loaded: the button says what it found
    await reviewed.goto(`${origin}/checks?small`);
    await expect(pageChecksButton(reviewed)).toHaveAttribute('data-uier-attention-panels', /\baccessibility\b/, { timeout: 30_000 });
    expect(await pageCheckName(reviewed, /^Accessibility/)).toMatch(/^Accessibility, \d+ issues? found$/);
    await expect(pill.locator('[data-uier-attention="page-checks"]')).toBeVisible();
    // A live embed yields to the extension; a late embed also sees the public ownership probe.
    publicId = otherPublicId; // Existing embed intentionally belongs to another project.
    await reviewed.goto(`${origin}/embedded`);
    await expect(reviewed.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    await reviewed.evaluate(async api => {
        const script = document.createElement('script');
        script.src = `${api}/toolbar.js`; script.dataset.uierMode = 'showcase';
        document.head.append(script);
        await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error('Embed load failed')); });
    }, apiBase);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    await reviewed.goto(origin);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    const reviewedDocument = await reviewed.evaluate(() => performance.timeOrigin);
    // A same-origin cache restore is remounted only through the live worker binding.
    await reviewed.goto(`${origin}/next`);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    await reviewed.evaluate(() => history.back());
    await expect(reviewed).toHaveURL(`${origin}/`);
    expect(await reviewed.evaluate(() => performance.timeOrigin)).toBe(reviewedDocument);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    // A second origin ends activation even when Back restores the previous document from BFCache.
    await reviewed.goto(origin.replace('127.0.0.1', 'localhost'));
    // A restored document emits pageshow, not another load event for Playwright to await.
    await reviewed.evaluate(() => history.back());
    await expect(reviewed).toHaveURL(`${origin}/`);
    expect(await reviewed.evaluate(() => performance.timeOrigin)).toBe(reviewedDocument);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);

    if (proxy) expect(proxy.requests.filter(request => request.path.startsWith('/api/extension/')).every(request => !request.hasCookie)).toBe(true);
    // A real browser restart retains only the refresh credential. No site reactivates itself.
    await context.close();
    context = await launchContext();
    const resumedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(await resumedWorker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)))).toEqual([]);
    const resumedSite = await context.newPage();
    await resumedSite.goto(origin);
    await expect(resumedSite.locator('#uier-toolbar')).toHaveCount(0);
    const resumedPopup = await context.newPage();
    await resumedPopup.goto(`chrome-extension://${id}/popup.html`);
    await expect(resumedPopup.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // Only renewed access and the popup's hourly update check; no binding, proof or draft returns.
    await expect.poll(() => resumedWorker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).sort()))
        .toEqual(['extension-session-v1', 'update-checked-v1']);
    if (proxy) {
        // A renewal committed on the server must not restore credentials after concurrent logout.
        const held = proxy.holdNextRefreshResponse();
        await resumedWorker.evaluate(async () => {
            const stored = await chrome.storage.session.get('extension-session-v1');
            await chrome.storage.session.set({ 'extension-session-v1': { ...(stored['extension-session-v1'] as object), expiresAt: 0 } });
        });
        const renewal = resumedPopup.evaluate(() => chrome.runtime.sendMessage({ type: 'state' }));
        await held.ready;
        const logout = await resumedPopup.evaluate(() => Promise.all([
            chrome.runtime.sendMessage({ type: 'sign-out' }), chrome.runtime.sendMessage({ type: 'sign-out' })
        ]));
        expect(logout.every(result => result.ok)).toBe(true);
        held.release();
        expect((await renewal).ok).toBe(true); // State reports signed out after the fenced response.
        await resumedPopup.reload();
    } else await resumedPopup.getByRole('button', { name: 'Sign out' }).click();
    await expect(resumedPopup.getByRole('button', { name: 'Sign in to uier' })).toBeVisible();
    // Sign-out clears every private record. The reopened popup's update check keeps only its time.
    expect(await resumedWorker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter(key => key !== 'update-checked-v1'))).toEqual([]);
    expect(await resumedWorker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('extension-refresh-v1:')))).toEqual([]);

    // A download the browser reported (onUpdateAvailable records it) is offered with a real restart.
    await resumedWorker.evaluate(async () => chrome.storage.session.set({ 'update-ready-v1': '65535.0.0' }));
    await resumedPopup.reload();
    const notice = resumedPopup.getByRole('region', { name: 'Update ready' });
    await expect(notice).toContainText('Version 65535.0.0 is downloaded.');
    for (const colorScheme of ['light', 'dark'] as const) {
        await resumedPopup.emulateMedia({ colorScheme });
        await expect(resumedPopup.locator('html')).toHaveClass(colorScheme === 'dark' ? 'dark' : '');
        await animationsFinished(resumedPopup.getByRole('main'));
        await expectNoAxeViolations(resumedPopup);
        await resumedPopup.screenshot({ path: info.outputPath(`popup-update-${colorScheme}.png`) });
    }
    // runtime.reload() closes every extension page. A command-line package does not load again
    // in this harness, so the restart is the last step.
    const closed = resumedPopup.waitForEvent('close');
    await notice.getByRole('button', { name: 'Restart and update' }).click();
    await closed;
});
