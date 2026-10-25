import { randomUUID } from 'node:crypto';
import type { EmailClient } from '@azure/communication-email';
import { expect, test } from '@playwright/test';
import { deliverNotificationEmail } from '../src/lib/notifications/transport';

test('ACS retries reconcile the persisted operation, preserve repeatability and stop ambiguous sends', async () => {
    const previous = { connection: process.env.ACS_CONNECTION_STRING, sender: process.env.UIER_EMAIL_SENDER };
    process.env.ACS_CONNECTION_STRING = `endpoint=https://email.example;accesskey=${Buffer.alloc(32).toString('base64')}`;
    process.env.UIER_EMAIL_SENDER = 'test@example.com';
    try {
        const message = { to: 'reviewer@example.com', subject: 'Review activity', text: 'Open thread', html: '<p>Open thread</p>' };
        const attempt = { operationId: randomUUID(), firstSentAt: new Date().toISOString() };
        let beginCalls = 0;
        const client: Pick<EmailClient, 'beginSend'> = { beginSend: async (body, options) => {
            beginCalls++;
            expect(options?.operationId).toBe(attempt.operationId);
            expect(options?.requestOptions?.customHeaders).toMatchObject({ 'Repeatability-Request-Id': attempt.operationId,
                'Repeatability-First-Sent': new Date(attempt.firstSentAt).toUTCString() });
            expect(body.disableUserEngagementTracking).toBe(true);
            return { getResult: () => undefined, toString: () => 'persisted-poller' } as unknown as Awaited<ReturnType<EmailClient['beginSend']>>;
        } };
        const fetcher: typeof fetch = async (url, options) => {
            expect(String(url)).toContain(`/emails/operations/${attempt.operationId}?api-version=2025-09-01`);
            expect(new Headers(options?.headers).get('Authorization')).toMatch(/^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=/);
            return new Response(null, { status: 404 });
        };
        expect(await deliverNotificationEmail(message, attempt, true, { client, fetcher })).toMatchObject({ status: 'pending', resumeFrom: 'persisted-poller' });
        expect(beginCalls).toBe(1);
        const expired = { ...attempt, firstSentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
        expect(await deliverNotificationEmail(message, expired, true, { client, fetcher })).toMatchObject({ status: 'ambiguous' });
        expect(beginCalls).toBe(1);
        for (const [provider, expected] of [['Succeeded', 'sent'], ['Running', 'pending'], ['Failed', 'failed']] as const) {
            expect(await deliverNotificationEmail(message, attempt, true, { client, fetcher: async () => Response.json({ status: provider }) })).toMatchObject({ status: expected });
        }
        expect(beginCalls).toBe(1);
    } finally {
        if (previous.connection === undefined) delete process.env.ACS_CONNECTION_STRING; else process.env.ACS_CONNECTION_STRING = previous.connection;
        if (previous.sender === undefined) delete process.env.UIER_EMAIL_SENDER; else process.env.UIER_EMAIL_SENDER = previous.sender;
    }
});
