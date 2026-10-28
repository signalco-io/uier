import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { POST } from '../app/api/email/reports/route';
import { receiveEmailReports } from '../src/lib/email/reports';
import { getAppStore } from '../src/lib/app/store';
import { emailSuppression, clearEmailSuppression, emailAddressHash, emailSuppressionPk } from '../src/lib/email/suppression';
import type { NotificationDelivery } from '../src/lib/notifications/delivery';
import { emailReport, emailReportHeaders, emailReportTestSecret, emailReportTestSubscription, emailReportTestTopic } from './support/emailReports';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_EMAIL_REPORT_MATCH_OPERATIONS = '1';
    process.env.UIER_EMAIL_REPORT_SECRET = emailReportTestSecret;
    process.env.UIER_EMAIL_REPORT_SUBSCRIPTION = emailReportTestSubscription;
    process.env.UIER_EMAIL_REPORT_TOPIC = emailReportTestTopic;
});
function request(events: unknown[], headers = emailReportHeaders) {
    return new Request('https://uier.io/api/email/reports', { method: 'POST', headers, body: JSON.stringify(events) });
}

test('receiver authenticates the expected subscription/topic and completes only its validation', async () => {
    const validation = { ...emailReport('ignored@example.com'), eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent', data: { validationCode: 'the-code', validationUrl: 'https://never-fetch.invalid' } };
    const headers = { ...emailReportHeaders, 'aeg-event-type': 'SubscriptionValidation' };
    expect((await POST(request([validation], { ...headers, 'x-uier-email-report-secret': '' }))).status).toBe(401);
    expect((await POST(request([validation], { ...headers, 'aeg-subscription-name': 'unexpected' }))).status).toBe(403);
    expect((await POST(request([{ ...validation, topic: 'unexpected' }], headers))).status).toBe(403);
    expect(await (await POST(request([validation], headers))).json()).toEqual({ validationResponse: 'the-code' });
    expect((await POST(request([validation]))).status).toBe(400);
    expect((await POST(request([validation, validation], headers))).status).toBe(400);
});

test('bounces and provider suppressions retain only hash/reason and deduplicate after confirmation', async () => {
    for (const status of ['Bounced', 'Suppressed']) {
        const address = `${randomUUID()}@example.com`;
        const event = emailReport(` ${address.toUpperCase()} `, status);
        // Real reports contain a valid address; whitespace normalization also protects store callers.
        event.data.recipient = address.toUpperCase();
        expect((await POST(request([event, event]))).status).toBe(200);
        const suppression = (await emailSuppression(` ${address} `))!;
        expect(suppression).toEqual({ id: 'suppression', pk: emailSuppressionPk(emailAddressHash(address)), type: 'email-suppression', addressHash: emailAddressHash(address), reason: status });
        await clearEmailSuppression(address);
        expect((await POST(request([event]))).status).toBe(200);
        expect(await emailSuppression(address)).toBeUndefined();
    }
});

test('failed writes are retried and unknown message ids do not acquire a ledger', async () => {
    const address = `${randomUUID()}@example.com`;
    const event = emailReport(address);
    const store = getAppStore();
    expect((await receiveEmailReports(request([event]), { ...store, createAll: async () => { throw new Error('private database details'); } })).status).toBe(503);
    expect(await emailSuppression(address)).toBeUndefined();
    expect((await POST(request([event]))).status).toBe(200);
    const failed = emailReport(`${randomUUID()}@example.com`, 'Failed');
    expect((await POST(request([failed]))).status).toBe(200);
    expect(await store.query({ type: 'notification-delivery', where: { lastOperationId: failed.data.messageId } })).toEqual([]);
    expect(await emailSuppression(failed.data.recipient)).toBeUndefined();
});

test('non-bounce reports save only a bounded code on the matching operation', async () => {
    for (const status of ['Failed', 'Quarantined', 'FilteredSpam']) {
        const event = emailReport(`${randomUUID()}@example.com`, status);
        const delivery: NotificationDelivery = { type: 'notification-delivery', id: randomUUID(), pk: `notifications:${randomUUID()}`,
            projectId: 'unused', threadId: 'unused', actorId: 'unused', requestedThrough: 1, processedThrough: 1,
            active: false, failures: 0, nextAttemptAt: new Date().toISOString(), status: 'accepted', lastOperationId: event.data.messageId };
        const store = getAppStore();
        await store.create(delivery);
        expect((await receiveEmailReports(request([event]), { ...store, replace: async () => { throw new Error('write failed'); } })).status).toBe(503);
        expect((await POST(request([event, event]))).status).toBe(200);
        expect((await store.get<NotificationDelivery>(delivery.pk, delivery.id))?.doc).toMatchObject({ lastCode: `ACSReport_${status}`, status: 'accepted' });
        expect(await emailSuppression(event.data.recipient)).toBeUndefined();
    }
});
