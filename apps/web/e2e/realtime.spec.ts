import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { commentRowLink, createProject, setProjectAccess, signIn, uniqueEmail, openComment } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { commentBubble, openThread } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

/** Only Vercel's upgrade boundary is substituted; tickets, writes and refetches use the real app. */
async function transport(page: Page) {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket('**/api/realtime', socket => {
        expect(new URL(socket.url()).search).toBe('');
        socket.onMessage(message => {
            const frame = JSON.parse(message.toString()) as { type: string; token: string };
            expect(frame.type).toBe('subscribe');
            expect(frame.token).toContain('.');
            sockets.push(socket);
            socket.send('{"type":"ready"}');
        });
    });
    return sockets;
}

test('app board receives another reviewer\'s comment and status change without reloading @smoke', async ({ page, request }) => {
    const sockets = await transport(page);
    await signIn(page, uniqueEmail('realtime-board'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    await page.goto(`/app/projects/${project}?view=board`);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    const posted = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Feedback from another reviewer', authorName: 'Reviewer'
    } });
    expect(posted.status()).toBe(201);
    const comment = await posted.json() as { id: string };
    const changed = () => sockets.at(-1)!.send('{"type":"comments.changed"}');
    changed();
    const open = page.getByRole('region', { name: 'Open comments', exact: true });
    await expect(open.getByRole('listitem').filter({ hasText: 'Feedback from another reviewer' })).toBeVisible();
    const thread = await openComment(page, 'Feedback from another reviewer');
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    const draft = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await draft.fill('Keep this unfinished reply');
    const resolved = await request.patch(`/api/review/${project}/comments/${comment.id}`, { headers, data: { resolved: true } });
    expect(resolved.status()).toBe(200);
    changed(); changed(); changed();
    await expect(thread.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
    await expect(draft).toHaveText('Keep this unfinished reply', { useInnerText: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
});

test('a thread that arrives does not take the place of the one shown beside the list', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'A phone shows no thread until a row is opened');
    const sockets = await transport(page);
    await signIn(page, uniqueEmail('realtime-shown'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const post = (text: string) => request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text, authorName: 'Reviewer'
    } });
    expect((await post('The thread being read')).status()).toBe(201);
    await page.goto(`/app/projects/${project}`);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    // No thread chosen: the first one is shown beside the list
    const thread = page.getByRole('article');
    await expect(thread).toContainText('The thread being read');
    expect((await post('A newer thread')).status()).toBe(201);
    sockets.at(-1)!.send('{"type":"comments.changed"}');
    // The newer thread is listed first, and the one being read stays on screen
    await expect(commentRowLink(page, 2)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Comment #\d+/ }).first()).toHaveAccessibleName(/^Comment #2(?!\d)/);
    await expect(thread).toContainText('The thread being read');
    await expect(thread).not.toContainText('A newer thread');
    // The keys go on from the thread shown, not from the first row: ↑ from the page opens the one above it
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowUp');
    await expect(thread).toContainText('A newer thread');
});

test('toolbar receives replies, reconciles after socket replacement and preserves its composer', async ({ page, request }) => {
    const sockets = await transport(page);
    await signIn(page, uniqueEmail('realtime-toolbar'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const posted = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'A live thread', authorName: 'Reviewer'
    } });
    const comment = await posted.json() as { id: string; number: number };
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`);
    await expect(commentBubble(page, comment.number)).toBeVisible();
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    await commentBubble(page, comment.number).click();
    const thread = openThread(page);
    const draft = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await draft.fill('Still writing this reply');
    const reply = await request.post(`/api/review/${project}/comments/${comment.id}/replies`, { headers, data: { text: 'A remote reply', authorName: 'Reviewer' } });
    expect(reply.status()).toBe(201);
    sockets.at(-1)!.send('{"type":"comments.changed"}');
    await expect(thread).toContainText('A remote reply');
    await expect(draft).toHaveText('Still writing this reply', { useInnerText: true });
    const previous = sockets.length;
    sockets.at(-1)!.close({ code: 1012, reason: 'Deployment restart' });
    const missed = await request.post(`/api/review/${project}/comments/${comment.id}/replies`, { headers, data: { text: 'Posted during reconnect', authorName: 'Reviewer' } });
    expect(missed.status()).toBe(201);
    await expect.poll(() => sockets.length).toBeGreaterThan(previous);
    await expect(thread).toContainText('Posted during reconnect');
    await expect(draft).toHaveText('Still writing this reply', { useInnerText: true });
    let closed = false;
    sockets.at(-1)!.onClose(() => { closed = true; });
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => closed).toBe(true);
    const suspended = sockets.length;
    const background = await request.post(`/api/review/${project}/comments/${comment.id}/replies`, { headers, data: { text: 'Posted while tab was hidden', authorName: 'Reviewer' } });
    expect(background.status()).toBe(201);
    expect(sockets.length).toBe(suspended);
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => sockets.length).toBeGreaterThan(suspended);
    await expect(thread).toContainText('Posted while tab was hidden');
    await expect(draft).toHaveText('Still writing this reply', { useInnerText: true });
});

/** Only app-shell RSC reads: revision probes and other request types do not count as renders. */
function shellRefreshes(page: Page, project: string) {
    const reads: string[] = [];
    page.on('request', request => {
        if (request.method() === 'GET' && new URL(request.url()).pathname === `/app/projects/${project}`
            && request.headers().rsc === '1' && !request.headers()['next-router-prefetch']) reads.push(request.url());
    });
    return reads;
}

async function idleFixture(page: Page, request: Parameters<typeof verifiedReviewHeaders>[0]) {
    const sockets = await transport(page);
    await signIn(page, uniqueEmail('idle-revision'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    await page.clock.install();
    const initial = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/revision`));
    await page.goto(`/app/projects/${project}`);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    await page.clock.runFor(200);
    await initial;
    return { sockets, project, headers };
}

test('unchanged idle comments skip app shell renders and retain one five-minute data safety refresh', async ({ page, request }) => {
    const { project } = await idleFixture(page, request);
    const revisionUrl = `/api/projects/${project}/comments/revision`;
    const revision = await page.request.get(revisionUrl);
    expect(revision.status()).toBe(200);
    expect(Object.keys(await revision.json())).toEqual(['revision']);
    expect(revision.headers()['cache-control']).toBe('private, no-store');
    expect((await page.request.get('/api/projects/zzzzzzzzzzzz/comments/revision')).status()).toBe(404);
    expect((await page.request.get(`${revisionUrl}?author=invalid-reference`)).status()).toBe(404);
    const reads = shellRefreshes(page, project);
    for (let minute = 1; minute <= 4; minute++) {
        const checked = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/revision`));
        await page.clock.fastForward(60_000);
        expect((await checked).status()).toBe(200);
        expect(reads).toHaveLength(0);
    }
    const rendered = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/pages`));
    await page.clock.fastForward(60_000);
    expect((await rendered).status()).toBe(200);
    expect(reads).toHaveLength(0);
});

test('the refreshed page revision includes a mutation committed after its revision check', async ({ page, request }) => {
    const { project, headers } = await idleFixture(page, request);
    const reads = shellRefreshes(page, project);
    const post = (text: string) => request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text, authorName: 'Remote reviewer'
    } });
    expect((await post('Before the revision check')).status()).toBe(201);
    let inject = true;
    await page.route(`**/api/projects/${project}/comments/revision?*`, async route => {
        const response = await route.fetch();
        if (inject) {
            inject = false;
            expect((await post('Between the check and render')).status()).toBe(201);
        }
        await route.fulfill({ response });
    });
    await page.clock.fastForward(60_000);
    await expect(commentRowLink(page, 2)).toBeVisible();
    await expect(commentRowLink(page, 1)).toBeVisible();
    expect(reads).toHaveLength(0);
    const checked = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/revision`));
    await page.clock.fastForward(60_000);
    expect((await checked).status()).toBe(200);
    expect(reads).toHaveLength(0);
});

test('an idle revision check rechecks the session and redirects an ended session', async ({ page, request }) => {
    const { project } = await idleFixture(page, request);
    const response = await request.get(`/api/projects/${project}/comments/revision`);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect((await request.get(`/api/projects/${project}/comments/revision`, { headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
    await page.context().clearCookies();
    await page.clock.fastForward(60_000);
    await expect(page).toHaveURL(/\/app\/sign-in/);
});

test('a late changed revision response does not refresh a hidden tab', async ({ page, request }) => {
    const { project } = await idleFixture(page, request);
    const reads = shellRefreshes(page, project);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    await page.route(`**/api/projects/${project}/comments/revision?*`, async route => {
        entered = true;
        await waiting;
        await route.fulfill({ json: { revision: 'a different revision' } });
    });
    try {
        await page.clock.fastForward(60_000);
        await expect.poll(() => entered).toBe(true);
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const checked = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/revision`));
        release();
        await checked;
        await page.clock.runFor(500);
        expect(reads).toHaveLength(0);
    } finally { release(); }
});


test('background board reads preserve headers, focus and nodes through refresh, failure and retry', async ({ page, request }) => {
    const sockets = await transport(page);
    await signIn(page, uniqueEmail('background-board'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const post = (text: string) => request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text, authorName: 'Reviewer'
    } });
    expect((await post('Existing comment')).status()).toBe(201);
    await page.goto(`/app/projects/${project}?view=board`);
    const open = page.getByRole('region', { name: 'Open comments', exact: true });
    await expect(open).toBeVisible();
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    const reads = shellRefreshes(page, project);
    const original = await open.elementHandle();
    const search = page.getByRole('searchbox', { name: 'Search feedback', exact: true });
    await search.focus();
    const sort = open.locator('[data-board-sort]');
    const before = await sort.boundingBox();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let fail = false;
    await page.route(`**/api/projects/${project}/comments/pages`, async route => {
        await wait;
        if (fail) await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        else await route.continue();
    });
    try {
        expect((await post('New background comment')).status()).toBe(201);
        sockets.at(-1)!.send('{"type":"comments.changed"}');
        await expect(open.locator('[data-column-progress=true]')).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Loading comments' })).toHaveCount(0);
        expect(await sort.boundingBox()).toEqual(before);
        await expect(search).toBeFocused();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(open.locator('[data-slot=spinner]').last()).toHaveCSS('animation-name', 'none');
        expect(await original!.evaluate(node => node.isConnected)).toBe(true);
        release();
        await expect(open.getByRole('listitem')).toHaveCount(2);
        await expect(open.locator('[data-column-progress=false]')).toBeVisible();
        await expect(open.locator('[data-column-progress] [data-slot=spinner]')).toHaveCount(0);
        expect(await sort.boundingBox()).toEqual(before);
        fail = true;
        sockets.at(-1)!.send('{"type":"comments.changed"}');
        await expect(page.getByText('Comments could not be refreshed. Your loaded comments are still shown.')).toBeVisible();
        await expect(open.getByRole('listitem')).toHaveCount(2);
        fail = false;
        await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
        await expect(page.getByText('Comments could not be refreshed. Your loaded comments are still shown.')).toHaveCount(0);
        const saved = page.waitForResponse(response => response.url().includes(`/api/projects/${project}/comments/pages`));
        await page.getByRole('button', { name: 'Mark all as read', exact: true }).filter({ visible: true }).click();
        expect((await saved).status()).toBe(200);
        await expect(page.getByRole('button', { name: /unread, show only unread$/ })).toHaveCount(0);
        expect(await original!.evaluate(node => node.isConnected)).toBe(true);
        expect(reads).toHaveLength(0);
    } finally { release(); }
});
