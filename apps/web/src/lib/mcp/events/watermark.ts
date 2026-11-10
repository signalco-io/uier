import type { AppDoc } from '../../app/model';
import type { AppStore } from '../../app/store';
import type { NotificationEvent } from '../../notifications/delivery';
import type { McpEventName } from './catalog';
import type { McpEventSubscription } from './subscriptions';
import type { CallbackFailure } from './webhook';

/*
 * The position of a webhook subscription (SEP-3415's safe-to-persist watermark): every event at or
 * before it was acknowledged by the endpoint or given up on. It is computed, never stored: from the
 * project's discovery cursor (how far events are known) and the subscription's deliveries that are
 * still waiting. A subscribe or refresh returns it and every delivery carries it, so a client that
 * subscribes again with it loses nothing and repeats little.
 */

/**
 * `floor`: list threads written at or after it; after a finished scan, also the time up to which
 * every event has its delivery records. `eventFloor`: while a scan is unfinished, the floor it
 * started from; a thread rewritten later is listed on a later page, and its earlier events still count.
 */
export type McpEventCursor = AppDoc & { type: 'mcp-event-cursor'; projectId: string; floor: number; eventFloor?: number; lease?: { id: string; until: number } };
export const cursorId = 'cursor';

export type McpEventDelivery = AppDoc & {
    type: 'mcp-event-delivery';
    projectId: string;
    subscriptionId: string;
    eventId: string;
    name: McpEventName;
    threadId: string;
    sequence: number;
    eventKind: NotificationEvent['kind'];
    eventAt: string;
    agentId?: string;
    /** The Standard Webhooks `webhook-id` of this message, reused by every retry (missing on records from before it existed) */
    webhookId?: string;
    active: boolean;
    status: 'queued' | 'delivered' | 'failed' | 'skipped';
    attempts: number;
    nextAttemptAt: string;
    lease?: { id: string; until: string };
    lastError?: CallbackFailure;
    deliveredAt?: string;
};

/** Waiting deliveries read for one position; a longer backlog keeps the position at the subscription's start. */
const MAX_WAITING = 1000;

/** What a subscription's position is computed from; `waiting` changes as a dispatch delivers. */
export type SubscriptionPosition = { discoveredTo: number; waiting: Map<string, number>; unknown: boolean };

export async function loadSubscriptionPosition(store: AppStore, subscription: McpEventSubscription): Promise<SubscriptionPosition> {
    const [cursor, waiting] = await Promise.all([
        store.get<McpEventCursor>(subscription.pk, cursorId),
        store.query<McpEventDelivery>({ type: 'mcp-event-delivery', pk: subscription.pk, where: { subscriptionId: subscription.id, active: true }, limit: MAX_WAITING })]);
    return { discoveredTo: cursor ? Math.min(cursor.doc.floor, cursor.doc.eventFloor ?? cursor.doc.floor) : 0,
        waiting: new Map(waiting.map(delivery => [delivery.id, Date.parse(delivery.eventAt)])), unknown: waiting.length >= MAX_WAITING };
}

/** The event time (ms) up to which nothing is left to deliver: never before the subscription's own start. */
export function subscriptionWatermark(subscription: McpEventSubscription, position: SubscriptionPosition) {
    const start = Date.parse(subscription.since) - 1;
    // Earlier events are still being looked up (replay), or too many wait to know the oldest.
    if (subscription.replay || position.unknown) return start;
    let watermark = position.discoveredTo;
    for (const at of position.waiting.values()) watermark = Math.min(watermark, at - 1);
    return Math.max(start, watermark);
}
