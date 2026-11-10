import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { appNavigation, createProject, hydrated, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

async function fixture(page: Page, request: Parameters<typeof verifiedReviewHeaders>[0]) {
    await signIn(page, uniqueEmail('app-drafts'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: '/drafts', position: { type: 'page' }, kind: 'feedback', text: 'A thread for local drafts', authorName: 'Reviewer'
    } });
    expect(response.status()).toBe(201);
    await page.goto(`/app/projects/${project}`);
    const card = await openComment(page, 'A thread for local drafts');
    return { project, card };
}

test('app comment edits survive reload and thread remount, then clear on cancel or save', async ({ page, request }) => {
    const { card } = await fixture(page, request);
    await card.getByRole('button', { name: /^More actions for the / }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const editor = card.getByRole('textbox', { name: 'Edit comment', exact: true });
    await editor.fill('An unfinished edit');
    const threadUrl = page.url();
    await page.goto('/app/projects');
    await page.goto(threadUrl);
    await expect(editor).toHaveValue('An unfinished edit');
    await page.reload();
    await expect(editor).toHaveValue('An unfinished edit');
    // An intentionally empty edit is a draft too, rather than a fallback to the original message.
    await editor.fill('');
    await page.reload();
    await expect(editor).toHaveValue('');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(editor).toHaveCount(0);
    await card.getByRole('button', { name: /^More actions for the / }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(editor).toHaveValue('A thread for local drafts');
    // A slow save must clear only the submitted draft, never text typed while its response was pending.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let saving = false;
    await page.route('**/app/projects/**', async route => {
        if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.continue();
        const response = await route.fetch();
        saving = true;
        await held;
        await route.fulfill({ response });
    });
    await editor.fill('A saved edit');
    await editor.press('Enter');
    await expect.poll(() => saving).toBe(true);
    await editor.fill('Newer unsent text');
    release();
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.unroute('**/app/projects/**');
    await page.reload();
    await expect(editor).toHaveValue('Newer unsent text');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await expect(editor).toHaveCount(0);
    await expect(card).toContainText('A saved edit');
});

test('same-build refresh retains app and toolbar composers; deployment skew reload recovers both drafts', async ({ page, request }) => {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket('**/api/realtime', socket => {
        socket.onMessage(() => { sockets.push(socket); socket.send('{"type":"ready"}'); });
    });
    const { project, card } = await fixture(page, request);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    // Capture the app socket before the toolbar opens its own subscription.
    const appSocket = sockets.at(-1)!;
    await hydrated(card.getByRole('button', { name: 'Reply', exact: true }));
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    const reply = card.getByRole('textbox', { name: 'Reply', exact: true });
    await reply.fill('App reply before a deployment');
    await appNavigation(page);
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
    const text = feedback.getByRole('textbox', { name: 'Feedback', exact: true });
    await text.fill('Toolbar feedback before a deployment');
    await page.evaluate(() => {
        Object.assign(window, { draftDocument: true, feedbackField: document.querySelector('#uier-toolbar')?.shadowRoot?.querySelector('textarea') });
    });
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/app/projects/${project}` && response.request().headers().rsc === '1');
    appSocket.send('{"type":"comments.changed"}');
    await refreshed;
    await expect(reply).toHaveValue('App reply before a deployment');
    await expect(text).toHaveValue('Toolbar feedback before a deployment');
    expect(await page.evaluate(() => (window as unknown as { feedbackField: HTMLElement }).feedbackField.isConnected)).toBe(true);
    await expect(page.locator('#uier-toolbar')).toHaveCount(1);

    // Substitute only the response build identity. Next's real refresh reducer must take its MPA fallback.
    let skewed = false;
    // Only the project page's own refresh. A prefetch of one of its tabs is another address under it
    // (Page checks, Settings) or the page itself (the Comments tab), and would take the one skewed
    // response without reloading anything.
    await page.route(url => url.pathname === `/app/projects/${project}`, async route => {
        const headers = route.request().headers();
        if (skewed || headers.rsc !== '1' || headers['next-router-prefetch']) return route.continue();
        skewed = true;
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'x-nextjs-deployment-id': 'a-new-deployment' } });
    });
    appSocket.send('{"type":"comments.changed"}');
    // The reload gives the page a new document. A `framenavigated` alone is not proof of one: the
    // router's own history updates are navigations of the same document.
    await expect.poll(() => page.evaluate(() => 'draftDocument' in window).catch(() => true), { timeout: 15_000 }).toBe(false);
    await hydrated(card.getByRole('button', { name: 'Reply', exact: true }));
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(reply).toHaveValue('App reply before a deployment');
    await appNavigation(page);
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    await expect(text).toHaveValue('Toolbar feedback before a deployment');
    await feedback.getByRole('button', { name: 'Discard', exact: true }).click();
    await text.press('Escape');
    await expect(feedback).toBeHidden();
    // The floating pill can cover the app composer's Discard on a small viewport.
    await card.getByRole('button', { name: 'Discard', exact: true }).press('Enter');
    await page.reload();
    await hydrated(card.getByRole('button', { name: 'Reply', exact: true }));
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(reply).toHaveValue('');
    await appNavigation(page);
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    await expect(text).toHaveValue('');
});
