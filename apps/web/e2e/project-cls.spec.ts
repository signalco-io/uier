import { expect, test } from '@playwright/test';
import { appNavigation, closeAppNavigation, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { boardCollapseCookieNames } from '../src/lib/app/boardCollapseCookie';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

// Keep the source rectangles, including recent-input entries, so a failure explains what moved.
// CLS follows the toolbar: largest window, <1s between entries, <5s from its first entry.
type Shift = { startTime: number; value: number; hadRecentInput: boolean; toolbarOnly: boolean; sources: { node: string; previous: DOMRectReadOnly; current: DOMRectReadOnly }[] };
declare global { interface Window { projectShifts: Shift[] } }

test('project comments keep CLS below 0.1 through a remembered board load and unread changes', async ({ page, request, browser }, testInfo) => {
    test.setTimeout(90_000);
    if (testInfo.project.name.startsWith('Desktop')) await page.setViewportSize({ width: 1674, height: 1366 });
    await signIn(page, uniqueEmail('project-cls'));
    const project = await createProject(page, { urls: [site.origin()], name: 'Project layout stability' });
    await setProjectAccess(page, project, 'Anyone with the link');
    for (let author = 0; author < 2; author++) {
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        for (let item = 0; item < 10; item++) {
            const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                path: `/${project}/pricing`, text: `Layout feedback ${author * 10 + item}: clarify the annual plan.`,
                authorName: `Reviewer ${author}`, position: { type: 'page' }, kind: 'feedback'
            } });
            expect(response.status(), await response.text()).toBe(201);
        }
    }
    const doneHeaders = await verifiedReviewHeaders(request, project, site.origin());
    for (let item = 0; item < 10; item++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers: doneHeaders, data: {
            path: `/${project}/pricing`, text: `Completed layout feedback ${item}.`,
            authorName: 'Reviewer 2', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status(), await response.text()).toBe(201);
        const { id } = await response.json();
        const resolved = await request.patch(`/api/review/${project}/comments/${id}`, { headers: doneHeaders, data: { resolved: true } });
        expect(resolved.status(), await resolved.text()).toBe(200);
    }
    await page.goto(`/app/projects/${project}?view=list`);
    await hydrated(page.getByRole('button', { name: 'Board', exact: true }));
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveCount(20);
    const inProgress = page.getByRole('region', { name: 'In progress comments', exact: true });
    const done = page.getByRole('region', { name: 'Done comments', exact: true });
    const collapse = inProgress.getByRole('button', { name: 'Collapse In progress', exact: true });
    await hydrated(collapse);
    await collapse.click();
    const expand = inProgress.getByRole('button', { name: 'In progress 0', exact: true });
    await expect(expand).toBeFocused();
    // Existing browser preferences only have the localStorage choice. The first load mirrors it.
    await page.context().clearCookies({ name: boardCollapseCookieNames.local });
    await page.reload();
    await expect(expand).toBeVisible();
    await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === boardCollapseCookieNames.local)?.value)
        .toContain(`${project}:in-progress`);

    await page.addInitScript(() => {
        // Exercise classic scrollbars on desktop even on systems that normally draw them over the page.
        const scrollbar = new CSSStyleSheet();
        scrollbar.replaceSync('@media (min-width: 1024px) { main[data-slot="sidebar-inset"] > div::-webkit-scrollbar { width: 16px } }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, scrollbar];
        window.projectShifts = [];
        const inToolbar = (node: Element | undefined): boolean => {
            if (!node) return false;
            if (node.closest('#uier-toolbar, [data-uier-thread]')) return true;
            const root = node.getRootNode();
            return root instanceof ShadowRoot && inToolbar(root.host);
        };
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
                window.projectShifts.push({ startTime: shift.startTime, value: shift.value, hadRecentInput: shift.hadRecentInput,
                    toolbarOnly: shift.sources.length > 0 && shift.sources.every(source => inToolbar(source.node)),
                    sources: shift.sources.map(source => ({ node: source.node ? `${source.node.tagName}.${String(source.node.className).slice(0, 200)} ${source.node.textContent?.slice(0, 80)}` : '(removed)',
                        previous: source.previousRect.toJSON(), current: source.currentRect.toJSON() })) });
            }
        }).observe({ type: 'layout-shift', buffered: true });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // Let the streamed HTML paint before hydration, as on a cold visit with a slow bundle.
    let release!: () => void;
    const scripts = new Promise<void>(resolve => { release = resolve; });
    let paintedView = '';
    let paintedColumn: { stripWidth: number; nextColumnOffset: number } | undefined;
    const columnGeometry = async () => {
        const strip = (await inProgress.boundingBox())!;
        const next = (await done.boundingBox())!;
        return { stripWidth: strip.width, nextColumnOffset: next.x - strip.x };
    };
    await page.route('**/_next/static/**/*.js', async route => { await scripts; await route.continue(); });
    try {
        await page.goto(`/app/projects/${project}`, { waitUntil: 'commit' });
        await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
        await expect(done.getByRole('listitem')).toHaveCount(10);
        // Streamed rows can be in a hidden segment before React reveals the board.
        // Wait for the server-rendered region while external scripts are still held.
        await expect(page.getByRole('region', { name: 'Open comments', exact: true })).toBeVisible();
        paintedView = 'board';
        // More than one rendered frame is required for a before/after layout-shift entry.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        paintedColumn = await columnGeometry();
    } finally { release(); }
    await page.waitForLoadState('load');
    await page.unroute('**/_next/static/**/*.js');
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveCount(20);
    await hydrated(page.getByRole('button', { name: 'Mark all as read', exact: true }));
    await page.evaluate(() => document.fonts.ready);
    // Include the quiet period after hydration and the automatic refresh following Mark all as read.
    await page.waitForTimeout(1_100);
    const hydratedColumn = await columnGeometry();
    const board = page.locator('[data-board-scroll]');
    const beforeRead = await board.boundingBox();
    // With room the count line is in the search row, left of the search and Filter (uier #300, #403); on a phone it keeps its own row under it
    const filter = page.getByRole('button', { name: 'Filter', exact: true });
    const filterBeforeRead = (await filter.boundingBox())!;
    const markAll = (await page.getByRole('button', { name: 'Mark all as read', exact: true }).boundingBox())!;
    if (testInfo.project.name.startsWith('Desktop')) {
        expect(markAll.x + markAll.width).toBeLessThanOrEqual(filterBeforeRead.x);
        expect(Math.abs((markAll.y + markAll.height / 2) - (filterBeforeRead.y + filterBeforeRead.height / 2))).toBeLessThan(4);
    } else expect(markAll.y).toBeGreaterThan(filterBeforeRead.y + filterBeforeRead.height);
    await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
    await page.waitForTimeout(1_100);
    const afterRead = await board.boundingBox();
    const filterAfterRead = await filter.boundingBox();
    // Background arrivals happen outside the recent-input allowance and must not insert another row above the board.
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const arrived = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'A live unread arrival', authorName: 'Another reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(arrived.status()).toBe(201);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('heading')).toHaveText('Open21');
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).locator('[data-comment-window]')).toHaveAttribute('data-loaded-count', '21');
    await page.waitForTimeout(1_100);
    const afterArrival = await board.boundingBox();
    const filterAfterArrival = await filter.boundingBox();
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    const searchGroup = page.locator('[data-slot="input-group"]').filter({ has: search });
    const searchBefore = await searchGroup.boundingBox();
    const shellColumn = page.locator('main[data-slot="sidebar-inset"] > div > div > div').filter({ has: search });
    const shellBefore = await shellColumn.boundingBox();
    await search.fill('no-matching-feedback');
    await expect(page.getByText('No comments match these filters.', { exact: true })).toBeVisible();
    const searchAfter = await searchGroup.boundingBox();
    const shellAfter = await shellColumn.boundingBox();
    await appNavigation(page);
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Send feedback', exact: true })).toBeVisible();
    await page.waitForTimeout(1_100);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Send feedback', exact: true })).toBeHidden();
    await closeAppNavigation(page);
    const afterToolbar = await searchGroup.boundingBox();
    await page.waitForTimeout(1_100);
    const shifts = await page.evaluate(() => window.projectShifts);
    let cls = 0, windowValue = 0, first = 0, last = 0;
    for (const shift of shifts.filter(shift => !shift.hadRecentInput && !shift.toolbarOnly)) {
        if (shift.startTime - last < 1_000 && shift.startTime - first < 5_000) windowValue += shift.value;
        else { first = shift.startTime; windowValue = shift.value; }
        last = shift.startTime;
        cls = Math.max(cls, windowValue);
    }
    const report = { browser: testInfo.project.name, version: browser.version(), viewport: page.viewportSize(), cpuSlowdown: 4, cls, paintedView, paintedColumn, hydratedColumn,
        boardTop: { beforeRead: beforeRead?.y, afterRead: afterRead?.y, afterArrival: afterArrival?.y },
        search: { before: searchBefore, empty: searchAfter, afterToolbar }, shell: { before: shellBefore, empty: shellAfter }, shifts };
    await testInfo.attach('project-cls.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.info('Project CLS', JSON.stringify(report));
    expect(cls).toBeLessThan(0.1);
    expect(paintedView).toBe('board');
    expect(paintedColumn).toEqual(hydratedColumn);
    expect(hydratedColumn).toEqual({ stripWidth: 48, nextColumnOffset: 64 });
    expect(afterRead?.y).toBe(beforeRead?.y);
    expect(afterArrival?.y).toBe(beforeRead?.y);
    expect(filterAfterRead).toEqual(filterBeforeRead);
    expect(filterAfterArrival).toEqual(filterBeforeRead);
    expect(shellAfter?.x).toBe(shellBefore?.x);
    expect(searchAfter).toEqual(searchBefore);
    expect(afterToolbar).toEqual(searchAfter);
});
