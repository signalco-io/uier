import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { commentRows, createProject, openComment, openCommentFilters, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function fixture(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('responsive-app'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'Fast feedback', authorName: 'Performance reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const comment = await response.json();
    return { project, comment, headers };
}

function gate() {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    return { wait, release };
}

test('comment filters work without server requests and survive history and reload', async ({ page, request }) => {
    const { project } = await fixture(page, request);
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(1);
    const requests: string[] = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname === `/app/projects/${project}` && request.headers().rsc === '1'
            && !request.headers()['next-router-prefetch']) requests.push(request.url());
    });
    // A regression cannot silently pass on a fast local server: refuse every filter round trip.
    await page.route(`**/app/projects/${project}?*`, route => route.request().method() === 'GET' ? route.abort() : route.continue());
    await page.getByRole('button', { name: 'Done 0', exact: true }).click();
    await expect(page.getByText('Nothing done yet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All 1', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Done comments', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await (await openCommentFilters(page)).getByRole('combobox', { name: 'People', exact: true }).click();
    await page.getByRole('option', { name: 'Assigned to me', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(0);
    expect(requests).toEqual([]);
    await page.unroute(`**/app/projects/${project}?*`);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Clear filter: Assigned to me', exact: true })).toBeVisible();
    await expect((await openCommentFilters(page)).getByRole('combobox', { name: 'People', exact: true })).toContainText('Assigned to me');
    await expect(commentRows(page)).toHaveCount(0);
});

test('status, assignment, follow and read changes render before the server confirms and persist', async ({ page, request }) => {
    const { project, comment } = await fixture(page, request);
    await page.goto(`/app/projects/${project}?status=all`);
    const card = await openComment(page, comment.number);
    let pending = gate();
    let posts = 0;
    await page.route(`**/app/projects/${project}?*`, route => route.continue());
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
            posts++;
            await pending.wait;
        }
        await route.continue();
    });
    try {
        await card.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
        // The status tabs update at once (behind the thread where it takes the whole width)
        await expect(page.getByRole('button', { name: 'Done 1', exact: true, includeHidden: true })).toBeAttached();
        await expect.poll(() => posts).toBe(1);
        pending.release();
        await expect(card.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeEnabled();
        pending = gate();
        await card.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
        await page.getByRole('menuitem').filter({ hasNotText: 'Unassign' }).first().click();
        await expect(card.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();
        pending.release();
        await expect(card.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeEnabled();
        pending = gate();
        await card.getByRole('button', { name: /^More actions/ }).click();
        await page.getByRole('menuitem', { name: 'Follow thread', exact: true }).click();
        // Follow is reflected in the menu while its write is still pending.
        pending.release();
        await expect(card.getByRole('button', { name: /^More actions/ })).toBeEnabled();
        await card.getByRole('button', { name: /^More actions/ }).click();
        await expect(page.getByRole('menuitem', { name: 'Unfollow thread', exact: true })).toBeVisible();
        // Base UI dismisses on Escape once the menu has opened
        await animationsFinished(page.getByRole('menu'));
        await page.keyboard.press('Escape');
        pending = gate();
        await card.getByRole('button', { name: 'Unread. Mark as read', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
        pending.release();
        await expect(card.getByRole('button', { name: /^More actions/ })).toBeEnabled();
    } finally { pending.release(); }
    await page.unroute(`**/app/projects/${project}*`);
    await page.reload();
    await expect(card.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
});

test('failed optimistic status changes restore the card and counts', async ({ page, request }) => {
    const { project, comment } = await fixture(page, request);
    await page.goto(`/app/projects/${project}?status=all`);
    const card = await openComment(page, comment.number);
    const pending = gate();
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await pending.wait;
        await route.abort('failed');
    });
    try {
        await card.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
        pending.release();
        await expect(card.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeEnabled();
        // The status tabs update at once (behind the thread where it takes the whole width)
        await expect(page.getByRole('button', { name: 'Open 1', exact: true, includeHidden: true })).toBeAttached();
        await expect(page.getByText('Could not save the change. Try again.', { exact: true })).toBeVisible();
    } finally { pending.release(); }
});

test('toolbar status changes appear during a delayed save and roll back on failure', async ({ page, request }) => {
    const { project, comment } = await fixture(page, request);
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`);
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments', exact: true });
    await expect(inbox.getByRole('article')).toHaveCount(1);
    const pending = gate();
    await page.route(`**/api/review/${project}/comments/${comment.id}`, async route => {
        if (route.request().method() !== 'PATCH') return route.continue();
        await pending.wait;
        await route.fulfill({ status: 503, json: { error: 'unavailable', message: 'Try again.' } });
    });
    try {
        await inbox.getByRole('button', { name: 'Mark as done', exact: true }).click();
        await expect(inbox.getByRole('article')).toHaveCount(0);
        pending.release();
        await expect(inbox.getByRole('article')).toHaveCount(1);
        await expect(inbox.getByRole('button', { name: 'Mark as done', exact: true })).toBeEnabled();
    } finally { pending.release(); }
});

test('mark all as read clears the rendered unread snapshot before confirmation', async ({ page, request }) => {
    const { project } = await fixture(page, request);
    await page.goto(`/app/projects/${project}`);
    // The row says it is unread, as does the count beside Mark all as read
    const unreadRow = page.getByRole('link', { name: /, unread$/ });
    await expect(unreadRow).toHaveCount(1);
    await expect(page.getByText('· 1 unread')).toBeVisible();
    const pending = gate();
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() === 'POST') await pending.wait;
        await route.continue();
    });
    try {
        await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(unreadRow).toHaveCount(0);
        await expect(page.getByText('· 1 unread')).toHaveCount(0);
        pending.release();
        await expect(page.getByText('1 thread marked as read.', { exact: true })).toBeVisible();
        await page.reload();
        await expect(unreadRow).toHaveCount(0);
    } finally { pending.release(); }
});

test('new feedback appears and the composer closes while submission waits for the server', async ({ page, request }) => {
    const { project } = await fixture(page, request);
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`);
    await expect(toolbar(page)).toBeVisible();
    const pending = gate();
    await page.route(`**/api/review/${project}/comments`, async route => {
        if (route.request().method() === 'POST') await pending.wait;
        await route.continue();
    });
    try {
        await toolbar(page).getByRole('button', { name: 'Send feedback', exact: true }).click();
        const composer = page.getByRole('dialog', { name: 'Send feedback', exact: true });
        await composer.getByRole('textbox', { name: 'Feedback', exact: true }).fill('Posted in the background');
        await composer.getByRole('button', { name: 'Send feedback', exact: true }).click();
        await expect(composer).toBeHidden();
        await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
        const inbox = page.getByRole('complementary', { name: 'Comments', exact: true });
        await expect(inbox.getByText('Posted in the background', { exact: true })).toBeVisible();
        pending.release();
        await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
        await page.reload();
        await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
        await expect(inbox.getByText('Posted in the background', { exact: true })).toBeVisible();
    } finally { pending.release(); }
});
