import { createServer } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { expect, test } from '@playwright/test';
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
    reviewedSite = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
