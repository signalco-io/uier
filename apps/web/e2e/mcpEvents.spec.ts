import { test, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { signIn, uniqueEmail, createProject, setProjectAccess } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { modernEnvelope, named, streamOf } from './support/eventStream';
import { newWebhookSecret, WebhookReceiver } from './support/webhookReceiver';

async function createAccessToken(page: Page, projectName: string) {
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await section.getByLabel('Token label').fill('Event watcher');
    await section.getByRole('checkbox', { name: projectName, exact: true }).check();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    return (await code.textContent())!;
}

test('a webhook subscriber receives new feedback right after it is posted, without the scheduled worker', async ({ page, baseURL }) => {
    const site = await startReviewedSite(new URL(baseURL!).origin);
    const receiver = await new WebhookReceiver().start();
    const client = new Client({ name: 'mcp-events-e2e', version: '1.0.0' });
    try {
        await signIn(page, uniqueEmail('mcp-events'));
        const projectId = await createProject(page, { name: 'Event review', urls: [site.origin()] });
        await setProjectAccess(page, projectId, 'Anyone with the link');
        const token = await createAccessToken(page, 'Event review');
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        const secret = newWebhookSecret();
        receiver.secrets.add(secret);
        const subscribed = await client.request({ method: 'events/subscribe' as never, params: { name: 'feedback.created', arguments: { projectId },
            delivery: { mode: 'webhook', url: receiver.url, secret } } } as never, z.object({ id: z.string() }).loose());
        expect(receiver.received.map(entry => entry.json.type)).toEqual(['verification']);

        const headers = await verifiedReviewHeaders(page.request, projectId, site.origin());
        const posted = await page.request.post(`/api/review/${projectId}/comments`, { headers, data: {
            path: `/${projectId}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Webhook feedback', authorName: 'Guest'
        } });
        expect(posted.status()).toBe(201);
        const comment = await posted.json() as { id: string };
        // Delivered by the request's after-response work: nothing else dispatches in this run.
        await expect.poll(() => receiver.deliveries().length, { timeout: 15_000 }).toBe(1);
        const [delivery] = receiver.deliveries();
        expect(receiver.verifiedBy(delivery!)).toEqual([secret]);
        expect(delivery!.headers['x-mcp-subscription-id']).toBe(subscribed.id);
        expect(delivery!.json).toMatchObject({ name: 'feedback.created', cursor: expect.stringMatching(/^v1:/),
            data: { projectId, commentId: comment.id, kind: 'feedback', excerpt: 'Webhook feedback', actor: { kind: 'guest', name: 'Guest' }, contentTrust: 'untrusted' } });
    } finally { await client.close(); await receiver.stop(); await site.close(); }
});

test('a push stream stays open over HTTP and sends new feedback as it is posted', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    const controller = new AbortController();
    try {
        await signIn(page, uniqueEmail('mcp-stream'));
        const projectId = await createProject(page, { name: 'Stream review', urls: [site.origin()] });
        await setProjectAccess(page, projectId, 'Anyone with the link');
        const token = await createAccessToken(page, 'Stream review');
        // A 2026-07-28 request: no handshake, the revision and the event in the headers.
        const response = await fetch(new URL('/api/mcp', baseURL), { method: 'POST', signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'events/stream', 'Mcp-Name': 'feedback.created' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'events/stream',
                params: { name: 'feedback.created', arguments: { projectId }, cursor: null, _meta: modernEnvelope } }) });
        expect(response.status).toBe(200);
        const stream = streamOf(response);
        await stream.until(messages => named(messages, 'active').length > 0);

        const headers = await verifiedReviewHeaders(page.request, projectId, site.origin());
        const posted = await page.request.post(`/api/review/${projectId}/comments`, { headers, data: {
            path: `/${projectId}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Stream feedback', authorName: 'Guest'
        } });
        expect(posted.status()).toBe(201);
        const comment = await posted.json() as { id: string };
        // The open response carries it within one poll of the stream, long before the stream ends.
        await stream.until(messages => named(messages, 'event').length > 0);
        expect(named(stream.messages, 'event')[0]).toMatchObject({ name: 'feedback.created', cursor: expect.stringMatching(/^v1:/),
            data: { projectId, commentId: comment.id, excerpt: 'Stream feedback', contentTrust: 'untrusted' } });
    } finally { controller.abort(); await site.close(); }
});
