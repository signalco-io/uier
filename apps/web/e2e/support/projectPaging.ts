import { expect, test, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './app';
import { verifiedReviewHeaders } from './reviewVerification';

/** Shared desktop, phone and tablet acceptance for paged project columns and the inbox. */
export async function projectPagingJourney(page: Page, request: APIRequestContext, testInfo: TestInfo, reviewedOrigin: string) {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('project-paging'));
    const project = await createProject(page, { urls: [reviewedOrigin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    let oldest: { id: string; number: number } | undefined;
    for (let group = 0; group < 6; group++) {
        const headers = await verifiedReviewHeaders(request, project, reviewedOrigin);
        for (let index = 0; index < 10; index++) {
            const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                path: `/${project}/page-${group}`, text: `${group === 0 && index === 0 ? 'Oldest-needle feedback' : `Paged feedback ${group * 10 + index}` }. ${'A discussion to load only when opened. '.repeat(15)}`,
                authorName: `Paging reviewer ${group}`, position: { type: 'page' }, kind: 'feedback'
            } });
            expect(response.status(), await response.text()).toBe(201);
            oldest ??= await response.json();
        }
    }
    const pages: { lane?: string; rows: number; bytes: number }[] = [];
    const replayRequests: { lane?: string; cursor?: string; depths?: Record<string, number> }[] = [];
    const details: string[] = [];
    page.on('request', req => {
        if (new RegExp(`/api/projects/${project}/comments/comment_[^/]+$`).test(new URL(req.url()).pathname)) details.push(req.url());
        if (new URL(req.url()).pathname === `/api/projects/${project}/comments/pages`) replayRequests.push(req.postDataJSON());
    });
    page.on('response', async response => {
        if (new URL(response.url()).pathname !== `/api/projects/${project}/comments/pages` || !response.ok()) return;
        const body = await response.body(), data = JSON.parse(body.toString()) as { comments: unknown[] };
        pages.push({ lane: (response.request().postDataJSON() as { lane?: string })?.lane, rows: data.comments.length, bytes: body.length });
    });
    await page.goto(`/app/projects/${project}?view=board`);
    await hydrated(page.getByRole('button', { name: 'Board', exact: true }));
    const column = page.getByRole('region', { name: 'Open comments', exact: true });
    await expect(column.getByRole('heading')).toHaveText('Open60');
    const window = column.locator('[data-comment-window]');
    await expect(window).toBeVisible();
    expect(await column.locator('[data-board-card]').count()).toBeLessThan(25);
    expect(details).toEqual([]);
    await column.getByRole('link').first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByText('25 selected', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column.locator('[data-board-card]').first()).toHaveAttribute('aria-setsize', '60');
    await expect(column.locator('[data-board-card]').first()).toHaveAttribute('aria-posinset', '1');
    // Reading the entire first window must leave the tab's unread dot for off-page activity.
    await page.getByRole('button', { name: 'Mark shown as read', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: '35 unread, show only unread' }).filter({ visible: true })).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All 60', exact: true }).locator('[data-tab-unread]')).toBeVisible();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(window).toHaveAttribute('data-loaded-count', '25');
    // The button remains an accessible alternative to the scroll sentinel, including after a failed page.
    let fail = true, failWindow = false;
    await page.route(`**/api/projects/${project}/comments/pages`, async route => {
        if (failWindow && !route.request().postDataJSON().cursor) { failWindow = false; await route.fulfill({ status: 503, json: { error: 'unavailable' } }); }
        else if (fail && route.request().postDataJSON().cursor) { fail = false; await route.fulfill({ status: 503, json: { error: 'unavailable' } }); }
        else await route.continue();
    });
    await window.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(column.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(column.getByText('More comments could not be loaded.', { exact: true })).toBeVisible();
    await column.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => pages.filter(result => result.lane === 'open').length).toBeGreaterThan(0);
    await window.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => pages.filter(result => result.lane === 'open').length).toBeGreaterThanOrEqual(2);
    await expect(window).toHaveAttribute('data-loaded-count', '60');
    await window.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(column.getByRole('link', { name: new RegExp(`Comment #${oldest!.number} `) })).toBeVisible();
    expect(await column.locator('[data-board-card]').count()).toBeLessThan(25);
    await expect(column.getByRole('heading')).toHaveText('Open60');
    expect(pages.every(result => result.rows <= 25)).toBe(true);
    // An action refresh preserves the three loaded pages in a single depth request.
    const beforeRefresh = replayRequests.length;
    await page.getByRole('button', { name: 'Mark all as read', exact: true }).filter({ visible: true }).click();
    await expect.poll(() => replayRequests.slice(beforeRefresh).filter(request => request.depths?.open === 3).length).toBe(1);
    await expect(window).toHaveAttribute('data-loaded-count', '60');
    expect(replayRequests.slice(beforeRefresh).filter(request => request.cursor)).toEqual([]);
    await column.getByRole('link', { name: new RegExp(`Comment #${oldest!.number} `) }).click();
    await expect(page.getByRole('article')).toContainText('A discussion to load only when opened.');
    expect(details.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    // Search must find the oldest record from a new first-page query, not only the already mounted window.
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('Oldest-needle');
    await expect(column.getByRole('heading')).toHaveText('Open1');
    await expect(column.locator('[data-board-card]')).toHaveCount(1);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('[data-comment-id]')).toHaveCount(1);
    failWindow = true;
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('');
    await expect(page.getByText('Comments could not be refreshed. Your loaded comments are still shown.', { exact: false })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Comments', exact: true }).locator('[data-page-width]').first()).not.toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Active 60', exact: true })).toBeVisible();
    expect(await page.locator('[data-comment-id]').count()).toBeLessThan(25);
    const list = page.locator('[data-comment-window]').filter({ visible: true });
    await expect(list.locator('[data-comment-id]').first()).toHaveAttribute('aria-setsize', '60');
    if ((page.viewportSize()?.width ?? 1280) < 1024) {
        expect(await list.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
        await page.evaluate(() => globalThis.scrollTo(0, document.documentElement.scrollHeight));
        await expect(list).toHaveAttribute('data-loaded-count', '50');
        await page.evaluate(() => globalThis.scrollTo(0, document.documentElement.scrollHeight));
        await expect(list).toHaveAttribute('data-loaded-count', '60');
        await page.evaluate(() => globalThis.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.getByRole('link', { name: new RegExp(`Comment #${oldest!.number} `) }).filter({ visible: true })).toBeInViewport();
        expect(await page.locator('[data-comment-id]').count()).toBeLessThan(25);
    }
    await testInfo.attach('project-paging-browser.json', { body: JSON.stringify({ pages, mountedRows: await page.locator('[data-comment-id]').count(), details: details.length }), contentType: 'application/json' });
}
