/** Validate the deployed receiver without sending email or writing application data. */
export async function emailReportsReady(topic: string, credential: string, fetcher: typeof fetch = fetch) {
    const code = 'uier-email-reports-readiness';
    let response: Response;
    try {
        response = await fetcher('https://uier.io/api/email/reports', {
            method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', 'x-uier-email-report-secret': credential,
                'aeg-subscription-name': 'uier-email-delivery', 'aeg-event-type': 'SubscriptionValidation' },
            body: JSON.stringify([{ id: code, topic, eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent', data: { validationCode: code } }]),
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        throw new Error('Email report receiver readiness unavailable.');
    }
    const body = await response.json().catch(() => null) as { validationResponse?: unknown; error?: unknown } | null;
    if (!response.ok || body?.validationResponse !== code) {
        const reason = typeof body?.error === 'string' && ['unexpected_subscription', 'unexpected_validation_topic', 'unexpected_report_topic'].includes(body.error)
            ? body.error : 'invalid_validation_response';
        throw new Error(`Email report receiver readiness: HTTP ${response.status} (${reason}).`);
    }
}
