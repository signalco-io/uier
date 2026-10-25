import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { pngImage } from './support/images';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { newVisitor, toolbar } from './support/toolbar';

// Local regression budgets and methodology are in docs/mvp-launch-verification.md.
// Measurements include browser event-to-next-frame timing, not Playwright round-trip time.
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.setTimeout(90_000);

async function hostClicks(page: Page) {
    const start = await page.evaluate(() => performance.getEntriesByName('host-click-to-frame').length);
    // The mobile inbox visually covers the page. Use trusted keyboard activation so this
    // measures host event processing rather than waiting for an intentionally covered pointer target.
    for (let click = 0; click < 8; click++) await page.locator('#host-probe').press('Space');
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('host-click-to-frame').length)).toBe(start + 8);
    return await page.evaluate(start => performance.getEntriesByName('host-click-to-frame').slice(start).map(entry => entry.duration), start);
}

test('inactive review and a 100-thread inbox stay within measured bundle, request and host-interaction budgets', async ({ page, browser, request }, testInfo) => {
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
        expect(inactiveRequests).toEqual([]);
        expect(bundle.raw).toBeLessThan(750_000);
        expect(bundle.gzip).toBeLessThan(220_000);

        await guest.page.goto(`${host}&toolbar-code=${projectId}`);
        await expect(toolbar(guest.page)).toBeVisible();
        await guest.page.getByRole('button', { name: /^Inbox/ }).click();
        const inbox = guest.page.getByRole('complementary', { name: 'Comments' });
        await expect(inbox.getByRole('article')).toHaveCount(100);
        await expect(inbox.getByRole('button', { name: 'Screenshot of the commented part of the page' }).first()).toBeVisible();
        await expect.poll(() => requests.filter(request => request.path.endsWith('/screenshot')).length).toBeGreaterThan(0);
        const loadedRequests = [...requests];
        const busyClicks = await hostClicks(guest.page);
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
        const metrics = { profile: testInfo.project.name, browser: browser.version(), interaction: 'host button keyboard activation', bundle, threads: 100, longTasksMs, capture,
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
