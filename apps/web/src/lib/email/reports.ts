import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getAppStore, updateDoc } from '../app/store';
import type { AppDoc } from '../app/model';
import { sha256Hex } from '../app/tokens';
import { ApiError, apiErrors, parseJsonBody } from '../comments/http';
import type { NotificationDelivery } from '../notifications/delivery';
import { emailAddressHash, emailSuppressionPk, type EmailSuppression } from './suppression';

export const EMAIL_REPORT_EVENT = 'Microsoft.Communication.EmailDeliveryReportReceived';
const validationEvent = 'Microsoft.EventGrid.SubscriptionValidationEvent';
const envelope = z.object({ id: z.string().min(1).max(256), topic: z.string().min(1).max(2048), eventType: z.string(), data: z.unknown() });
const report = z.object({ recipient: z.email().max(254), messageId: z.string().min(1).max(256),
    status: z.enum(['Delivered', 'Expanded', 'Bounced', 'Suppressed', 'Failed', 'Quarantined', 'FilteredSpam']) });
type ReportReceipt = AppDoc & { type: 'email-report-receipt'; operationHash: string };

/** No provider messages, addresses, event bodies or credentials enter logs or receipts. */
async function recordReport(event: z.infer<typeof envelope>, store: ReturnType<typeof getAppStore>) {
    const data = report.parse(event.data);
    const hash = emailAddressHash(data.recipient);
    const pk = emailSuppressionPk(hash);
    const receipt: ReportReceipt = { type: 'email-report-receipt', pk, id: `report_${sha256Hex(`${event.topic}:${event.id}`)}`, operationHash: sha256Hex(data.messageId), ttl: 30 * 86400 };
    if (await store.get(pk, receipt.id)) return;
    if (data.status === 'Bounced' || data.status === 'Suppressed') {
        const suppression: EmailSuppression = { type: 'email-suppression', pk, id: 'suppression', addressHash: hash, reason: data.status };
        // First suppression and its receipt commit together. Existing suppression needs no update.
        if (await store.createAll([suppression, receipt])) return;
        if (await store.get(pk, receipt.id)) return;
        if (!await store.get(pk, suppression.id)) throw new Error('Suppression changed during report');
    } else if (process.env.UIER_EMAIL_REPORT_MATCH_OPERATIONS === '1' && ['Failed', 'Quarantined', 'FilteredSpam'].includes(data.status)) {
        // Unknown operations include sign-in/invitation/confirmation mail and are acknowledged.
        // A later attempt must never acquire the earlier operation's failure code.
        const deliveries = await store.query<NotificationDelivery>({ type: 'notification-delivery', where: { lastOperationId: data.messageId } });
        for (const delivery of deliveries) await updateDoc<NotificationDelivery>(delivery.pk, delivery.id, current =>
            current.lastOperationId === data.messageId ? { ...current, lastCode: `ACSReport_${data.status}` } : current, store);
    }
    await store.create(receipt);
}

/** Credentials and subscription/topic identity are checked before parsing any report. */
export async function receiveEmailReports(request: Request, store = getAppStore()) {
    const headers = { 'Cache-Control': 'no-store' };
    try {
        const secret = process.env.UIER_EMAIL_REPORT_SECRET;
        const subscription = process.env.UIER_EMAIL_REPORT_SUBSCRIPTION;
        const topic = process.env.UIER_EMAIL_REPORT_TOPIC;
        if (!secret || !subscription || !topic) return new Response(null, { status: 503, headers });
        const actual = Buffer.from(request.headers.get('x-uier-email-report-secret') ?? '');
        const expected = Buffer.from(secret);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response(null, { status: 401, headers });
        if (request.headers.get('aeg-subscription-name') !== subscription) {
            console.warn('[email-reports] unexpected_subscription');
            return Response.json({ error: 'unexpected_subscription' }, { status: 403, headers });
        }
        const events = await parseJsonBody(request, z.array(envelope).min(1).max(100), 256 * 1024);
        if (request.headers.get('aeg-event-type') === 'SubscriptionValidation') {
            // The per-subscription secret and exact subscription name authenticate this
            // handshake. Azure's validation topic metadata varies by source; it is not identity.
            if (events.length !== 1 || events[0]!.eventType !== validationEvent) throw apiErrors.invalidRequest('Invalid validation event.');
            const { validationCode } = z.object({ validationCode: z.string().min(1).max(256) }).parse(events[0]!.data);
            return Response.json({ validationResponse: validationCode }, { headers });
        }
        if (events.some(event => event.topic.toLowerCase() !== topic.toLowerCase())) {
            console.warn('[email-reports] unexpected_report_topic');
            return Response.json({ error: 'unexpected_report_topic' }, { status: 403, headers });
        }
        if (request.headers.get('aeg-event-type') !== 'Notification' || events.some(event => event.eventType !== EMAIL_REPORT_EVENT))
            throw apiErrors.invalidRequest('Invalid report event.');
        // Validate the whole batch before writing. A failed write returns 503 for Event Grid retry.
        events.forEach(event => report.parse(event.data));
        for (const event of events) await recordReport(event, store);
        return new Response(null, { status: 200, headers });
    } catch (error) {
        const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 503;
        return new Response(null, { status, headers });
    }
}
