import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { backToComments, openReply, commentRowLink, commentRows, createProject, inBackground, openComment, openCommentFilters, selectionBar, selectShownResults, selectThread, setProjectAccess, signIn, startSelecting, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { toolbar, animationsFinished, threadOptions } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
async function fixture(page: Page, request: APIRequestContext, count = 3) {
    // Triage holds and counts the page's server actions: the thread shown beside the list stays unread
    await inBackground(page);
    await signIn(page, uniqueEmail('triage'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    let headers = await verifiedReviewHeaders(request, project, site.origin());
    const comments: { id: string; number: number }[] = [];
    for (let index = 0; index < count; index++) {
        if (index > 0 && index % 8 === 0) headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/${index === 0 ? 'pricing' : count > 3 ? `about/${index}` : 'about'}`, text: index === 0 ? 'Checkout button fails' : `Other feedback ${index}`, quotedText: index === 0 ? 'Pay now' : undefined,
            authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201); comments.push(await response.json());
    }
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(count);
    return { project, headers, comments };
}
const selected = (page: Page, number: number) => page.getByRole('checkbox', { name: `Select comment #${number}`, exact: true });
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }

test('find, select, assign, prioritize and complete feedback in list and board @smoke @mobile-smoke', async ({ page, request }) => {
    const { project, comments } = await fixture(page, request);
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    await search.fill('checkout');
    await expect(commentRows(page)).toHaveCount(1);
    // Nothing selected: no bar, and the box shows only on hover (a touch screen starts with Select)
    await expect(selectionBar(page)).toHaveCount(0);
    await selectThread(page, comments[0]!.number);
    await page.getByRole('combobox', { name: 'Assign selected', exact: true }).click();
    await page.getByRole('option').filter({ hasNotText: 'Unassign' }).first().click();
    // The row shows the assignee's avatar and a priority other than Normal
    await expect(commentRows(page).getByRole('img', { name: /^Assigned to / })).toBeVisible();
    await expect(page.getByText('1 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
    // The bar stays for the next action; the changed thread left the selection
    await expect(selected(page, comments[0]!.number)).toBeEnabled();
    await expect(selected(page, comments[0]!.number)).not.toBeChecked();
    await selected(page, comments[0]!.number).check();
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: 'Urgent', exact: true }).click();
    await expect(commentRows(page).getByRole('img', { name: 'Urgent priority', exact: true })).toBeVisible();
    await expect(selected(page, comments[0]!.number)).toBeEnabled();
    await expect(selected(page, comments[0]!.number)).not.toBeChecked();
    await selected(page, comments[0]!.number).check();
    await page.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(0);
    await expect(page.getByText('1 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
    // Another view ends the selection; the outcome stays until it is dismissed
    await expect(page.getByRole('button', { name: 'Select comments', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await selectThread(page, comments[0]!.number);
    await page.getByRole('button', { name: 'Reopen selected', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveCount(1);
    await expect(selected(page, comments[0]!.number)).toBeEnabled();
    await expect(selected(page, comments[0]!.number)).not.toBeChecked();
    await selected(page, comments[0]!.number).check();
    await page.getByRole('combobox', { name: 'Assign selected', exact: true }).click();
    await page.getByRole('option', { name: 'Unassign', exact: true }).click();
    const openColumn = page.getByRole('region', { name: 'Open comments', exact: true });
    await expect(openColumn.getByRole('img', { name: /^Assigned to / })).toHaveCount(0);
    // Saved: the bar counts the selection again (it shows Saving while the batch runs)
    await expect(selectionBar(page).getByText('0 selected', { exact: true })).toBeVisible();
    // Escape ends the selection: the bar goes and the boxes are quiet again
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select comments', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(search).toHaveValue('checkout');
    await expect(openColumn.getByRole('img', { name: 'Urgent priority', exact: true })).toBeVisible();
    await expect((await openComment(page, comments[0]!.number)).getByRole('button', { name: 'Priority: Urgent. Change priority', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/app/projects/${project}`);
});

test('search covers replies, quotes, paths and numbers with local URL history and combined filters', async ({ page, request }) => {
    const { project, headers, comments } = await fixture(page, request);
    const reply = await request.post(`/api/review/${project}/comments/${comments[1]!.id}/replies`, { headers, data: { text: 'Card declined', authorName: 'Reviewer' } });
    expect(reply.ok()).toBe(true);
    await page.reload();
    const requests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === `/app/projects/${project}` && request.headers().rsc === '1' && !request.headers()['next-router-prefetch']) requests.push(request.url()); });
    await page.route(`**/app/projects/${project}?*`, route => route.request().method() === 'GET' ? route.abort() : route.continue());
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    for (const query of ['CARD declined', 'PAY NOW', `#${comments[0]!.number}`, `/${project}/pricing`]) {
        await search.fill(query);
        await expect(commentRows(page)).toHaveCount(1);
        await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(query);
    }
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(search).toHaveValue(`/${project}/pricing`);
    await page.goBack();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await (await openCommentFilters(page)).getByRole('combobox', { name: 'Priority filter', exact: true }).click();
    await page.getByRole('option', { name: 'Urgent', exact: true }).click();
    await expect(page.getByText('No comments match these filters.', { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.unroute(`**/app/projects/${project}?*`);
    await page.reload();
    await expect(search).toHaveValue(`/${project}/pricing`);
    await expect(page.getByRole('button', { name: 'Clear filter: Urgent priority', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(3);
    await page.goto(`/app/projects/${project}?q=${'x'.repeat(220)}`);
    await expect(search).toHaveValue('x'.repeat(200));
    await expect.poll(() => new URL(page.url()).searchParams.get('q')?.length).toBe(200);
});

test('selection stays quiet until it is used, by pointer, keyboard or touch, and Escape or Clear selection ends it', async ({ page, request }, testInfo) => {
    const { comments } = await fixture(page, request);
    const mobile = testInfo.project.name.startsWith('Mobile');
    const bar = selectionBar(page);
    const select = page.getByRole('button', { name: 'Select comments', exact: true });
    const box = (index: number) => selected(page, comments[index]!.number);
    const anyBox = page.getByRole('checkbox', { name: /^Select comment #/ });
    // At rest no bar takes room and no row shows its box: a pointer finds it on the row it hovers,
    // a touch screen leaves it out until Select is on
    await expect(bar).toHaveCount(0);
    await expect(select).toHaveAttribute('aria-pressed', 'false');
    if (mobile) await expect(anyBox).toHaveCount(0);
    else {
        for (const index of [0, 1, 2]) await expect(box(index)).toHaveCSS('opacity', '0');
        await commentRows(page).nth(1).hover();
        await expect(box(1)).toHaveCSS('opacity', '1');
        await expect(box(0)).toHaveCSS('opacity', '0');
        // Pointer: check one, Shift-click another for the range between them; while selecting every box shows
        await box(0).check();
        await expect(bar).toBeVisible();
        await expect(select).toHaveAttribute('aria-pressed', 'true');
        await page.mouse.move(0, 0);
        await expect(box(2)).toHaveCSS('opacity', '1');
        await box(2).click({ modifiers: ['Shift'] });
        for (const index of [0, 1, 2]) await expect(box(index)).toBeChecked();
        await expect(bar.getByText('3 selected', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(bar).toHaveCount(0);
        await expect(page.getByRole('checkbox', { name: /^Select comment #/, checked: true })).toHaveCount(0);
        await expect(box(0)).toHaveCSS('opacity', '0');
    }

    // Keyboard: x selects the focused row, Ctrl or ⌘ + A the shown results, Escape ends it and the focus stays
    const firstLink = commentRowLink(page, comments[0]!.number);
    await firstLink.focus();
    await page.keyboard.press('x');
    await expect(box(0)).toBeChecked();
    await expect(bar.getByRole('checkbox', { name: 'Select shown results', exact: true })).toHaveAttribute('aria-checked', 'mixed');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(bar.getByText('3 selected', { exact: true })).toBeVisible();
    await expect(bar.getByRole('checkbox', { name: 'Select shown results', exact: true })).toBeChecked();
    await page.keyboard.press('x');
    await expect(box(0)).not.toBeChecked();
    await expect(bar.getByText('2 selected', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(firstLink).toBeFocused();
    // x selects; it never opens the row's thread
    expect(new URL(page.url()).searchParams.get('comment')).toBeNull();

    if (mobile) {
        // Touch: Select shows every box; a tap on a row then selects it instead of opening it
        await select.tap();
        await expect(bar).toBeVisible();
        await expect(bar.getByText('0 selected', { exact: true })).toBeVisible();
        await expect(box(0)).toBeVisible();
        await commentRowLink(page, comments[1]!.number).tap();
        await expect(box(1)).toBeChecked();
        expect(new URL(page.url()).searchParams.get('comment')).toBeNull();
        await box(2).tap();
        await expect(bar.getByText('2 selected', { exact: true })).toBeVisible();
        for (const control of [select, bar.getByRole('button', { name: 'Clear selection', exact: true }), bar.getByRole('combobox', { name: 'Assign selected', exact: true }),
            bar.getByRole('combobox', { name: 'Prioritize selected', exact: true }), bar.getByRole('button', { name: 'Mark selected as done', exact: true }), bar.getByRole('button', { name: 'Reopen selected', exact: true })])
            expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // The bar fits the phone: its actions take a line of their own
        const barBox = (await bar.boundingBox())!;
        expect(barBox.x).toBeGreaterThanOrEqual(0);
        expect(barBox.x + barBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        await bar.getByRole('button', { name: 'Clear selection', exact: true }).tap();
        await expect(bar).toHaveCount(0);
        await expect(select).toBeFocused();
        await expect(anyBox).toHaveCount(0);
        // At rest a tap opens the thread again
        await commentRowLink(page, comments[1]!.number).tap();
        await expect.poll(() => new URL(page.url()).searchParams.get('comment')).toBe(comments[1]!.id);
    }
});

test('selection resets on search and view changes, and the bar passes accessibility checks in both themes', async ({ page, request }, testInfo) => {
    const { comments } = await fixture(page, request);
    const first = selected(page, comments[0]!.number);
    const bar = selectionBar(page);
    const select = page.getByRole('button', { name: 'Select comments', exact: true });
    await selectThread(page, comments[0]!.number);
    await expect(first).toBeChecked();
    await expect(bar.getByRole('checkbox', { name: 'Select shown results', exact: true })).toHaveAttribute('aria-checked', 'mixed');
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('checkout');
    await expect(bar).toHaveCount(0);
    await selectThread(page, comments[0]!.number);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /^Select comment #/, checked: true })).toHaveCount(0);
    await page.goBack();
    await expect(bar).toHaveCount(0);
    // Select, then Tab: the bar is next in the focus order, though it floats over the end of the list
    await select.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(bar.getByRole('button', { name: 'Clear selection', exact: true })).toBeFocused();
    await bar.getByRole('checkbox', { name: 'Select shown results', exact: true }).check();
    await expect(first).toBeChecked();
    for (const action of ['Mark selected as done', 'Reopen selected']) await expect(bar.getByRole('button', { name: action, exact: true })).toBeEnabled();
    // The bar floats: the list keeps its place, and the bar sits at the end of the comments, never above them
    const list = page.getByRole('list', { name: 'Comments', exact: true });
    expect((await bar.boundingBox())!.y).toBeGreaterThan((await list.boundingBox())!.y);
    await page.screenshot({ path: testInfo.outputPath('triage-selected.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await bar.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(select).toBeFocused();
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await startSelecting(page);
    await first.check();
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('triage-dark.png') });
});

test('pending batches update immediately, exclude new arrivals and survive scope changes without selecting hidden rows', async ({ page, request }) => {
    const { project, headers, comments } = await fixture(page, request);
    await selectShownResults(page);
    const pending = gate(); let posts = 0;
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() === 'POST' && route.request().headers()['next-action']) { posts++; await pending.wait; }
        await route.continue();
    });
    try {
        await page.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
        await expect(commentRows(page)).toHaveCount(0);
        await expect(page.getByText('Saving 3 threads', { exact: true })).toBeVisible();
        await expect.poll(() => posts).toBe(1);
        const arrival = await request.post(`/api/review/${project}/comments`, { headers, data: { path: `/${project}/pricing`, text: 'New checkout arrival', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback' } });
        expect(arrival.status()).toBe(201);
        await page.getByRole('searchbox', { name: 'Search feedback' }).fill('checkout');
        pending.release();
        await expect(page.getByText('3 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
        await expect(commentRows(page)).toHaveCount(1);
        await expect(commentRows(page)).toContainText('New checkout arrival');
        await expect(page.getByRole('checkbox', { name: /^Select comment #/, checked: true })).toHaveCount(0);
        const saved = await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json();
        expect(saved.filter((item: { resolved: boolean }) => item.resolved)).toHaveLength(comments.length);
    } finally { pending.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('failed batch responses roll back and retry the original operation without duplicate activity', async ({ page, request }) => {
    const { project, headers, comments } = await fixture(page, request, 1);
    await selectThread(page, comments[0]!.number);
    let fail = true;
    await page.route(`**/app/projects/${project}*`, async route => {
        if (fail && route.request().method() === 'POST' && route.request().headers()['next-action']) { fail = false; await route.fetch(); await route.abort(); }
        else await route.continue();
    });
    await page.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry failed threads', exact: true })).toBeVisible();
    await expect(commentRows(page)).toHaveCount(1);
    await expect(selected(page, comments[0]!.number)).toBeChecked();
    const committed = await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json();
    expect(committed[0].resolved).toBe(true);
    expect((await request.post(`/api/review/${project}/comments/${comments[0]!.id}/replies`, { headers, data: { text: 'New reply after an uncertain response', authorName: 'Reviewer' } })).ok()).toBe(true);
    await page.getByRole('button', { name: 'Retry failed threads', exact: true }).click();
    await expect(page.getByText('1 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
    const saved = await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json();
    expect(saved[0].resolved).toBe(true); expect(saved[0].activity.sequence).toBe(3); expect(saved[0].thread.items).toHaveLength(2);
});

test('member toolbar thread and inbox priorities persist and guests can only read them', async ({ page, request, browser }) => {
    const { project, comments } = await fixture(page, request, 1);
    const path = `/${project}/pricing`;
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(site.origin() + path)}`);
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments', exact: true });
    await expect(inbox).toContainText('Checkout button fails');
    // Priority is in Thread options; a priority other than Normal shows beside the status
    const options = await threadOptions(page, inbox.getByRole('article'));
    await options.getByRole('button', { name: 'Priority: Normal. Change priority', exact: true }).click();
    await options.getByRole('group', { name: 'Set priority' }).getByRole('button', { name: 'High', exact: true }).click();
    await expect(inbox.getByRole('article')).toContainText('Priority: High');
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    await expect(inbox.getByRole('article')).toContainText('Priority: High');
    await expect((await threadOptions(page, inbox.getByRole('article'))).getByRole('button', { name: 'Priority: High. Change priority', exact: true })).toBeVisible();
    const guest = await browser.newContext();
    try {
        const tab = await guest.newPage();
        await tab.goto(`${site.origin()}${path}?toolbar-code=${project}`);
        await expect(toolbar(tab)).toBeVisible();
        await toolbar(tab).getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
        await expect(tab.getByRole('complementary', { name: 'Comments', exact: true })).toContainText('Priority: High');
        await expect(tab.getByRole('button', { name: /Change priority/ })).toHaveCount(0);
    } finally { await guest.close(); }
    expect(comments).toHaveLength(1);
});


test('selection caps at the first 50 shown and leaves the remaining result untouched', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project, headers, comments } = await fixture(page, request, 51);
    await selectShownResults(page, 'Select first 50 shown');
    await expect(page.getByText('50 selected', { exact: true })).toBeVisible();
    // The first 50 in the list's order: by number, highest first, so the oldest one is left out
    await expect(selected(page, comments[0]!.number)).not.toBeChecked();
    await expect(selected(page, comments[0]!.number)).toBeDisabled();
    await expect(selected(page, comments[50]!.number)).toBeChecked();
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: 'Low', exact: true }).click();
    await expect(page.getByText('50 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
    const saved = await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json();
    expect(saved.filter((item: { priority: string }) => item.priority === 'low')).toHaveLength(50);
    expect(saved.find((item: { id: string }) => item.id === comments[0]!.id).priority).toBe('normal');
});


test('partial status batches retain stale visible threads for review and a new explicit action', async ({ page, request }) => {
    const { project, headers, comments } = await fixture(page, request, 2);
    await selectShownResults(page);
    const pending = gate(); let posted = false;
    await page.route(`**/app/projects/${project}*`, async route => {
        if (!posted && route.request().method() === 'POST' && route.request().headers()['next-action']) { posted = true; await pending.wait; }
        await route.continue();
    });
    try {
        await page.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
        await expect.poll(() => posted).toBe(true);
        expect((await request.post(`/api/review/${project}/comments/${comments[0]!.id}/replies`, { headers, data: { text: 'More context before completion', authorName: 'Reviewer' } })).ok()).toBe(true);
        pending.release();
        await expect(page.getByText('1 changed, 0 unchanged, 1 stale, 0 unavailable, 0 failed. Review stale threads before starting a new action.', { exact: true })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Threads needing attention' })).toContainText(`#${comments[0]!.number}: Stale`);
        await expect(commentRows(page)).toHaveCount(1);
        await expect(selected(page, comments[0]!.number)).toBeChecked();
        await expect(page.getByRole('button', { name: 'Mark selected as done', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
        await expect(page.getByText('1 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
        await expect(commentRows(page)).toHaveCount(0);
    } finally { pending.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('search and selection stay local at the capped 1000-thread window', async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const { project } = await fixture(page, request, 0);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
        for (;;) {
            const group = next++;
            if (group >= 100) return;
            const headers = await verifiedReviewHeaders(request, project, site.origin());
            for (let item = 0; item < 10; item++) {
                const index = group * 10 + item;
                const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                    path: `/${project}/window/${index}`, text: `Window feedback ${index}`, authorName: 'Window reviewer', kind: 'feedback', position: { type: 'page' }
                } });
                expect(response.status()).toBe(201);
            }
        }
    }));
    await page.reload();
    await expect(commentRows(page)).toHaveCount(1000);
    await expect(page.getByText('Search covers up to 1,000 recent threads', { exact: false })).toBeVisible();
    const requests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === `/app/projects/${project}` && request.headers().rsc === '1' && !request.headers()['next-router-prefetch']) requests.push(request.url()); });
    await page.route(`**/app/projects/${project}?*`, route => route.request().method() === 'GET' ? route.abort() : route.continue());
    const start = Date.now();
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('feedback /window/999');
    await expect(commentRows(page)).toHaveCount(1);
    const searchMs = Date.now() - start;
    expect(searchMs).toBeLessThan(2500);
    await selectShownResults(page);
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await (await openCommentFilters(page)).getByRole('combobox', { name: 'Priority filter', exact: true }).click();
    await page.getByRole('option', { name: 'Urgent', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(0);
    expect(requests).toEqual([]);
    await testInfo.attach('search-window-performance', { body: JSON.stringify({ threads: 1000, searchMs, serverRequests: requests.length }), contentType: 'application/json' });
});


test('search, selection and priority preserve reply drafts in their original thread after view changes and reload', async ({ page, request }) => {
    const { comments } = await fixture(page, request, 2);
    const draft = 'Draft for the checkout thread';
    let original = await openComment(page, comments[0]!.number);
    await original.getByRole('button', { name: 'Reply', exact: true }).click();
    await original.getByRole('textbox', { name: 'Reply', exact: true }).fill(draft);
    await backToComments(page);
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('Other');
    await expect(commentRowLink(page, comments[0]!.number)).toHaveCount(0);
    await selectShownResults(page);
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: 'High', exact: true }).click();
    await expect(page.getByText('1 changed, 0 unchanged, 0 stale, 0 unavailable, 0 failed.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    original = await openComment(page, comments[0]!.number);
    await expect(await openReply(original)).toHaveValue(draft);
    await backToComments(page);
    // The board opens the same thread in a sheet
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    original = await openComment(page, comments[0]!.number);
    await expect(await openReply(original)).toHaveValue(draft);
    await page.reload();
    await original.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(original.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue(draft);
    await page.keyboard.press('Escape');
    await expect(original).toBeHidden();
    const other = await openComment(page, comments[1]!.number);
    await other.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(other.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('');
});
