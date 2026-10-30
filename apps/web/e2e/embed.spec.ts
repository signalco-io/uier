import { createServer } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { toolbar } from './support/toolbar';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { commentBubble, newVisitor, openThread } from './support/toolbar';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { expectNoAxeViolations } from './accessibility';
import { embedScript } from '../src/lib/app/integration';
import toolbarBundle from '@uier/toolbar/bundle' with { type: 'json' };
import { createHash } from 'node:crypto';

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
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
        const params = new URL(request.url ?? '/', 'http://reviewed.localhost').searchParams;
        const project = params.get('project');
        const projectAttribute = project && /^[a-z0-9]{12}$/.test(project) ? ` data-uier-project="${project}"` : '';
        response.end(`<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reviewed site</title>
    ${params.has('pinned') && project ? embedScript(new URL(toolbarUrl).origin, project, 'pinned')
        : `<script src="${toolbarUrl}"${projectAttribute} defer></script>`}
</head>
<body>
    <main><h1>Pricing</h1><p>A page on a site under review.</p></main>
    ${params.has('clobber') ? '<div id="uier-toolbar">Page content</div><form id="uierConfig"><input name="apiUrl"><input name="mode"><input name="project"></form>' : ''}
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
    const publicApiRequests: string[] = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === apiOrigin && /^\/api\/(comments|visitor)(\/|$)/.test(url.pathname)) publicApiRequests.push(url.pathname);
    });

    // Review mode (no data-uier-mode): nothing is mounted without ?review=true
    let toolbarLoaded = page.waitForResponse(toolbarUrl);
    await page.goto(`${reviewedSiteOrigin}/pricing`);
    expect((await toolbarLoaded).status()).toBe(200);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    // Missing script configuration is known before mounting any data hooks, with or without a
    // public code in the review link. The link's code selects the guide, not a comments project.
    await page.setViewportSize({ width: 375, height: 740 });
    for (const code of [undefined, 'abcd1234efgh']) {
        toolbarLoaded = page.waitForResponse(toolbarUrl);
        await page.goto(`${reviewedSiteOrigin}/pricing?${code ? `toolbar-code=${code}` : 'review=true'}`);
        expect((await toolbarLoaded).status()).toBe(200);
        await expect(toolbar(page)).toContainText('Set up uier on this site to start a review.');
        await expect(toolbar(page)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
        const guide = page.getByRole('link', { name: 'Open install guide', exact: true });
        await expect(guide).toHaveAttribute('href', `${apiOrigin}/app/projects${code ? `/${code}/install` : ''}`);
        await expect(guide).toHaveAttribute('target', '_blank');
        await expect(guide).toHaveAttribute('rel', /noopener/);
        await expect(page.getByRole('button', { name: 'Add comment' })).toHaveCount(0);
        await expect(page.getByText('Comments could not be loaded.')).toHaveCount(0);
        const box = (await guide.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(375);
        if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) expect(box.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press('Tab');
        await expect(guide).toBeFocused();
        const opened = page.waitForEvent('popup');
        await guide.press('Enter');
        const install = await opened;
        await install.waitForLoadState();
        expect(new URL(install.url()).pathname).toBe('/app/sign-in');
        expect(new URL(install.url()).searchParams.get('next')).toBe(`/app/projects${code ? `/${code}/install` : ''}`);
        expect(await install.evaluate(() => window.opener === null)).toBe(true);
        await install.close();
        await expectNoAxeViolations(page);
        expect(publicApiRequests).toEqual([]);
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Exit review' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#uier-toolbar')).toHaveCount(0);
    }
});

test('a reviewed project lists, posts and replies without third-party cookies', async ({ page, browser, request }, testInfo) => {
    await signIn(page, uniqueEmail('embed'));
    const projectId = await createProject(page, { urls: [reviewedSiteOrigin], name: 'Embedded review' });
    await setProjectAccess(page, projectId, 'Anyone with the link');

    const guest = await newVisitor(browser, testInfo);
    await guest.page.goto(`${reviewedSiteOrigin}/pricing?project=${projectId}&review=true`);
    await expect(guest.page.getByRole('link', { name: 'Open install guide' })).toHaveCount(0);
    // Third-party sites keep toolbar/inbox controls interactive and outside point targeting.
    await toolbar(guest.page).getByRole('button', { name: 'Add comment' }).click();
    const profile = (await toolbar(guest.page).getByRole('button', { name: 'Profile' }).boundingBox())!;
    await guest.page.mouse.move(profile.x + profile.width / 2, profile.y + profile.height / 2);
    await expect(guest.page.locator('[data-uier-outline]')).toHaveCount(0);
    await toolbar(guest.page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = guest.page.getByRole('complementary', { name: 'Comments' });
    await inbox.getByRole('searchbox', { name: 'Search comments' }).fill('Still interactive');
    await expect(guest.page.locator('[data-uier-outline]')).toHaveCount(0);
    await expect(guest.page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveCount(0);
    await inbox.getByRole('searchbox', { name: 'Search comments' }).fill('');
    await toolbar(guest.page).getByRole('button', { name: 'Add comment' }).click();
    await inbox.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(inbox).toHaveCount(0);
    await guest.page.getByRole('button', { name: 'Add comment' }).click();
    const heading = await guest.page.getByRole('heading', { name: 'Pricing', exact: true }).boundingBox();
    await guest.page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    await guest.page.getByRole('textbox', { name: 'Your name' }).fill('Ana');
    const write = guest.page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith(`/api/review/${projectId}/comments`));
    await guest.page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Show the yearly price.');
    await guest.page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(commentBubble(guest.page, 1)).toBeVisible();
    const sent = await write;
    expect(await sent.headerValue('origin')).toBe(reviewedSiteOrigin);
    expect(await sent.headerValue('cookie')).toBeNull();
    expect(await sent.headerValue('x-uier-verification')).toBeTruthy();

    const reply = openThread(guest.page).getByRole('textbox', { name: 'Reply' });
    await reply.fill('Include tax too.');
    await reply.press('Enter');
    await expect(commentBubble(guest.page, 2)).toBeVisible();
    await guest.page.reload();
    await expect(commentBubble(guest.page, 2)).toBeVisible();
    await commentBubble(guest.page, 2).click();
    await expect(openThread(guest.page).getByText('Show the yearly price.')).toBeVisible();
    await expect(openThread(guest.page).getByText('Include tax too.')).toBeVisible();
    await expect(openThread(guest.page).getByText('You', { exact: true }).first()).toBeVisible();
    expect(await guest.context.cookies()).toEqual([]);
    await guest.context.close();

    // The saved origin is the reviewed site; the API host never becomes the comment's site.
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByRole('article', { name: 'Comment by Ana' })).toContainText(`${new URL(reviewedSiteOrigin).host}/pricing`);

    const headers = await verifiedReviewHeaders(request, projectId, reviewedSiteOrigin);
    const data = { path: '/pricing', position: { type: 'page' }, kind: 'feedback', text: 'A direct request', authorName: 'Ana' };
    const post = (requestHeaders: Record<string, string>) => request.post(`/api/review/${projectId}/comments`, { headers: requestHeaders, data });
    const { 'X-Uier-Verification': proof, ...withoutProof } = headers;
    expect((await post(withoutProof)).status()).toBe(403);
    expect((await post({ ...headers, 'X-Uier-Verification': `${proof}tampered` })).status()).toBe(403);
    expect((await post({ ...headers, 'X-Uier-Visitor': 'a'.repeat(43) })).status()).toBe(403);
    const foreign = await post({ ...headers, Origin: 'https://elsewhere.example' });
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()['access-control-allow-origin']).toBeUndefined();
    // Proofs cannot be minted from cross-site fetches, even for an allowed origin.
    const crossSiteProof = await request.post(`/api/review/${projectId}/verification`, { headers, data: { origin: reviewedSiteOrigin } });
    expect(crossSiteProof.status()).toBe(403);
});

test('the pinned integrity-checked embed posts feedback despite named page elements and duplicate scripts', async ({ page, request, baseURL }) => {
    const pinned = await request.get(toolbarBundle.path);
    expect(pinned.status()).toBe(200);
    expect(pinned.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(pinned.headers()['access-control-allow-origin']).toBe('*');
    const bytes = await pinned.body();
    expect(`sha384-${createHash('sha384').update(bytes).digest('base64')}`).toBe(toolbarBundle.integrity);
    expect(toolbarBundle.path).toBe(`/toolbar/${createHash('sha256').update(bytes).digest('hex')}.js`);
    expect((await (await request.get('/toolbar.js')).body()).equals(bytes)).toBe(true);
    expect((await request.get('/toolbar.js')).headers()['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    const manifest = await request.get('/toolbar/manifest.json');
    expect(manifest.headers()['cache-control']).toBe('no-store');
    expect((await manifest.json()).current).toEqual(toolbarBundle);
    await signIn(page, uniqueEmail('pinned'));
    const projectId = await createProject(page, { urls: [reviewedSiteOrigin] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${reviewedSiteOrigin}/pricing?project=${projectId}&review=true&pinned=1&clobber=1`);
    await expect(toolbar(page)).toBeVisible();
    await page.addScriptTag({ url: new URL(toolbarBundle.path, baseURL).href });
    await expect(toolbar(page)).toHaveCount(1);
    await expect(page.locator('div#uier-toolbar').filter({ hasText: 'Page content' })).toBeVisible();
    await toolbar(page).getByRole('button', { name: 'Add comment' }).click();
    const heading = (await page.getByRole('heading', { name: 'Pricing', exact: true }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Posted with the pinned bundle.');
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(openThread(page).getByText('Posted with the pinned bundle.', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test('configuration ignores non-string fields, accessors and non-plain objects without throwing', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Each case runs before the real embed is evaluated. A bad override must fall back to the
    // script origin and default review mode, yielding the missing-project setup notice.
    for (const kind of ['fields', 'array', 'element', 'getter', 'proxy', 'window-getter', 'null-prototype']) {
        await page.goto(`${reviewedSiteOrigin}/styled?review=true`);
        await page.evaluate(kind => {
            const value = kind === 'fields' ? { apiUrl: document.body, project: 42, mode: true }
                : kind === 'array' ? [] : kind === 'element' ? document.body
                : kind === 'proxy' ? new Proxy({}, { getPrototypeOf() { throw new Error('Untrusted proxy'); } })
                : kind === 'null-prototype' ? Object.assign(Object.create(null), { mode: 'review', apiUrl: 42 })
                : Object.defineProperty({}, 'apiUrl', { get() { throw new Error('Untrusted getter'); } });
            Object.defineProperty(window, 'uierConfig', kind === 'window-getter'
                ? { configurable: true, get() { throw new Error('Untrusted window getter'); } }
                : { configurable: true, value });
        }, kind);
        await page.addScriptTag({ url: new URL('/toolbar.js', baseURL).href });
        await expect(page.getByRole('link', { name: 'Open install guide' })).toHaveAttribute('href', `${new URL(baseURL!).origin}/app/projects`);
    }
    expect(errors).toEqual([]);
});

test('a failed project comments load is visible and can be retried', async ({ page }) => {
    await signIn(page, uniqueEmail('embed-error'));
    const projectId = await createProject(page, { urls: [reviewedSiteOrigin] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const endpoint = `**/api/review/${projectId}/comments?*`;
    await page.route(endpoint, route => route.abort());
    await page.goto(`${reviewedSiteOrigin}/pricing?project=${projectId}&review=true`);
    await expect(page.getByText('Comments could not be loaded.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Open install guide' })).toHaveCount(0);
    await page.unroute(endpoint);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Comments could not be loaded.')).toBeHidden();
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
    await signIn(page, uniqueEmail('embed-styles'));
    const projectId = await createProject(page, { urls: [reviewedSiteOrigin] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    await page.goto(`${reviewedSiteOrigin}/styled?review=true`);
    const before = await pageStyles(page);
    const sheetsBefore = await page.evaluate(() => [...document.styleSheets].map(sheet => sheet.href));

    // A configured embed via window.uierConfig follows the same review path as a script attribute.
    await page.evaluate(project => { window.uierConfig = { project }; }, projectId);
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
            shadowStyles: host?.shadowRoot?.adoptedStyleSheets.length,
            // Popovers render into the shadow root as well
            dialogsInPage: document.querySelectorAll('[role="dialog"]').length,
            dialogsInShadowRoot: host?.shadowRoot?.querySelectorAll('[role="dialog"]').length
        };
    });
    // The only thing added to the page is the Geist font stylesheet (`@font-face` only, src/index.tsx)
    const addedSheets = mounted.styleSheets.filter(href => !sheetsBefore.includes(href));
    expect(addedSheets.every(href => href?.endsWith('/toolbar-fonts/geist.css'))).toBe(true);
    expect(mounted).toMatchObject({
        adoptedStyleSheets: 0,
        hostChildren: 0,
        shadowStyles: 1,
        dialogsInPage: 0,
        dialogsInShadowRoot: 1
    });
});
