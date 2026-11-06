import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail, openComment } from './support/app';
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
    await expect(draft).toHaveValue('Keep this unfinished reply');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
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
    await expect(draft).toHaveValue('Still writing this reply');
    const previous = sockets.length;
    sockets.at(-1)!.close({ code: 1012, reason: 'Deployment restart' });
    const missed = await request.post(`/api/review/${project}/comments/${comment.id}/replies`, { headers, data: { text: 'Posted during reconnect', authorName: 'Reviewer' } });
    expect(missed.status()).toBe(201);
    await expect.poll(() => sockets.length).toBeGreaterThan(previous);
    await expect(thread).toContainText('Posted during reconnect');
    await expect(draft).toHaveValue('Still writing this reply');
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
    await expect(draft).toHaveValue('Still writing this reply');
});
