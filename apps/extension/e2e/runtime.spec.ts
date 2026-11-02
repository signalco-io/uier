import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expectNoAxeViolations } from '../../web/e2e/accessibility';
import { animationsFinished, commentBubble, openThread } from '../../web/e2e/support/toolbar';
import { signIn, createProject, projectPublicId, uniqueEmail } from '../../web/e2e/support/app';

let context: BrowserContext, origin: string, profile: string;
let publicId: string;
const apiOrigin = `http://127.0.0.1:${process.env.PORT || 4004}`;
const server = createServer((req, res) => {
    if (req.url?.startsWith('/embedded')) {
        res.end(`<!doctype html><html lang="en"><title>Embedded review</title><h1>Review this page</h1><script src="${apiOrigin}/toolbar.js" data-uier-mode="showcase" data-uier-project="${publicId}" defer></script></html>`);
        return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; img-src 'none'; font-src 'none'; style-src 'none'");
    res.end('<!doctype html><html lang="en"><title>Strict CSP</title><h1>Review this page</h1><p>No embed or page scripts.</p><a href="/next">Next page</a></html>');
});
test.beforeAll(async () => {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    profile = await mkdtemp(resolve(tmpdir(), 'uier-extension-'));
    const path = resolve(import.meta.dirname, '../dist-test');
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, baseURL: apiOrigin, args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${path}`, `--load-extension=${path}`] });
    context.setDefaultTimeout(10_000);
});
test.afterAll(async () => { await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(profile, { recursive: true, force: true }); });

test('packaged isolated runtime uses real sign-in, helper and worker under strict CSP', async ({}, info) => {
    const app = await context.newPage();
    await signIn(app, uniqueEmail('extension'));
    const projectId = await createProject(app, { name: 'Strict CSP site', urls: [origin] });
    publicId = await projectPublicId(app, projectId);
    const id = (await readFile(resolve(import.meta.dirname, '../dist-test/development-id.txt'), 'utf8')).trim();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const login = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Sign in to uier' }).click();
    const auth = await login;
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
    // The browser action popup is inspected through its extension document; no fake browser API.
    const pages = context.pages();
    const actionPopup = pages.find(p => p.url() === `chrome-extension://${id}/popup.html` && p !== popup) ?? popup;
    await actionPopup.reload();

    await expect(actionPopup.getByRole('button', { name: 'Strict CSP site' })).toBeVisible();
    await actionPopup.getByRole('button', { name: 'Start review' }).click();
    await expect(actionPopup.getByRole('button', { name: 'Start review' })).toBeEnabled({ timeout: 30_000 });
    await expect(reviewed.getByRole('navigation', { name: 'uier feedback', exact: true })).toBeVisible({ timeout: 30_000 });
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
    await thread.getByRole('button', { name: 'Mark as done' }).click();
    await reviewed.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = reviewed.getByRole('complementary', { name: 'Comments' });
    await inbox.getByRole('button', { name: /^Done/ }).click();
    await inbox.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(commentBubble(reviewed, 2)).toBeVisible();
    await inbox.getByRole('button', { name: /^Open/ }).click();
    await inbox.getByRole('button', { name: 'Priority: Normal. Change priority', exact: true }).click();
    await inbox.getByRole('button', { name: 'High', exact: true }).click();
    await expect(inbox.getByRole('button', { name: 'Priority: High. Change priority', exact: true })).toBeVisible();
    // Credentials stay out of page storage and DOM attributes.
    expect(await reviewed.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    // A live embed yields to the extension; a late embed also sees the public ownership probe.
    await reviewed.goto(`${origin}/embedded`);
    await expect(reviewed.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    await reviewed.evaluate(async apiOrigin => {
        const script = document.createElement('script');
        script.src = `${apiOrigin}/toolbar.js`; script.dataset.uierMode = 'showcase';
        document.head.append(script);
        await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error('Embed load failed')); });
    }, apiOrigin);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(1);
    // A second origin ends activation, including when returning to a previously allowed address.
    await reviewed.goto(origin.replace('127.0.0.1', 'localhost'));
    await reviewed.goto(origin);
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);

    await actionPopup.evaluate(async () => { await chrome.runtime.sendMessage({ type: 'sign-out' }); });
    await expect(reviewed.locator('#uier-toolbar')).toHaveCount(0);
    expect(await worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)))).toEqual([]);
});
