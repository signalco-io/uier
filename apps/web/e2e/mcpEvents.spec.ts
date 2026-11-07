import { test, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { signIn, uniqueEmail, createProject, setProjectAccess } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
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
        expect(delivery!.json).toMatchObject({ name: 'feedback.created', cursor: null,
            data: { projectId, commentId: comment.id, kind: 'feedback', excerpt: 'Webhook feedback', actor: { kind: 'guest', name: 'Guest' }, contentTrust: 'untrusted' } });
    } finally { await client.close(); await receiver.stop(); await site.close(); }
});
