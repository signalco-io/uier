import { randomUUID } from 'node:crypto';
import type { AppDoc } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { getCommentsStore, type CommentsStore } from '../../repo/commentsStore';
import type { McpIdentity } from '../credentials';
import { isMcpEventName, parseMcpEventArguments } from './catalog';
import { InvalidFeedCursorError, pollProjectEvents, type FeedPage } from './feed';
import { currentEventAccess, McpEventsError, mcpEventErrorCodes, mcpEventProject } from './subscriptions';

/*
 * Push delivery (`events/stream`, SEP-3415): one long-lived request per subscription. The stream
 * polls the stateless feed, so a function instance holds nothing but the open response: it confirms
 * with `notifications/events/active`, sends each event with the position after it, a heartbeat with
 * the current position while quiet, and ends itself before the route's time limit with an empty
 * result. The client opens it again with its last cursor. Access is checked again on every poll;
 * when it has ended, or the connection now acts as another account in the project, the stream
 * sends `notifications/events/terminated`.
 */

/** How often an open stream looks for new events */
export const STREAM_POLL_MS = 3_000;
/** A heartbeat carries the position this often (SEP-3415: at least every 30 seconds) */
export const STREAM_HEARTBEAT_MS = 25_000;
/** A stream ends itself after this long, inside the route's 300-second limit */
export const STREAM_LIFETIME_MS = 240_000;
export const MAX_STREAMS_PER_CONNECTION = 12;
const STREAM_PAGE = 50;
const LEASE_SECONDS = 90;
const LEASE_RENEW_MS = 30_000;

/** An open stream of a connection: counted against its limit, expires on its own if the instance dies. */
type McpEventStreamLease = AppDoc & { type: 'mcp-event-stream'; connectionId: string; until: string };
const leasePk = (connectionId: string) => `mcp-events-stream:${connectionId}`;

type Notification = { method: string; params?: Record<string, unknown> };
/** The request the stream answers: its id tags every notification, its signal ends the stream. */
export type StreamChannel = { id: string | number; signal: AbortSignal; notify: (notification: Notification) => Promise<void> };
export type StreamInput = { name: string; arguments?: unknown; cursor: string | null; maxAgeMs?: number };
export type StreamOptions = {
    baseUrl?: string;
    lifetimeMs?: number;
    pollMs?: number;
    heartbeatMs?: number;
    store?: AppStore;
    comments?: CommentsStore;
};

export const SUBSCRIPTION_ID_KEY = 'io.modelcontextprotocol/subscriptionId';

/*
 * Streams of one project on this instance share their reads: a client that follows several events
 * opens one stream each, and all of them ask for the same recent threads.
 */
type Changes = Awaited<ReturnType<CommentsStore['listChangedSince']>>;
const shared = new Map<string, { at: number; since: number; limit: number; rows: Promise<Changes> }>();
function sharedChanges(store: CommentsStore, maxAgeMs: number): CommentsStore {
    return { ...store, listChangedSince: (domain, since, limit) => {
        const now = Date.now();
        for (const [key, entry] of shared) if (now - entry.at >= maxAgeMs) shared.delete(key);
        const entry = shared.get(domain);
        // An earlier position's rows include these; a full page may have been cut short, so it is not reused.
        if (entry && entry.since <= since && entry.limit >= limit)
            return entry.rows.then(rows => rows.length < entry.limit ? rows : store.listChangedSince(domain, since, limit));
        const rows = store.listChangedSince(domain, since, limit);
        shared.set(domain, { at: now, since, limit, rows });
        rows.catch(() => { if (shared.get(domain)?.rows === rows) shared.delete(domain); });
        return rows;
    } } as CommentsStore;
}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}

async function openLease(store: AppStore, connectionId: string): Promise<McpEventStreamLease> {
    const pk = leasePk(connectionId);
    const open = (await store.query<McpEventStreamLease>({ type: 'mcp-event-stream', pk })).filter(lease => Date.parse(lease.until) > Date.now());
    if (open.length >= MAX_STREAMS_PER_CONNECTION)
        throw new McpEventsError('resource_exhausted', `A connection can hold ${MAX_STREAMS_PER_CONNECTION} open event streams. Close one first.`, { limit: 'streams', max: MAX_STREAMS_PER_CONNECTION });
    const lease: McpEventStreamLease = { type: 'mcp-event-stream', pk, id: `stream_${randomUUID()}`, connectionId,
        until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), ttl: LEASE_SECONDS };
    await store.create(lease);
    return lease;
}

/**
 * Serves one push subscription until the client ends it, access ends or the lifetime is over.
 * Rejects before anything is sent when the subscription is invalid; after `active` it never throws.
 */
export async function streamMcpEvent(identity: McpIdentity, input: StreamInput, channel: StreamChannel, options: StreamOptions = {}) {
    if (!isMcpEventName(input.name)) throw new McpEventsError('not_found', 'Unknown event. Call events/list.', { kind: 'event' });
    const name = input.name;
    const args = parseMcpEventArguments(name, input.arguments);
    if (!args) throw new McpEventsError('invalid', 'The arguments do not match the event inputSchema.');
    const store = options.store ?? getAppStore();
    const pollMs = options.pollMs ?? STREAM_POLL_MS;
    const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
    const comments = sharedChanges(options.comments ?? getCommentsStore(), pollMs);
    const { projectId, ...filters } = args;
    const meta = { [SUBSCRIPTION_ID_KEY]: channel.id };
    const deadline = Date.now() + (options.lifetimeMs ?? STREAM_LIFETIME_MS);
    const connection = { userId: identity.user.id, connectionId: identity.connection.id, kind: identity.connection.kind };

    const read = async (access: Awaited<ReturnType<typeof mcpEventProject>>, current: McpIdentity, cursor: string | null, maxAgeMs?: number): Promise<FeedPage> =>
        pollProjectEvents({ identity: current, project: access.project, actor: access.actor, names: [name], args: filters, cursor,
            maxEvents: STREAM_PAGE, maxAgeMs, positions: true, baseUrl: options.baseUrl, comments });

    // Everything that can refuse the subscription happens before the stream opens.
    let page: FeedPage;
    // The account the connection acts as in this project: the stream is that account's, like a webhook subscription.
    const opened = await mcpEventProject(identity, projectId);
    const actorUserId = opened.actor.userId;
    try { page = await read(opened, identity, input.cursor, input.maxAgeMs); }
    catch (error) {
        if (error instanceof InvalidFeedCursorError) throw new McpEventsError('invalid', error.message);
        throw error;
    }
    const lease = await openLease(store, identity.connection.id);

    let cursor = page.cursor;
    let beatAt = Date.now();
    let renewedAt = Date.now();
    let open = true;
    let failing = false;
    const send = async (method: string, params: Record<string, unknown>) => {
        if (!open) return;
        try { await channel.notify({ method, params: { ...params, _meta: meta } }); }
        // The client is gone: nothing more can be sent.
        catch { open = false; }
    };
    const deliver = async (next: FeedPage, first: boolean) => {
        // A confirmation opens the stream; later it marks a gap (`truncated`) and delivery continues.
        if (first || next.truncated) await send('notifications/events/active', { cursor: next.start ?? next.cursor, truncated: next.truncated });
        for (const [index, event] of next.events.entries())
            await send('notifications/events/event', { ...event, cursor: next.positions?.[index] ?? next.cursor });
        cursor = next.cursor;
    };

    try {
        await deliver(page, true);
        while (open && !channel.signal.aborted && Date.now() < deadline) {
            if (!page.hasMore) await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())), channel.signal);
            if (!open || channel.signal.aborted || Date.now() >= deadline) break;
            try {
                const access = await currentEventAccess(connection, projectId);
                if (!access || access.actor.userId !== actorUserId) {
                    await send('notifications/events/terminated', { error: { code: mcpEventErrorCodes.forbidden, message: 'Forbidden', data: { reason: 'Access revoked' } } });
                    break;
                }
                page = await read(access, access.identity, cursor);
                failing = false;
                await deliver(page, false);
            } catch {
                // A failed read: the subscription stays, the next poll resumes from the same position.
                // Said once per outage, not on every poll of it.
                page = { ...page, events: [], hasMore: false, truncated: false };
                if (!failing) await send('notifications/events/error', { error: { code: -32603, message: 'UpstreamError', data: { reason: 'The event source could not be read.' } } });
                failing = true;
            }
            const now = Date.now();
            // On schedule also while events flow: the heartbeat is how a client knows the stream is alive.
            if (open && now - beatAt >= heartbeatMs) { beatAt = now; await send('notifications/events/heartbeat', { cursor }); }
            if (open && now - renewedAt >= LEASE_RENEW_MS) {
                renewedAt = now;
                await updateDoc<McpEventStreamLease>(lease.pk, lease.id, current => ({ ...current, until: new Date(now + LEASE_SECONDS * 1000).toISOString() }), store)
                    .catch(() => undefined);
            }
        }
    } finally {
        await store.delete(lease.pk, lease.id).catch(() => undefined);
    }
}
