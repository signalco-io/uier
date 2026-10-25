import { createHash, createHmac } from 'node:crypto';
import { EmailClient } from '@azure/communication-email';
import { EmailNotConfiguredError, showsEmailLinksOnPage, type EmailMessage } from '../email/send';

export type EmailAttempt = { operationId: string; firstSentAt: string; resumeFrom?: string };
export type TransportResult = { status: 'sent' | 'pending' | 'failed' | 'ambiguous'; resumeFrom?: string; code?: string };

/** Query the persisted ACS operation before retrying an interrupted initial request. */
async function operationStatus(connectionString: string, operationId: string, fetcher: typeof fetch): Promise<{ status: string; error?: { code?: string } } | null> {
    const endpoint = /(?:^|;)endpoint=([^;]+)/i.exec(connectionString)?.[1];
    const key = /(?:^|;)accesskey=([^;]+)/i.exec(connectionString)?.[1];
    if (!endpoint || !key) throw new EmailNotConfiguredError();
    const url = new URL(`/emails/operations/${encodeURIComponent(operationId)}?api-version=2025-09-01`, endpoint);
    const date = new Date().toUTCString();
    const contentHash = createHash('sha256').update('').digest('base64');
    const signature = createHmac('sha256', Buffer.from(key, 'base64'))
        .update(`GET\n${url.pathname}${url.search}\n${date};${url.host};${contentHash}`).digest('base64');
    const response = await fetcher(url, { headers: {
        'x-ms-date': date, 'x-ms-content-sha256': contentHash,
        Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`
    }, signal: AbortSignal.timeout(20000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`ACS status HTTP ${response.status}`);
    return await response.json() as { status: string; error?: { code?: string } };
}

/**
 * No detached promises. Persisted operation id + repeatability headers cover crash recovery.
 * ACS repeatability is five minutes. Outside that window a missing operation is ambiguous:
 * fail for operator review instead of risking a duplicate by starting a new operation.
 */
export async function deliverNotificationEmail(message: EmailMessage, attempt: EmailAttempt, retry: boolean,
    dependencies: { client?: Pick<EmailClient, 'beginSend'>; fetcher?: typeof fetch } = {}): Promise<TransportResult> {
    const connectionString = process.env.ACS_CONNECTION_STRING;
    const sender = process.env.UIER_EMAIL_SENDER;
    if (!connectionString || !sender) {
        if (!showsEmailLinksOnPage()) throw new EmailNotConfiguredError();
        return { status: 'sent', code: 'local_no_email' };
    }
    if (retry) {
        const result = await operationStatus(connectionString, attempt.operationId, dependencies.fetcher ?? fetch);
        if (result?.status === 'Succeeded') return { status: 'sent' };
        if (result?.status === 'Failed' || result?.status === 'Canceled') return { status: 'failed', code: result.error?.code ?? result.status };
        if (result) return Date.now() - Date.parse(attempt.firstSentAt) > 24 * 60 * 60 * 1000
            ? { status: 'ambiguous', code: 'operation_running_over_24_hours' } : { status: 'pending' };
        if (Date.now() - Date.parse(attempt.firstSentAt) >= 5 * 60 * 1000) return { status: 'ambiguous', code: 'operation_not_found_after_repeatability_window' };
    }
    const client = dependencies.client ?? new EmailClient(connectionString);
    const poller = await client.beginSend({ senderAddress: sender, recipients: { to: [{ address: message.to }] },
        content: { subject: message.subject, plainText: message.text, html: message.html }, disableUserEngagementTracking: true }, {
        operationId: attempt.operationId,
        abortSignal: AbortSignal.timeout(25000),
        requestOptions: { customHeaders: {
            'Repeatability-Request-Id': attempt.operationId,
            'Repeatability-First-Sent': new Date(attempt.firstSentAt).toUTCString()
        } }
    });
    const result = poller.getResult();
    return { status: result?.status === 'Succeeded' ? 'sent' : result?.status === 'Failed' || result?.status === 'Canceled' ? 'failed' : 'pending',
        resumeFrom: poller.toString(), code: result?.error?.code };
}
