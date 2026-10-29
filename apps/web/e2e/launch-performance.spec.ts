import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { pngImage } from './support/images';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { chooseInboxPages, dismissFirstRunHint, newVisitor, toolbar } from './support/toolbar';

// Local regression budgets and methodology are in docs/mvp-launch-verification.md.
// Measurements include browser event-to-next-frame timing, not Playwright round-trip time.
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.setTimeout(90_000);

test('many missing and ambiguous text anchors share an index and never search again on scroll or resize', async ({ page, browser, request }, testInfo) => {
    await signIn(page, uniqueEmail('text-budget'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, projectId, site.origin());
    const response = await request.post(`/api/review/${projectId}/comments`, { headers, data: {
        path: `/${projectId}/pricing`, text: 'Missing text fixture', authorName: 'Reviewer',
        position: { type: 'text', text: 'AbsentAnchor0', startSelector: 'main>p', startType: 'text', startOffset: 0, endType: 'text', endOffset: 2 }
    } });
    expect(response.status()).toBe(201);
    const saved = await response.json();
    const comments = Array.from({ length: 40 }, (_, i) => ({ ...saved, id: `${saved.id}_${i}`, number: i + 1,
        position: { ...saved.position, text: i < 30 ? `AbsentAnchor${i}` : 'every plan includes the toolbar' } }));
    const guest = await newVisitor(browser, testInfo);
    await guest.page.route(`**/api/review/${projectId}/comments?*`, route => route.fulfill({ json: comments }));
    await guest.page.addInitScript(() => {
        const walker = Document.prototype.createTreeWalker;
        Document.prototype.createTreeWalker = function (root, what, filter) {
            if (root === document.body && what === NodeFilter.SHOW_TEXT) performance.mark('page-text-index');
            return walker.call(this, root, what, filter);
        };
        const indexOf = String.prototype.indexOf;
        String.prototype.indexOf = function (needle, offset) {
            if (typeof needle === 'string' && (needle.startsWith('AbsentAnchor') || needle === 'everyplanincludesthetoolbar')) performance.mark('anchor-text-search');
            return indexOf.call(this, needle, offset);
        };
    });
    try {
        await guest.page.goto(`${site.origin()}/${projectId}/pricing?review=true&layout=html-scroll`);
        await dismissFirstRunHint(guest.page);
        await toolbar(guest.page).getByRole('button', { name: /^Inbox/ }).click();
        const inbox = guest.page.getByRole('complementary', { name: 'Comments' });
        await expect(inbox.getByRole('article')).toHaveCount(40);
        await expect(inbox.getByText('Several targets match. Choose the intended target to reattach.').first()).toBeVisible();
        await inbox.getByRole('button', { name: 'Close sidebar' }).click();
        const measure = () => guest.page.evaluate(() => ({ indexes: performance.getEntriesByName('page-text-index').length,
            searches: performance.getEntriesByName('anchor-text-search').length }));
        const before = await measure();
        expect(before.indexes).toBeGreaterThan(0);
        expect(before.searches).toBeGreaterThanOrEqual(40);
        for (let i = 0; i < 8; i++) {
            await guest.page.evaluate(async () => { window.scrollBy(0, 60); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
        }
        const viewport = guest.page.viewportSize()!;
        await guest.page.setViewportSize({ width: viewport.width - 40, height: viewport.height - 40 });
        await guest.page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
        expect(await measure()).toEqual(before);
        // One host DOM change invalidates all evidence, with only one shared page walk.
        await guest.page.evaluate(() => {
            const p = document.createElement('p'); p.textContent = 'AbsentAnchor0'; document.querySelector('main')!.appendChild(p);
        });
        await expect(guest.page.locator('[data-uier-highlight]')).not.toHaveCount(0);
        expect((await measure()).indexes).toBe(before.indexes + 1);
    } finally { await guest.context.close(); }
});

async function hostClicks(page: Page) {
    const start = await page.evaluate(() => performance.getEntriesByName('host-click-to-frame').length);
    // The mobile inbox visually covers the page. Use trusted keyboard activation so this
    // measures host event processing rather than waiting for an intentionally covered pointer target.
    for (let click = 0; click < 8; click++) await page.locator('#host-probe').press('Space');
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('host-click-to-frame').length)).toBe(start + 8);
    return await page.evaluate(start => performance.getEntriesByName('host-click-to-frame').slice(start).map(entry => entry.duration), start);
}

test('inactive review and a 100-thread inbox stay within measured bundle, request and host-interaction budgets', async ({ page, browser, request, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('launch-budget'));
    const projectId = await createProject(page, { urls: [site.origin()], name: 'Launch budgets' });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    // Real API writes through ten independent identities, within the ten/hour author limit.
    for (let person = 0; person < 10; person++) {
        const headers = await verifiedReviewHeaders(request, projectId, site.origin());
        for (let item = 0; item < 10; item++) {
            const index = person * 10 + item;
            const saved = await request.post(`/api/review/${projectId}/comments`, { headers, data: {
                path: `/${projectId}/${index < 80 ? 'pricing' : 'about'}`,
                position: { type: 'point', selector: 'main>h1', xNormal: (index % 10) / 10, yNormal: 0.5 },
                text: `Busy review ${index}: clarify the annual plan.`, authorName: `Reviewer ${person}`,
                ...(index % 4 === 3 ? { screenshot: pngImage } : {})
            } });
            expect(saved.status(), await saved.text()).toBe(201);
        }
    }

    const guest = await newVisitor(browser, testInfo);
    const requests: { path: string; method: string }[] = [];
    const completedRequests: Promise<unknown>[] = [];
    guest.page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/review/') || url.hostname.startsWith('fonts.'))
            requests.push({ path: `${url.hostname}${url.pathname}${url.search}`, method: request.method() });
    });
    guest.page.on('requestfinished', request => {
        const url = new URL(request.url());
        if (url.pathname === '/toolbar.js' || url.pathname.startsWith('/api/review/') || url.hostname.startsWith('fonts.'))
            completedRequests.push(request.sizes().then(sizes => ({ path: `${url.hostname}${url.pathname}${url.search}`,
                method: request.method(), sizes, timing: request.timing() })));
    });
    await guest.page.addInitScript(() => {
        const toDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
            const result = toDataURL.call(this, type, quality);
            // Observe the real final encoder without replacing capture or its returned bytes.
            if (type === 'image/webp' || type === 'image/jpeg') performance.mark('capture-encoded');
            return result;
        };
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries())
                    performance.measure('observed-long-task', { start: entry.startTime, duration: entry.duration });
            }).observe({ type: 'longtask', buffered: true });
        }
    });
    try {
        const source = await readFile(new URL('../../../packages/toolbar/dist/index.js', import.meta.url));
        const bundle = { raw: source.length, gzip: gzipSync(source).length, brotli: brotliCompressSync(source).length };
        const host = `${site.origin()}/${projectId}/pricing?host-probe=1`;
        await guest.page.goto(host);
        await expect(toolbar(guest.page)).toHaveCount(0);
        const inactiveClicks = await hostClicks(guest.page);
        // A fixed observation window, not a claim about an entire idle session.
        await guest.page.waitForTimeout(1200);
        const inactiveRequests = [...requests];
        // The only inactive API work is the single, bounded background account check.
        expect(inactiveRequests).toEqual([{ path: `${new URL(baseURL!).hostname}/api/review/${projectId}/sso`, method: 'POST' }]);
        expect(bundle.raw).toBeLessThan(750_000);
        expect(bundle.gzip).toBeLessThan(220_000);

        await guest.page.goto(`${host}&toolbar-code=${projectId}`);
        await expect(toolbar(guest.page)).toBeVisible();
        await guest.page.getByRole('button', { name: /^Inbox/ }).click();
        const inbox = guest.page.getByRole('complementary', { name: 'Comments' });
        // This page has 80 of them; all pages list the 100
        await expect(inbox.getByRole('article')).toHaveCount(80);
        await chooseInboxPages(guest.page, /^All pages/);
        await expect(inbox.getByRole('article')).toHaveCount(100);
        // Filters can fill a short mobile viewport. Scroll saved evidence into view before
        // checking its lazy image; offscreen images must stay unloaded.
        await inbox.getByRole('article').first().scrollIntoViewIfNeeded();
        await expect(inbox.getByRole('button', { name: 'Screenshot of the commented part of the page' }).first()).toBeVisible();
        await expect.poll(() => requests.filter(request => request.path.endsWith('/screenshot')).length).toBeGreaterThan(0);
        const loadedRequests = [...requests];
        const busyClicks = await hostClicks(guest.page);
        const bulkRequests: number[] = [];
        guest.page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${projectId}/comments/read`)
                bulkRequests.push(request.postDataJSON().threads.length);
        });
        await inbox.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(guest.page.getByRole('button', { name: /^Inbox/ })).toHaveAccessibleName('Inbox');
        expect(bulkRequests).toEqual([100]);
        // Keep a host click stream active while capture draws a 100-thread page without its review layer.
        await inbox.getByRole('button', { name: 'Close sidebar' }).click();
        await expect(inbox).toBeHidden();
        await guest.page.evaluate(() => performance.mark('capture-requested'));
        await guest.page.getByRole('button', { name: 'Send feedback', exact: true }).click();
        const captureClicks = await hostClicks(guest.page);
        await guest.page.waitForFunction(() => performance.getEntriesByName('capture-encoded').length > 0, undefined, { timeout: 15_000 });
        const capture = await guest.page.evaluate(() => {
            const requestedAt = performance.getEntriesByName('capture-requested')[0]!.startTime;
            const encodedAt = performance.getEntriesByName('capture-encoded')[0]!.startTime;
            return { requestedAt, encodedAt, elapsedMs: encodedAt - requestedAt,
                overlappingHostEvents: performance.getEntriesByName('host-click-to-frame')
                    .filter(entry => entry.startTime >= requestedAt && entry.startTime <= encodedAt).length };
        });
        await guest.page.keyboard.press('Escape');
        // Use the keyboard movement alternative while the host remains interactive.
        const handle = guest.page.getByRole('button', { name: 'Move toolbar', exact: true });
        for (let step = 0; step < 8; step++) await handle.press('ArrowUp');
        const movementClicks = await hostClicks(guest.page);
        const beforeIdle = requests.length;
        await guest.page.waitForTimeout(1200);
        const additionalIdleRequests = requests.length - beforeIdle;
        const screenshotRequests = loadedRequests.filter(request => request.path.endsWith('/screenshot')).length;
        const commentReads = loadedRequests.filter(request => request.method === 'GET' && request.path.includes('/comments?')).length;
        const longTasksMs = await guest.page.evaluate(() => performance.getEntriesByName('observed-long-task').map(entry => entry.duration));
        const metrics = { profile: testInfo.project.name, browser: browser.version(), interaction: 'host button keyboard activation', bundle, threads: 100, bulkRequests, longTasksMs, capture,
            observationMs: 1200, inactiveRequests, loadedRequests, screenshotRequests, commentReads, additionalIdleRequests,
            completedRequests: await Promise.all(completedRequests),
            clickToFrameMs: { inactive: inactiveClicks, busy: busyClicks, capture: captureClicks, movement: movementClicks } };
        const metricsPath = testInfo.outputPath('launch-performance.json');
        await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
        await testInfo.attach('launch-performance.json', { path: metricsPath, contentType: 'application/json' });
        console.info('Launch performance', JSON.stringify({ profile: metrics.profile, browser: metrics.browser, bundle,
            commentReads, screenshotRequests, additionalIdleRequests, capture, longestTaskMs: Math.max(0, ...longTasksMs),
            maximumClickToFrameMs: Object.fromEntries(Object.entries(metrics.clickToFrameMs).map(([phase, samples]) => [phase, Math.max(...samples)])) }));
        // Deliberately loose CI guards for severe regressions; local baselines are recorded separately.
        expect(commentReads).toBeLessThanOrEqual(4);
        expect(screenshotRequests).toBeLessThan(25); // The remaining images must stay lazy.
        expect(additionalIdleRequests).toBeLessThanOrEqual(2);
        for (const samples of [inactiveClicks, busyClicks, captureClicks, movementClicks])
            expect(Math.max(...samples)).toBeLessThan(250);
        expect(Math.max(0, ...longTasksMs)).toBeLessThan(250);
    } finally { await guest.context.close(); }
});
