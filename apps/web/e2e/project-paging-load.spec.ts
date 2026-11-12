import { expect, test } from '@playwright/test';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

test('a 2,000-thread project bounds initial HTML and mounted rows in Board and List', async ({ page, request, baseURL, browser }, testInfo) => {
    test.setTimeout(180_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('project-paging-load'));
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        for (let group = 0; group < 200; group++) {
            const headers = await verifiedReviewHeaders(request, project, site.origin());
            for (let index = 0; index < 10; index++) {
                const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                    path: `/${project}/page-${group % 20}`, text: `Seeded thread ${group * 10 + index}. ${'Representative feedback context. '.repeat(15)}`,
                    authorName: `Reviewer ${group}`, position: { type: 'page' }, kind: 'feedback'
                } });
                expect(response.status(), await response.text()).toBe(201);
            }
        }
        const measurements = [];
        for (const view of ['board', 'list']) {
            const start = performance.now();
            await page.goto(`/app/projects/${project}?view=${view}`);
            await hydrated(page.getByRole('button', { name: view === 'board' ? 'Board' : 'List', exact: true }));
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            const metrics = await page.evaluate(() => ({ mountedRows: document.querySelectorAll('[data-comment-row]').length,
                viewport: { width: window.innerWidth, height: window.innerHeight, visual: window.visualViewport?.height, scrollWidth: document.documentElement.scrollWidth },
                windows: [...document.querySelectorAll<HTMLElement>('[data-comment-window]')].map(element => ({ loaded: element.dataset.loadedCount, mounted: element.querySelectorAll('[data-comment-row]').length,
                    width: element.clientWidth, height: element.clientHeight, top: element.getBoundingClientRect().top, overflow: getComputedStyle(element).overflowY })),
                domElements: document.querySelectorAll('*').length, htmlBytes: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).decodedBodySize,
                encodedBytes: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).encodedBodySize, fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime }));
            measurements.push({ view, ...metrics, untilHydratedMs: Math.round(performance.now() - start) });
            // Baseline mode runs this same fixture against the parent build, preserving its list cap for comparison.
            if (process.env.UIER_PAGING_BASELINE !== '1') {
                expect(metrics.mountedRows).toBeLessThan(25);
                expect(metrics.windows[0]?.loaded).toBe('25');
                expect(metrics.viewport.scrollWidth).toBeLessThanOrEqual((page.viewportSize()?.width ?? metrics.viewport.width) + 1);
                expect(metrics.htmlBytes).toBeLessThan(1_000_000);
                if (view === 'board') await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('heading')).toHaveText('Open2000');
                else await expect(page.getByRole('button', { name: 'Active 2000', exact: true })).toBeVisible();
            }
        }
        const report = { browser: testInfo.project.name, version: browser.version(), seededThreads: 2000, messagesPerThread: 1,
            baseline: process.env.UIER_PAGING_BASELINE === '1', measurements };
        console.info('PAGING_BROWSER_LOAD', JSON.stringify(report));
        await testInfo.attach('project-paging-load.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    } finally { await site.close(); }
});
