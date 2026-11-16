import { createHmac, timingSafeEqual } from 'node:crypto';
import { afterResponse } from '../../afterResponse';
import { configuredAppBaseUrl } from '../../app/deployment';
import { getAppStore, type AppStore } from '../../app/store';
import { getCommentsStore, type CommentsStore } from '../../repo/commentsStore';
import { deliverThreadNow } from '../deliverNow';
import { processIntegrationDelivery } from '../delivery';
import type { IntegrationSync } from '../model';
import type { NativeReply } from '../replies';
import { slackAdapter } from './adapter';
import { isSlackConfigured, slackId, slackLabel, slackSigningSecret, slackTimestamp } from './config';
import type { SlackState } from './model';
import { findSlackThread } from './threads';

/** Slack's documented replay window for signed requests */
const MAX_SKEW_SECONDS = 5 * 60;
/** Runs after the acknowledgement, inside every route's platform limit */
const IMPORT_BUDGET_MS = 20_000;

export type SlackEventReply = { teamId: string; channelId: string; threadTs: string; reply: NativeReply };
export type SlackEventResult = { status: number; body?: string };
type SlackEventOptions = { now?: number; baseUrl?: string; store?: AppStore; comments?: CommentsStore;
    schedule?: (task: () => Promise<void>) => boolean };

/** Slack's `v0` signature: HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the app's signing secret. */
export function verifySlackSignature(raw: string, headers: Headers, secret: string, now = Date.now()) {
    const timestamp = headers.get('x-slack-request-timestamp'); const signature = headers.get('x-slack-signature');
    if (!secret || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
    if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
    const expected = createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest();
    return timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'));
}

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * A reply, edit or deletion in a thread, or null. Slack sends every message in the channels the
 * app is in; anything that is not a thread reply is dropped here, before any read or storage.
 */
export function slackEventReply(teamId: unknown, event: unknown, appId: string): SlackEventReply | null {
    const value = record(event);
    if (!slackId(teamId) || !value || value.type !== 'message' || !slackId(value.channel)) return null;
    let message: Record<string, unknown> | null; let deleted = false;
    if (value.subtype === undefined || value.subtype === 'thread_broadcast' || value.subtype === 'file_share') message = value;
    else if (value.subtype === 'message_changed') message = record(value.message);
    else if (value.subtype === 'message_deleted') {
        const previous = record(value.previous_message);
        message = previous && { ...previous, ts: value.deleted_ts }; deleted = true;
    } else return null;
    if (!message || !slackTimestamp(message.ts) || !slackTimestamp(message.thread_ts) || message.ts === message.thread_ts) return null;
    // uier's own reply copies come back as events too.
    if (message.app_id === appId || (!deleted && typeof message.text !== 'string')) return null;
    const author = slackId(message.user) ? message.user : slackId(message.bot_id) ? message.bot_id : null;
    if (!author) return null;
    const profile = record(message.user_profile) ?? {};
    const text = deleted ? '' : (message.text as string).slice(0, 40_000);
    return { teamId, channelId: value.channel, threadTs: message.thread_ts, reply: {
        id: message.ts, target: `${teamId}:${value.channel}:${message.thread_ts}`, text, fingerprint: text, own: false, authorId: author,
        // Without a profile name the adapter looks it up (users:read) or labels it in the project's language.
        authorName: slackLabel(profile.display_name) || slackLabel(profile.real_name),
        createdAt: new Date(Number(message.ts) * 1000).toISOString(), ...(deleted ? { deleted: true } : {}) } };
}

/**
 * Applies one event reply to its uier thread through the worker's status-only delivery: the same
 * lease, authority, visibility, reply-sync and channel checks as the poll, without the history read.
 * Whatever this cannot apply (a busy ledger, a missed event) the worker's poll picks up.
 */
export async function importSlackEventReply(event: SlackEventReply, options: SlackEventOptions = {}) {
    const store = options.store ?? getAppStore(); const comments = options.comments ?? getCommentsStore();
    const thread = await findSlackThread(event.teamId, event.channelId, event.threadTs, store);
    if (!thread) return false;
    const current = async () => (await store.get<IntegrationSync>(thread.ledgerPk, thread.ledgerId))?.doc;
    const ledger = await current();
    const root = (ledger?.state as SlackState | undefined)?.root;
    if (!ledger || ledger.provider !== 'slack' || ledger.projectId !== thread.projectId || ledger.workspaceId !== thread.workspaceId
        || !root || root.teamId !== event.teamId || root.channelId !== event.channelId || root.ts !== event.threadTs) return false;
    const baseUrl = options.baseUrl ?? configuredAppBaseUrl();
    if (!baseUrl) return false;
    const deadline = Date.now() + IMPORT_BUDGET_MS;
    const now = { baseUrl, deadline, store, comments };
    // A pending uier change holds status-only reads back; send it first, as the change itself would.
    await deliverThreadNow(ledger.projectId, ledger.threadId, now);
    const latest = await current();
    if (!latest) return false;
    await processIntegrationDelivery(latest, baseUrl, slackAdapter, { store, comments, deadline, statusOnly: true, pushedReplies: [event.reply] });
    // Acknowledge the import's own change so the next reply in this thread is not held back.
    await deliverThreadNow(ledger.projectId, ledger.threadId, now);
    return true;
}

/**
 * The Events API endpoint. Verifies the signature, answers Slack's URL check and acknowledges
 * events at once (Slack retries after three seconds); thread replies import after the response.
 */
export async function receiveSlackEvent(raw: string, headers: Headers, options: SlackEventOptions = {}): Promise<SlackEventResult> {
    const secret = slackSigningSecret(); const appId = process.env.SLACK_APP_ID;
    if (!secret || !appId || !isSlackConfigured()) return { status: 503 };
    if (!verifySlackSignature(raw, headers, secret, options.now)) return { status: 401 };
    let data: Record<string, unknown> | null;
    try { data = record(JSON.parse(raw)); } catch { return { status: 400 }; }
    if (!data) return { status: 400 };
    if (data.type === 'url_verification')
        return typeof data.challenge === 'string' && /^[\x21-\x7e]{1,512}$/.test(data.challenge)
            ? { status: 200, body: JSON.stringify({ challenge: data.challenge }) } : { status: 400 };
    if (data.type !== 'event_callback' || data.api_app_id !== appId) return { status: 200 };
    const reply = slackEventReply(data.team_id, data.event, appId);
    if (!reply) return { status: 200 };
    const task = async () => {
        try { await importSlackEventReply(reply, options); }
        catch (error) {
            // No identifiers, text or payloads in logs.
            console.warn(`[slack] An event reply was not imported (${error instanceof Error ? error.name : 'Error'}); the worker's poll retries.`);
        }
    };
    if (!(options.schedule ?? afterResponse)(task)) await task();
    return { status: 200 };
}
