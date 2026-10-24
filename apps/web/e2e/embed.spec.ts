import { createServer } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { toolbar } from './support/toolbar';

// A reviewed site embeds the toolbar from uier.io on its own origin:
//     <script src="https://uier.io/toolbar.js" defer></script>
// Here the reviewed site is a small server on `reviewed.localhost` (another site than this app on
// 127.0.0.1) that embeds this app's /toolbar.js. It has to be a real server on a loopback address:
// Chromium does not let a page from a public address (or one fulfilled by `page.route`) load
// scripts from loopback.

let reviewedSite: Server;
let reviewedSiteOrigin: string;

test.beforeAll(async ({ baseURL }) => {
    const toolbarUrl = new URL('/toolbar.js', baseURL).href;
    reviewedSite = createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (request.url?.startsWith('/styled')) {
            // A page with styles of its own and no toolbar script yet (the test adds it)
            response.end(`<!doctype html>
<html lang="en">
<head>
    <title>Reviewed site</title>
    <style>
        body { margin: 24px; font: 17px/1.6 Georgia, serif; color: #333; background: #fafaf5; }
        h1 { font-size: 40px; letter-spacing: -0.02em; }
        a { color: #8a2be2; text-decoration: underline dotted; }
        button { font: inherit; padding: 4px 12px; border-radius: 3px; }
    </style>
</head>
<body>
    <main><h1>Pricing</h1><p>A page on a site under review. <a href="/plans">Plans</a></p><button type="button">Buy</button></main>
</body>
</html>`);
            return;
        }
        response.end(`<!doctype html>
<html lang="en">
<head>
    <title>Reviewed site</title>
    <script src="${toolbarUrl}" defer></script>
</head>
<body>
    <main><h1>Pricing</h1><p>A page on a site under review.</p></main>
</body>
</html>`);
    });
    // All interfaces (IPv4 and IPv6), whichever loopback address `reviewed.localhost` resolves to
    await new Promise<void>(resolve => reviewedSite.listen(0, resolve));
    reviewedSiteOrigin = `http://reviewed.localhost:${(reviewedSite.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
    await new Promise(resolve => reviewedSite.close(resolve));
});

test('the toolbar starts on a reviewed site on another origin', async ({ page, baseURL }) => {
    const toolbarUrl = new URL('/toolbar.js', baseURL).href;
    const apiOrigin = new URL(toolbarUrl).origin;

    // Review mode (no data-uier-mode): nothing is mounted without ?review=true
    let toolbarLoaded = page.waitForResponse(toolbarUrl);
    await page.goto(`${reviewedSiteOrigin}/pricing`);
    expect((await toolbarLoaded).status()).toBe(200);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    // With ?review=true it mounts and asks the comments API on the script's origin (uier.io), not
    // the reviewed site, for the comments of the page
    const commentsRequest = page.waitForRequest(request => request.url().startsWith(`${apiOrigin}/api/comments?`));
    toolbarLoaded = page.waitForResponse(toolbarUrl);
    await page.goto(`${reviewedSiteOrigin}/pricing?review=true`);
    expect((await toolbarLoaded).status()).toBe(200);
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    expect(new URL((await commentsRequest).url()).searchParams.get('path')).toBe('/pricing');
});

/** Computed styles of the reviewed page's elements */
async function pageStyles(page: Page) {
    return await page.evaluate(() => ['html', 'body', 'main', 'h1', 'p', 'a', 'button'].map(selector => {
        const element = document.querySelector(selector);
        if (!element) {
            return null;
        }
        const style = getComputedStyle(element);
        return [...style].map(property => `${property}: ${style.getPropertyValue(property)}`);
    }));
}

test('the toolbar mounts in its shadow root and leaves the reviewed site\'s styles alone', async ({ page, baseURL }) => {
    await page.goto(`${reviewedSiteOrigin}/styled?review=true`);
    const before = await pageStyles(page);
    const sheetsBefore = await page.evaluate(() => [...document.styleSheets].map(sheet => sheet.href));

    // No CSP on the reviewed site, so the script can be added directly
    await page.addScriptTag({ url: new URL('/toolbar.js', baseURL).href });
    await expect(toolbar(page)).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible();

    expect(await pageStyles(page)).toEqual(before);
    const mounted = await page.evaluate(() => {
        const host = document.getElementById('uier-toolbar');
        return {
            styleSheets: [...document.styleSheets].map(sheet => sheet.href),
            adoptedStyleSheets: document.adoptedStyleSheets.length,
            // Everything is in the shadow root: no children in the page, the CSS is inside
            hostChildren: host?.children.length,
            shadowStyles: host?.shadowRoot?.querySelectorAll('style').length,
            // Popovers render into the shadow root as well
            dialogsInPage: document.querySelectorAll('[role="dialog"]').length,
            dialogsInShadowRoot: host?.shadowRoot?.querySelectorAll('[role="dialog"]').length
        };
    });
    // The only thing added to the page is the Geist font stylesheet (`@font-face` only, src/index.tsx)
    const addedSheets = mounted.styleSheets.filter(href => !sheetsBefore.includes(href));
    expect(addedSheets.every(href => href?.startsWith('https://fonts.googleapis.com/'))).toBe(true);
    expect(mounted).toMatchObject({
        adoptedStyleSheets: 0,
        hostChildren: 0,
        shadowStyles: 1,
        dialogsInPage: 0,
        dialogsInShadowRoot: 1
    });
});
