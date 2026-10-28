import assert from 'node:assert/strict';
import test from 'node:test';
import { emailReportsReady } from '../dist/emailReportsReady.js';

test('readiness performs only an authenticated validation and validates its echo', async () => {
    await emailReportsReady('/subscriptions/test/resource', 'private-test-credential', async (url, request) => {
        assert.equal(url, 'https://uier.io/api/email/reports');
        assert.equal(request.redirect, 'error');
        assert.equal(request.headers['x-uier-email-report-secret'], 'private-test-credential');
        assert.equal(request.headers['aeg-subscription-name'], 'UIER-EMAIL-DELIVERY');
        const [event] = JSON.parse(request.body);
        assert.equal(event.eventType, 'Microsoft.EventGrid.SubscriptionValidationEvent');
        assert.equal(event.data.recipient, undefined);
        return Response.json({ validationResponse: event.data.validationCode });
    });
    await assert.rejects(emailReportsReady('/subscriptions/test/resource', 'private-test-credential', async () =>
        Response.json({ error: 'unexpected_subscription' }, { status: 403 })), /HTTP 403 \(unexpected_subscription\)/);
    await assert.rejects(emailReportsReady('/subscriptions/test/resource', 'private-test-credential', async () => {
        throw new Error('private credential details');
    }), /^Error: Email report receiver readiness unavailable\.$/);
    await assert.rejects(emailReportsReady('/subscriptions/test/resource', 'private-test-credential', async () =>
        new Response('private provider details', { status: 401 })), error =>
        /HTTP 401 \(invalid_validation_response\)/.test(error.message) && !error.message.includes('private'));
});
