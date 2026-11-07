import { randomUUID } from 'node:crypto';
import type { AppDoc, DbProject } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { findProject } from '../../app/projects';
import type { DbComment } from '../../db/schema';
import type { NotificationEvent } from '../../notifications/delivery';
import { getCommentsStore, type CommentsStore } from '../../repo/commentsStore';
import { canSeeComment, projectPartition } from '../../review/comments';
import { participantNames } from '../../review/dto';
import { currentMcpConnection, mcpProject, type McpIdentity } from '../credentials';
import { eventMatches, mcpEventData, mcpEventId, type McpEventName } from './catalog';
import { activeProjectSubscriptions, eventsPk, isSubscriptionActive, subscriptionSecrets, type McpEventSubscription } from './subscriptions';
import { MAX_WEBHOOK_BODY_BYTES, postWebhook, responseFailure, type CallbackFailure, type WebhookPost } from './webhook';

/*
 * Delivery of MCP events. Discovery scans the project's threads written since its cursor and
 * creates one delivery record per (subscription, event): the deterministic id makes overlapping
 * scans and concurrent dispatchers harmless. Each attempt runs under a lease, rechecks the
 * connection, project access and thread visibility, and builds the payload from the thread as
 * it is then. Delivery is at least once with bounded retries; there is no replay cursor.
 */

/** Overlap between scans: covers a write committed late after its event time and clock skew. */
const SETTLE_MS = 60_000;
/** An event's time precedes its commit by at most the request limit (30 seconds). */
const COMMIT_LAG_MS = 30_000;
const SCAN_PAGE = 200;
const MAX_SCAN_PAGE = 1000;
const LEASE_MS = 60_000;
const DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Delay before the 2nd, 3rd, 4th and 5th attempt; then the delivery fails. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const MAX_DUE_PER_DISPATCH = 50;

/**
 * `floor`: list threads written at or after it. `eventFloor`: while a scan is unfinished, the floor it
 * started from; a thread rewritten later is listed on a later page, and its earlier events still count.
 */
type McpEventCursor = AppDoc & { type: 'mcp-event-cursor'; projectId: string; floor: number; eventFloor?: number; lease?: { id: string; until: number } };
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
    active: boolean;
    status: 'queued' | 'delivered' | 'failed' | 'skipped';
    attempts: number;
    nextAttemptAt: string;
    lease?: { id: string; until: string };
    lastError?: CallbackFailure;
    deliveredAt?: string;
};

export type DispatchOptions = {
    /** Base URL for thread links; links are omitted without one */
    baseUrl?: string;
    /** Absolute wall-clock time (ms) after which no new work starts */
    deadline?: number;
    post?: WebhookPost;
    /** Clock for delivery due times and expiry (tests); discovery and deadlines use the wall clock */
    now?: () => number;
    store?: AppStore;
    comments?: CommentsStore;
};
export type DispatchResult = { discovered: number; delivered: number; failed: number; skipped: number; retrying: number };

const cursorId = 'cursor';
const deliveryId = (subscriptionId: string, eventId: string) => `dlv_${subscriptionId.slice(4)}_${eventId.slice(4)}`;
const iso = (time: number) => new Date(time).toISOString();

/**
 * Creates delivery records for new events of the project's threads. Returns how many were new.
 * Scan positions compare with storage write times, so they always use the wall clock.
 */
async function discover(project: DbProject, subscriptions: McpEventSubscription[], options: Required<Pick<DispatchOptions, 'store' | 'comments'>> & { deadline: number }) {
    const { store, comments } = options;
    const now = Date.now;
    const pk = eventsPk(project.id);
    const earliest = Math.min(...subscriptions.map(subscription => Date.parse(subscription.since)));
    let stored = await store.get<McpEventCursor>(pk, cursorId);
    if (!stored) {
        await store.create<McpEventCursor>({ type: 'mcp-event-cursor', pk, id: cursorId, projectId: project.id, floor: earliest - SETTLE_MS });
        stored = await store.get<McpEventCursor>(pk, cursorId);
    }
    // One discoverer per project at a time; another one finishing its scan covers this change too.
    for (let attempt = 0; stored && stored.doc.lease && stored.doc.lease.until > now() && attempt < 4 && now() < options.deadline; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        stored = await store.get<McpEventCursor>(pk, cursorId);
    }
    if (!stored || (stored.doc.lease && stored.doc.lease.until > now())) return 0;
    const lease = { id: randomUUID(), until: now() + LEASE_MS };
    if (await store.replace<McpEventCursor>({ ...stored.doc, lease }, stored.etag) !== 'ok') return 0;

    const scanStart = now();
    let floor = Math.max(stored.doc.floor, earliest - SETTLE_MS);
    const eventFloor = Math.min(floor, stored.doc.eventFloor ?? floor);
    let complete = false;
    let created = 0;
    try {
        let limit = SCAN_PAGE;
        while (now() < options.deadline) {
            const page = await comments.listChangedSince(projectPartition(project.id), floor, limit);
            for (const { comment } of page) created += await discoverThread(project, comment, subscriptions, eventFloor, store, now());
            if (page.length < limit) { complete = true; break; }
            const first = page[0]!.changedAt;
            const last = page.at(-1)!.changedAt;
            // Write times have second precision: the next page starts at the last second again.
            if (last > first) { floor = last; limit = SCAN_PAGE; continue; }
            // One second's writes fill the page: read that second whole, then move past it. Beyond
            // the store's maximum per second (rate limits prevent it), the rest of that second is skipped.
            if (limit < MAX_SCAN_PAGE) { limit = MAX_SCAN_PAGE; continue; }
            floor = last + 1000;
            limit = SCAN_PAGE;
        }
    } finally {
        await updateDoc<McpEventCursor>(pk, cursorId, current => {
            if (current.lease?.id !== lease.id) return current;
            const { lease: _lease, eventFloor: _eventFloor, ...rest } = current;
            return complete ? { ...rest, floor: scanStart - SETTLE_MS } : { ...rest, floor, eventFloor };
        }, store).catch(() => undefined);
    }
    return created;
}

async function discoverThread(project: DbProject, comment: DbComment, subscriptions: McpEventSubscription[], floor: number, store: AppStore, now: number) {
    let created = 0;
    for (const event of comment.notificationEvents ?? []) {
        const at = Date.parse(event.at);
        if (!(at >= floor - COMMIT_LAG_MS)) continue;
        for (const subscription of subscriptions) {
            // Never echo a connection's own actions back to it: that loops an agent on its replies.
            if (at < Date.parse(subscription.since) || !isSubscriptionActive(subscription, now) || event.agent?.credentialId === subscription.connectionId
                || !eventMatches(subscription.name, subscription.arguments, event, comment.id, subscription.userId)) continue;
            const eventId = mcpEventId(project.id, comment.id, event, subscription.name);
            const delivery: McpEventDelivery = {
                type: 'mcp-event-delivery', pk: eventsPk(project.id), id: deliveryId(subscription.id, eventId), projectId: project.id,
                subscriptionId: subscription.id, eventId, name: subscription.name, threadId: comment.id, sequence: event.sequence,
                eventKind: event.kind, eventAt: event.at, active: true, status: 'queued', attempts: 0, nextAttemptAt: iso(now),
                ttl: DELIVERY_TTL_SECONDS
            };
            if (await store.create(delivery)) created++;
        }
    }
    return created;
}

type Context = {
    project: DbProject;
    options: Required<Pick<DispatchOptions, 'now' | 'store' | 'comments' | 'post'>> & { baseUrl?: string; deadline: number };
    /** This dispatch only: each subscription's connection, resolved once per run and never across requests */
    identities: Map<string, Promise<McpIdentity | null>>;
    participants?: Promise<Map<string, string>>;
};

async function finish(context: Context, delivery: McpEventDelivery, lease: string, patch: Partial<McpEventDelivery>) {
    await updateDoc<McpEventDelivery>(delivery.pk, delivery.id, current => {
        if (current.lease?.id !== lease) return current;
        const { lease: _lease, ...rest } = current;
        return { ...rest, ...patch };
    }, context.options.store);
}

/** The subscription remembers only the latest outcome, written when it changes or at most once a minute. */
async function noteOutcome(context: Context, subscription: McpEventSubscription, failure: CallbackFailure | null) {
    const now = context.options.now();
    if (!failure && !subscription.lastError && subscription.lastDeliveryAt && now - Date.parse(subscription.lastDeliveryAt) < 60_000) return;
    if (failure && subscription.lastError === failure) return;
    await updateDoc<McpEventSubscription>(subscription.pk, subscription.id, current => {
        const next = { ...current };
        if (failure) { next.lastError = failure; next.failedSince ??= iso(now); }
        else { next.lastDeliveryAt = iso(now); delete next.lastError; delete next.failedSince; }
        return next;
    }, context.options.store).catch(() => undefined);
}

/** Access ended: the subscription ends with it. Clients that refresh it get Forbidden. */
async function terminate(context: Context, subscription: McpEventSubscription) {
    await context.options.store.delete(subscription.pk, subscription.id);
}

async function deliver(context: Context, candidate: McpEventDelivery): Promise<'delivered' | 'failed' | 'skipped' | 'retrying' | null> {
    const { store, comments, now, post } = context.options;
    const stored = await store.get<McpEventDelivery>(candidate.pk, candidate.id);
    if (!stored || !stored.doc.active || Date.parse(stored.doc.nextAttemptAt) > now()
        || (stored.doc.lease && Date.parse(stored.doc.lease.until) > now())) return null;
    const lease = { id: randomUUID(), until: iso(now() + LEASE_MS) };
    if (await store.replace<McpEventDelivery>({ ...stored.doc, lease }, stored.etag) !== 'ok') return null;
    const delivery = stored.doc;
    const skip = async () => { await finish(context, delivery, lease.id, { active: false, status: 'skipped' }); return 'skipped' as const; };

    const subscription = (await store.get<McpEventSubscription>(delivery.pk, delivery.subscriptionId))?.doc;
    if (!subscription || !isSubscriptionActive(subscription, now())) return skip();
    const key = `${subscription.userId}:${subscription.connectionId}`;
    if (!context.identities.has(key)) context.identities.set(key, currentMcpConnection(subscription.userId, subscription.connectionId, subscription.connectionKind));
    const identity = await context.identities.get(key)!;
    let actor;
    try { actor = identity ? (await mcpProject(identity, subscription.projectId)).actor : null; }
    catch { actor = null; }
    if (!identity || !actor) { await terminate(context, subscription); return skip(); }
    const comment = (await comments.get(projectPartition(context.project.id), delivery.threadId))?.comment;
    const event = comment?.notificationEvents?.find(entry => entry.sequence === delivery.sequence && entry.kind === delivery.eventKind && entry.at === delivery.eventAt);
    // A deleted thread, or one the account can no longer see, is not delivered.
    if (!comment || !event || !canSeeComment(comment, actor)) return skip();

    context.participants ??= participantNames(context.project);
    const body = JSON.stringify({ eventId: delivery.eventId, name: delivery.name, timestamp: event.at,
        data: mcpEventData(delivery.name, context.project, comment, event, await context.participants, context.options.baseUrl), cursor: null });
    let secrets: string[];
    try { secrets = subscriptionSecrets(subscription, now()); }
    // The server secret changed: the client's next refresh stores its secret again.
    catch { return skip(); }
    if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES) { await finish(context, delivery, lease.id, { active: false, status: 'failed' }); return 'failed'; }
    const remaining = context.options.deadline - Date.now();
    const response = await post({ url: subscription.url, webhookId: delivery.eventId, subscriptionId: subscription.id, body, secrets,
        timeoutMs: Math.max(1000, remaining) });
    const failure = 'failure' in response ? response.failure : responseFailure(response.status);
    await noteOutcome(context, subscription, failure);
    if (!failure) {
        await finish(context, delivery, lease.id, { active: false, status: 'delivered', attempts: delivery.attempts + 1, deliveredAt: iso(now()) });
        return 'delivered';
    }
    const attempts = delivery.attempts + 1;
    // 410 and 413 mean the receiver does not want this event again.
    const final = ('status' in response && (response.status === 410 || response.status === 413)) || attempts > RETRY_DELAYS_MS.length;
    await finish(context, delivery, lease.id, final ? { active: false, status: 'failed', attempts, lastError: failure }
        : { status: 'queued', attempts, lastError: failure, nextAttemptAt: iso(now() + RETRY_DELAYS_MS[attempts - 1]!) });
    return final ? 'failed' : 'retrying';
}

/**
 * Discovers and delivers the project's due events within the deadline. Safe to run concurrently
 * (after a change and from the scheduled worker): records and attempts are leased.
 */
export async function dispatchProjectEvents(projectId: string, options: DispatchOptions = {}): Promise<DispatchResult> {
    const resolved = { now: options.now ?? Date.now, store: options.store ?? getAppStore(), comments: options.comments ?? getCommentsStore(),
        post: options.post ?? postWebhook, baseUrl: options.baseUrl, deadline: options.deadline ?? Date.now() + 10_000 };
    const result: DispatchResult = { discovered: 0, delivered: 0, failed: 0, skipped: 0, retrying: 0 };
    const subscriptions = await activeProjectSubscriptions(projectId, resolved.store, resolved.now());
    // Without a live subscription nothing is delivered; leftover records expire with their TTL.
    if (!subscriptions.length) return result;
    const project = await findProject(projectId);
    if (!project) return result;
    result.discovered = await discover(project, subscriptions, resolved);
    const context: Context = { project, options: resolved, identities: new Map() };
    const due = await resolved.store.query<McpEventDelivery>({ type: 'mcp-event-delivery', pk: eventsPk(projectId), where: { active: true },
        dueBefore: iso(resolved.now()), orderBy: 'nextAttemptAt', limit: MAX_DUE_PER_DISPATCH });
    for (const delivery of due) {
        // Leave at least a second for the request; the rest waits for the next dispatch.
        if (resolved.deadline - Date.now() < 2000) break;
        const outcome = await deliver(context, delivery);
        if (outcome) result[outcome]++;
    }
    return result;
}

/** Scheduled sweep: every project with a live subscription, within the deadline. */
export async function runMcpEventWorker(baseUrl: string | undefined, options: Omit<DispatchOptions, 'baseUrl'> & { deadline: number }) {
    const store = options.store ?? getAppStore();
    const now = options.now ?? Date.now;
    const projects = [...new Set((await store.query<McpEventSubscription>({ type: 'mcp-event-subscription' }))
        .filter(subscription => isSubscriptionActive(subscription, now())).map(subscription => subscription.projectId))];
    const total: DispatchResult & { projects: number; deferred: number } = { discovered: 0, delivered: 0, failed: 0, skipped: 0, retrying: 0, projects: 0, deferred: 0 };
    for (const projectId of projects) {
        if (options.deadline - Date.now() < 5000) { total.deferred++; continue; }
        const result = await dispatchProjectEvents(projectId, { ...options, store, baseUrl });
        total.projects++;
        for (const key of ['discovered', 'delivered', 'failed', 'skipped', 'retrying'] as const) total[key] += result[key];
    }
    return total;
}
