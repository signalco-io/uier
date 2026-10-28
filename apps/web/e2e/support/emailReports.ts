import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

export const emailReportTestSecret = 'e2e-email-report-secret';
export const emailReportTestTopic = '/subscriptions/test/resourceGroups/test/providers/Microsoft.Communication/communicationServices/test';
export const emailReportTestSubscription = 'uier-email-delivery';
export const emailReportHeaders = {
    'x-uier-email-report-secret': emailReportTestSecret,
    'aeg-subscription-name': emailReportTestSubscription,
    'aeg-event-type': 'Notification',
    'Content-Type': 'application/json',
};
export function emailReport(recipient: string, status = 'Bounced', messageId: string = randomUUID()) {
    return { id: randomUUID(), topic: emailReportTestTopic, eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
        data: { recipient, status, messageId, deliveryStatusDetails: { statusMessage: 'Must never be persisted or logged' } } };
}
export async function seedEmailBounce(request: APIRequestContext, recipient: string) {
    const response = await request.post('/api/email/reports', { headers: emailReportHeaders, data: [emailReport(recipient)] });
    expect(response.status()).toBe(200);
}
