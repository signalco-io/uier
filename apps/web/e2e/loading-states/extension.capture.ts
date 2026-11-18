import { test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Capture, hardLoad, softNav, type Entry } from './capture';

// The browser extension's own pages (the popup and the verification helper window) and the public pages that load
// something after their shell. The extension pages are the built files of apps/extension/dist with the extension API
// replaced by a stand-in whose answers this capture holds back; nothing leaves the machine.

const dist = new URL('../../../extension/dist/', import.meta.url).pathname;
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const extensionOrigin = 'https://extension.test';

type Answers = Record<string, unknown>;

/** Opens a built extension page with `chrome.runtime` answering from `answers` (a missing type never answers) */
async function openExtensionPage(page: Page, file: string, answers: Answers) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route(`${extensionOrigin}/**`, async route => {
        const path = new URL(route.request().url()).pathname.slice(1);
        try { await route.fulfill({ body: await readFile(join(dist, path)), contentType: types[extname(path)] ?? 'application/octet-stream' }); }
        catch { await route.fulfill({ status: 404, body: '' }); }
    });
    // The helper's frame is uier's verification bridge: a stand-in that says it is ready, as the real one does
    await page.route('https://uier.io/**', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><title>bridge</title><script>parent.postMessage({ type: "uier:extension-verification-ready" }, "*")</script>' }));
    await page.addInitScript(({ origin, answers }) => {
        const pending = new Map<string, ((value: unknown) => void)[]>();
        const state = { answers: answers as Record<string, unknown> };
        Object.assign(window, {
            // Lets the capture answer a held message later
            answerExtension(type: string, value: unknown) {
                state.answers[type] = value;
                for (const resolve of pending.get(type) ?? []) resolve({ ok: true, value });
                pending.delete(type);
            },
            chrome: { runtime: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                getURL: (path: string) => `${origin}/${path}`,
                sendMessage: (message: { type: string }) => message.type in state.answers
                    ? Promise.resolve({ ok: true, value: state.answers[message.type] })
                    : new Promise(resolve => pending.set(message.type, [...pending.get(message.type) ?? [], resolve]))
            } }
        });
    }, { origin: extensionOrigin, answers });
    await page.goto(`${extensionOrigin}/${file}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
}

const projects = [
    { id: 'pub-shop', projectId: 'shop', name: 'Shop', access: 'link', workspaceName: 'Acme studio' },
    { id: 'pub-docs', projectId: 'docs', name: 'Docs site', access: 'invited', workspaceName: 'Acme studio' }
];
const signedIn = { signedIn: true, tabId: 1, origin: 'https://shop.example.com', projects, canSetUp: true, account: { name: 'Ana', email: 'ana@example.com' } };

test('extension and public pages', async ({ page, baseURL, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'The extension is a desktop product; its pages have one size');
    const capture = new Capture(info, 'extension');
    const record = async (target: Page, entry: Omit<Entry, 'viewport' | 'file' | 'statuses' | 'skeletons' | 'trigger'>) => {
        const recorded = await capture.record(target, { ...entry, trigger: 'in-page' });
        // The page is the popup: crop to it
        const main = target.locator('main').first();
        if (await main.count()) await main.screenshot({ path: join(capture.dir, `${entry.id}.png`), animations: 'disabled' });
        return recorded;
    };
    try {
        // --- The popup -------------------------------------------------------------------------------------------
        const popup = await (await browser.newContext({ viewport: { width: 340, height: 600 }, deviceScaleFactor: 2 })).newPage();
        const group = 'Browser extension';
        // On open the popup asks the worker three things at once: `tab` (answered from local state), `state` (which
        // needs uier) and `update`. Held: both; then the local answer alone; then both.
        const answer = (type: string, value: unknown) => popup.evaluate(([name, data]) => (window as unknown as { answerExtension(type: string, value: unknown): void }).answerExtension(name as string, data), [type, value]);
        const tab = { signedIn: true, tabId: 1, origin: 'https://shop.example.com', binding: false };
        await openExtensionPage(popup, 'popup.html', { update: {} });
        const connecting = await record(popup, { id: 'extension-popup-connecting', surface: 'extension', group, title: 'Popup opening: connecting',
            note: 'Before the worker\'s first (local) answer: "Connecting to uier." at the height the popup will have.' });
        await answer('tab', tab);
        await popup.waitForTimeout(400);
        const frame = await record(popup, { id: 'extension-popup-projects-loading', surface: 'extension', group, title: 'Popup: projects loading',
            note: 'After the local answer: the real heading, address, account controls and footer; outlines for the project list.' });
        await answer('state', signedIn);
        await popup.waitForTimeout(400);
        await popup.locator('main').screenshot({ path: join(capture.dir, 'extension-popup-connecting--loaded.png') });
        connecting.loaded = `${capture.viewport}/extension-popup-connecting--loaded.png`;
        frame.loaded = connecting.loaded;

        // Start review held: the pending button of every popup action
        await popup.getByRole('button', { name: /Shop/ }).first().click();
        await popup.getByRole('button', { name: 'Start review', exact: true }).click();
        await popup.waitForTimeout(400);
        await record(popup, { id: 'extension-popup-starting', surface: 'extension', group, title: 'Popup: starting a review (pending button)',
            note: 'The button shows the UI kit\'s loading state; every other control is disabled.' });

        await openExtensionPage(popup, 'popup.html', { update: {}, tab: { signedIn: false, restricted: false }, state: { signedIn: false } });
        await popup.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
        await popup.waitForTimeout(400);
        await record(popup, { id: 'extension-popup-signing-in', surface: 'extension', group, title: 'Popup: opening sign-in (pending button)' });

        // --- The verification helper window --------------------------------------------------------------------
        const helper = await (await browser.newContext({ viewport: { width: 420, height: 260 }, deviceScaleFactor: 2 })).newPage();
        await openExtensionPage(helper, 'helper.html', {});
        await record(helper, { id: 'extension-helper-starting', surface: 'extension', group, title: 'Verification window: starting',
            note: 'The helper window that opens before a comment is saved: a status line with a spinner. Then "Connected to verification." and "Checking your browser.", the same line.' });
        await helper.evaluate(() => (window as unknown as { answerExtension(type: string, value: unknown): void }).answerExtension('helper-job', { token: 'test-token' }));
        await helper.waitForTimeout(600);
        await record(helper, { id: 'extension-helper-checking', surface: 'extension', group, title: 'Verification window: checking your browser' });

        // --- Public pages that load something after their shell ------------------------------------------------
        const visitor = await (await browser.newContext({ baseURL, viewport: info.project.use.viewport })).newPage();
        const pages = 'Public pages';
        await hardLoad(capture, visitor, baseURL!, { id: 'public-status', surface: 'public', group: pages, title: 'Status: live checks loading', route: '/status',
            note: 'The page is static, the service rows included: each row says "Checking…" where its result goes, and a line of text stands in for the summary.' }, { loaded: true });
        await hardLoad(capture, visitor, baseURL!, { id: 'public-notifications', surface: 'public', group: pages, title: 'Notification preferences loading', route: '/notifications?token=example',
            note: 'A line of text under the static header.' }, { loaded: true });
        await hardLoad(capture, visitor, baseURL!, { id: 'public-extension-verification', surface: 'public', group: pages, title: 'Extension verification bridge', route: '/extension-verification',
            note: 'Framed, invisible to people: an unstyled line of text.' });
        await softNav(capture, visitor, { id: 'public-integration', surface: 'public', group: pages, title: 'Integration guide, from the index', from: '/integrations', route: '/integrations/github',
            note: 'The guides are prerendered, so this fallback shows only until the route\'s params resolve.' });
    } finally {
        capture.save();
    }
});
