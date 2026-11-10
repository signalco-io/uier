import { randomBytes, randomUUID } from 'node:crypto';
import type { DbProject } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { findProject } from '../../app/projects';
import type { DbComment } from '../../db/schema';
import { getCommentsStore, type CommentsStore } from '../../repo/commentsStore';
import { canSeeComment, projectPartition } from '../../review/comments';
import { participantNames } from '../../review/dto';
import { currentMcpConnection, type McpIdentity } from '../credentials';
import { eventMatches, mcpEventData, mcpEventId } from './catalog';
import { watermarkCursor } from './feed';
import { activeProjectSubscriptions, currentEventAccess, eventsPk, isSubscriptionActive, mcpEventErrorCodes, subscriptionSecrets, type McpEventSubscription } from './subscriptions';
import { cursorId, loadSubscriptionPosition, subscriptionWatermark, type McpEventCursor, type McpEventDelivery, type SubscriptionPosition } from './watermark';
import { MAX_WEBHOOK_BODY_BYTES, postWebhook, responseFailure, type CallbackFailure, type WebhookPost } from './webhook';

export type { McpEventDelivery } from './watermark';

/*
 * Delivery of MCP events. Discovery scans the project's threads written since its cursor and
 * creates one delivery record per (subscription, event): the deterministic id makes overlapping
 * scans and concurrent dispatchers harmless. Each attempt runs under a lease, rechecks the
 * connection, project access and thread visibility, and builds the payload from the thread as
 * it is then. Delivery is at least once with bounded retries. Each delivery has its own random
 * `webhook-id` (SEP-3415: never derived from `eventId`), kept across retries, and carries the
 * subscription's position as `cursor` (`watermark.ts`). A subscription that began from a cursor has
 * its earlier events looked up by its own scan (replay). When an event had to be given up, the
 * subscription is marked and its endpoint gets a signed `gap` envelope once it answers again. An
 * endpoint that fails for an hour suspends its subscription until the next refresh. A
 * subscription whose access ended gets a signed `terminated` envelope and is removed.
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
/** An endpoint that only failed for this long, over at least this many attempts, is suspended until its client refreshes the subscription. */
const SUSPEND_AFTER_MS = 60 * 60_000;
const SUSPEND_MIN_FAILURES = 10;
/** A suspended subscription's deliveries wait and are looked at again this often; waiting uses up none of their attempts. */
const SUSPENDED_RECHECK_MS = 15 * 60_000;

export type DispatchOptions = {
    /** Base URL for thread links; links are omitted without one */
    baseUrl?: string;
    /** Absolute wall-clock time (ms) after which no new work starts */
    deadline?: number;
    post?: WebhookPost;
    /** Clock for delivery due times and expiry (tests); discovery and deadlines use the wall clock */
    now?: () => number;
    /** Recheck every subscription's access before delivering (the scheduled sweep), not only on delivery */
    recheckAccess?: boolean;
    store?: AppStore;
    comments?: CommentsStore;
};
export type DispatchResult = { discovered: number; delivered: number; failed: number; skipped: number; retrying: number; terminated: number };

const deliveryId = (subscriptionId: string, eventId: string) => `dlv_${subscriptionId.slice(4)}_${eventId.slice(4)}`;
/** High-entropy and header-safe (letters, digits, `_` and `-`); `msg_<type>_…` for control envelopes */
const newWebhookId = (type?: 'terminated' | 'gap') => `msg_${type ? `${type}_` : ''}${randomBytes(18).toString('base64url')}`;
const iso = (time: number) => new Date(time).toISOString();

/**
 * Creates delivery records for new events of the project's threads. Returns how many were new.
 * Scan positions compare with storage write times, so they always use the wall clock.
 */
async function discover(project: DbProject, subscriptions: McpEventSubscription[], options: Required<Pick<DispatchOptions, 'store' | 'comments'>> & { deadline: number }) {
    const { store, comments } = options;
    const now = Date.now;
    const pk = eventsPk(project.id);
    // A subscription that replays has its own scan for what came before it existed.
    const earliest = Math.min(...subscriptions.map(subscription => Date.parse(subscription.replay ? subscription.createdAt : subscription.since)));
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
    const scan: Scan = { floor: Math.max(stored.doc.floor, earliest - SETTLE_MS), complete: false, skipped: false };
    const eventFloor = Math.min(scan.floor, stored.doc.eventFloor ?? scan.floor);
    let created = 0;
    try {
        await scanThreads(comments, project, scan, options.deadline, async comment => { created += await discoverThread(project, comment, subscriptions, eventFloor, store, now()); });
        if (scan.skipped) await Promise.all(subscriptions.map(subscription => markGap(store, subscription)));
    } finally {
        await updateDoc<McpEventCursor>(pk, cursorId, current => {
            if (current.lease?.id !== lease.id) return current;
            const { lease: _lease, eventFloor: _eventFloor, ...rest } = current;
            return scan.complete ? { ...rest, floor: scanStart - SETTLE_MS } : { ...rest, floor: scan.floor, eventFloor };
        }, store).catch(() => undefined);
    }
    return created;
}

type Scan = { floor: number; complete: boolean; skipped: boolean };

/** Visits the threads written at or after `scan.floor`, oldest write first, until none are left or the deadline passes; `scan` keeps the progress. */
async function scanThreads(comments: CommentsStore, project: DbProject, scan: Scan, deadline: number, visit: (comment: DbComment) => Promise<void>) {
    let limit = SCAN_PAGE;
    while (Date.now() < deadline) {
        const page = await comments.listChangedSince(projectPartition(project.id), scan.floor, limit);
        for (const { comment } of page) await visit(comment);
        if (page.length < limit) { scan.complete = true; return; }
        const first = page[0]!.changedAt;
        const last = page.at(-1)!.changedAt;
        // Write times have second precision: the next page starts at the last second again.
        if (last > first) { scan.floor = last; limit = SCAN_PAGE; continue; }
        // One second's writes fill the page: read that second whole, then move past it. Beyond
        // the store's maximum per second (rate limits prevent it), the rest of that second is skipped.
        if (limit < MAX_SCAN_PAGE) { limit = MAX_SCAN_PAGE; continue; }
        scan.floor = last + 1000;
        scan.skipped = true;
        limit = SCAN_PAGE;
    }
}

/**
 * Replay: a subscription that began from a cursor gets the events since that position that discovery
 * passed before it existed. Its own scan, so no other subscription sees an old event twice; the
 * progress is kept on the subscription and a later dispatch continues it.
 */
async function replaySubscription(project: DbProject, subscription: McpEventSubscription, options: Required<Pick<DispatchOptions, 'store' | 'comments'>> & { deadline: number }) {
    const { store, comments } = options;
    const scan: Scan = { floor: subscription.replay!.floor, complete: false, skipped: false };
    let created = 0;
    try {
        await scanThreads(comments, project, scan, options.deadline, async comment => {
            created += await discoverThread(project, comment, [subscription], Date.parse(subscription.since) + COMMIT_LAG_MS, store, Date.now());
        });
    } finally {
        const saved = await updateDoc<McpEventSubscription>(subscription.pk, subscription.id, current => {
            const { replay: _replay, ...rest } = current;
            return { ...rest, ...(scan.complete ? {} : { replay: { floor: scan.floor } }), ...(scan.skipped ? { gap: true as const } : {}) };
        }, store).catch(() => null);
        if (saved) { if (saved.replay) subscription.replay = saved.replay; else delete subscription.replay; }
    }
    return created;
}

/** Events of this subscription were skipped: its next refresh says `truncated`, and its endpoint is told when it answers. */
async function markGap(store: AppStore, subscription: McpEventSubscription) {
    if (subscription.gap) return;
    subscription.gap = true;
    await updateDoc<McpEventSubscription>(subscription.pk, subscription.id, current => current.gap ? current : { ...current, gap: true }, store).catch(() => undefined);
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
                eventKind: event.kind, eventAt: event.at, ...(event.agentId ? { agentId: event.agentId } : {}), webhookId: newWebhookId(),
                active: true, status: 'queued', attempts: 0, nextAttemptAt: iso(now),
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
    /** This dispatch only: what each subscription's position is computed from, updated as its deliveries finish */
    positions: Map<string, Promise<SubscriptionPosition>>;
    participants?: Promise<Map<string, string>>;
};

async function finish(context: Context, delivery: McpEventDelivery, lease: string, patch: Partial<McpEventDelivery>) {
    await updateDoc<McpEventDelivery>(delivery.pk, delivery.id, current => {
        if (current.lease?.id !== lease) return current;
        const { lease: _lease, ...rest } = current;
        return { ...rest, ...patch };
    }, context.options.store);
    // A delivery that is over no longer holds the subscription's position back.
    if (patch.active === false) (await context.positions.get(delivery.subscriptionId))?.waiting.delete(delivery.id);
}

/** The subscription's position now: nothing at or before it is left to deliver. */
async function position(context: Context, subscription: McpEventSubscription) {
    if (!context.positions.has(subscription.id)) context.positions.set(subscription.id, loadSubscriptionPosition(context.options.store, subscription));
    return watermarkCursor(subscriptionWatermark(subscription, await context.positions.get(subscription.id)!));
}

/**
 * Tells the endpoint that events were skipped (a signed `gap` envelope with the position to continue
 * from). Sent when the endpoint is known to answer; until it is acknowledged the subscription stays marked.
 */
async function sendGap(context: Context, subscription: McpEventSubscription) {
    const { store, post, now } = context.options;
    const remaining = context.options.deadline - Date.now();
    if (remaining < 1000) return;
    let secrets: string[];
    try { secrets = subscriptionSecrets(subscription, now()); } catch { return; }
    const response = await post({ url: subscription.url, webhookId: newWebhookId('gap'), subscriptionId: subscription.id,
        body: JSON.stringify({ type: 'gap', cursor: await position(context, subscription) }), secrets, timeoutMs: remaining }).catch(() => null);
    if (!response || 'failure' in response || responseFailure(response.status)) return;
    await updateDoc<McpEventSubscription>(subscription.pk, subscription.id, current => { const { gap: _gap, ...rest } = current; return rest; }, store).catch(() => undefined);
}

/**
 * The subscription remembers the latest outcome (a success at most once a minute) and how long its
 * endpoint has only failed. After an hour of nothing but failures, over ten attempts or more, it is
 * suspended: its deliveries wait instead of failing, until the client's next refresh.
 */
async function noteOutcome(context: Context, subscription: McpEventSubscription, failure: CallbackFailure | null) {
    const now = context.options.now();
    if (!failure && !subscription.lastError && !subscription.failures && subscription.lastDeliveryAt && now - Date.parse(subscription.lastDeliveryAt) < 60_000) return;
    await updateDoc<McpEventSubscription>(subscription.pk, subscription.id, current => {
        const next = { ...current };
        if (failure) {
            next.lastError = failure;
            next.failedSince ??= iso(now);
            next.failures = (current.failures ?? 0) + 1;
            if (!next.suspendedAt && next.failures >= SUSPEND_MIN_FAILURES && now - Date.parse(next.failedSince) >= SUSPEND_AFTER_MS) next.suspendedAt = iso(now);
        } else { next.lastDeliveryAt = iso(now); delete next.lastError; delete next.failedSince; delete next.failures; delete next.suspendedAt; }
        return next;
    }, context.options.store).catch(() => undefined);
}

/**
 * The member actor a subscription delivers as, or `null` when its access has ended (see
 * `currentEventAccess`). Other failures throw, so they never end it.
 */
async function subscriberActor(context: Context, subscription: McpEventSubscription) {
    const key = `${subscription.userId}:${subscription.connectionId}`;
    const connection = { userId: subscription.userId, connectionId: subscription.connectionId, kind: subscription.connectionKind };
    if (!context.identities.has(key)) context.identities.set(key, currentMcpConnection(connection.userId, connection.connectionId, connection.kind));
    return (await currentEventAccess(connection, subscription.projectId, () => context.identities.get(key)!))?.actor ?? null;
}

/**
 * Access ended: the subscription ends with it, and its endpoint gets a signed `terminated` envelope
 * (once, best effort). Clients that refresh it get Forbidden.
 */
async function terminate(context: Context, subscription: McpEventSubscription) {
    const { store, post, now } = context.options;
    // Only the dispatcher that removes the subscription tells the endpoint.
    if (!await store.delete(subscription.pk, subscription.id)) return;
    let secrets: string[];
    try { secrets = subscriptionSecrets(subscription, now()); }
    catch { return; }
    const remaining = context.options.deadline - Date.now();
    if (remaining < 1000) return;
    const body = JSON.stringify({ type: 'terminated', error: { code: mcpEventErrorCodes.forbidden, message: 'Forbidden', data: { reason: 'Access revoked' } } });
    await post({ url: subscription.url, webhookId: newWebhookId('terminated'), subscriptionId: subscription.id, body, secrets, timeoutMs: remaining })
        .catch(() => undefined);
}

async function deliver(context: Context, candidate: McpEventDelivery): Promise<'delivered' | 'failed' | 'skipped' | 'retrying' | null> {
    const { store, comments, now, post } = context.options;
    const stored = await store.get<McpEventDelivery>(candidate.pk, candidate.id);
    if (!stored || !stored.doc.active || Date.parse(stored.doc.nextAttemptAt) > now()
        || (stored.doc.lease && Date.parse(stored.doc.lease.until) > now())) return null;
    const lease = { id: randomUUID(), until: iso(now() + LEASE_MS) };
    const delivery: McpEventDelivery = { ...stored.doc, webhookId: stored.doc.webhookId ?? newWebhookId() };
    if (await store.replace<McpEventDelivery>({ ...delivery, lease }, stored.etag) !== 'ok') return null;
    const skip = async () => { await finish(context, delivery, lease.id, { active: false, status: 'skipped' }); return 'skipped' as const; };

    const subscription = (await store.get<McpEventSubscription>(delivery.pk, delivery.subscriptionId))?.doc;
    if (!subscription || !isSubscriptionActive(subscription, now())) return skip();
    // Suspended: the delivery waits for the client's refresh. Nothing is sent and no attempt is used up.
    if (subscription.suspendedAt) { await finish(context, delivery, lease.id, { nextAttemptAt: iso(now() + SUSPENDED_RECHECK_MS) }); return null; }
    let actor;
    try { actor = await subscriberActor(context, subscription); }
    // Access could not be checked now: release the lease and try again on a later dispatch.
    catch { await finish(context, delivery, lease.id, {}); return null; }
    if (!actor) { await terminate(context, subscription); return skip(); }
    const comment = (await comments.get(projectPartition(context.project.id), delivery.threadId))?.comment;
    const event = comment?.notificationEvents?.find(entry => entry.sequence === delivery.sequence && entry.kind === delivery.eventKind && entry.at === delivery.eventAt
        && (entry.agentId ?? undefined) === delivery.agentId);
    // A deleted thread, or one the account can no longer see, is not delivered.
    if (!comment || !event || !canSeeComment(comment, actor)) return skip();

    context.participants ??= participantNames(context.project);
    const body = JSON.stringify({ eventId: delivery.eventId, name: delivery.name, timestamp: event.at,
        data: mcpEventData(delivery.name, context.project, comment, event, await context.participants, context.options.baseUrl),
        cursor: await position(context, subscription) });
    let secrets: string[];
    try { secrets = subscriptionSecrets(subscription, now()); }
    // The server secret changed: the client's next refresh stores its secret again.
    catch { return skip(); }
    // Too large to send: the event is given up, and the endpoint (which answers) is told of the gap.
    if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES) {
        await finish(context, delivery, lease.id, { active: false, status: 'failed' });
        await markGap(store, subscription);
        await sendGap(context, subscription);
        return 'failed';
    }
    const remaining = context.options.deadline - Date.now();
    const response = await post({ url: subscription.url, webhookId: delivery.webhookId!, subscriptionId: subscription.id, body, secrets,
        timeoutMs: Math.max(1000, remaining) });
    const failure = 'failure' in response ? response.failure : responseFailure(response.status);
    await noteOutcome(context, subscription, failure);
    if (!failure) {
        await finish(context, delivery, lease.id, { active: false, status: 'delivered', attempts: delivery.attempts + 1, deliveredAt: iso(now()) });
        // The endpoint answers again: tell it about events given up while it did not.
        if (subscription.gap) await sendGap(context, subscription);
        return 'delivered';
    }
    const attempts = delivery.attempts + 1;
    // 410 and 413 mean the receiver does not want this event again.
    const refused = 'status' in response && (response.status === 410 || response.status === 413);
    const final = refused || attempts > RETRY_DELAYS_MS.length;
    await finish(context, delivery, lease.id, final ? { active: false, status: 'failed', attempts, lastError: failure }
        : { status: 'queued', attempts, lastError: failure, nextAttemptAt: iso(now() + RETRY_DELAYS_MS[attempts - 1]!) });
    // Given up without the receiver asking for it (410 is its own choice): the subscription has a gap.
    if (final && !('status' in response && response.status === 410)) await markGap(store, subscription);
    return final ? 'failed' : 'retrying';
}

/**
 * Discovers and delivers the project's due events within the deadline. Safe to run concurrently
 * (after a change and from the scheduled worker): records and attempts are leased.
 */
export async function dispatchProjectEvents(projectId: string, options: DispatchOptions = {}): Promise<DispatchResult> {
    const resolved = { now: options.now ?? Date.now, store: options.store ?? getAppStore(), comments: options.comments ?? getCommentsStore(),
        post: options.post ?? postWebhook, baseUrl: options.baseUrl, deadline: options.deadline ?? Date.now() + 10_000 };
    const result: DispatchResult = { discovered: 0, delivered: 0, failed: 0, skipped: 0, retrying: 0, terminated: 0 };
    let subscriptions = await activeProjectSubscriptions(projectId, resolved.store, resolved.now());
    // Without a live subscription nothing is delivered; leftover records expire with their TTL.
    if (!subscriptions.length) return result;
    const project = await findProject(projectId);
    if (!project) return result;
    const context: Context = { project, options: resolved, identities: new Map(), positions: new Map() };
    if (options.recheckAccess) {
        const kept: McpEventSubscription[] = [];
        for (const subscription of subscriptions) {
            let actor;
            // A failed check keeps the subscription; the next sweep checks again.
            try { actor = await subscriberActor(context, subscription); } catch { actor = undefined; }
            if (actor === null) { await terminate(context, subscription); result.terminated++; }
            else kept.push(subscription);
        }
        subscriptions = kept;
        if (!subscriptions.length) return result;
    }
    for (const subscription of subscriptions) if (subscription.replay) result.discovered += await replaySubscription(project, subscription, resolved);
    result.discovered += await discover(project, subscriptions, resolved);
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
    const total: DispatchResult & { projects: number; deferred: number } = { discovered: 0, delivered: 0, failed: 0, skipped: 0, retrying: 0, terminated: 0, projects: 0, deferred: 0 };
    for (const projectId of projects) {
        if (options.deadline - Date.now() < 5000) { total.deferred++; continue; }
        const result = await dispatchProjectEvents(projectId, { ...options, store, baseUrl, recheckAccess: true });
        total.projects++;
        for (const key of ['discovered', 'delivered', 'failed', 'skipped', 'retrying', 'terminated'] as const) total[key] += result[key];
    }
    return total;
}
