import { createHash } from 'node:crypto';
import type { AppDoc } from '../../app/model';
import { getAppStore, type AppStore } from '../../app/store';
import { ApiError } from '../../comments/http';
import { keyedHash } from '../../comments/environment';
import { getCommentsStore } from '../../repo/commentsStore';
import { decryptSecret, encryptSecret, type SecretContext } from '../../integrations/secrets';
import { mcpProject, type McpIdentity } from '../credentials';
import { isMcpEventName, parseMcpEventArguments, type McpEventArguments, type McpEventName } from './catalog';
import { callbackUrl, postWebhook, verifyCallback, webhookSecretBytes, type CallbackFailure, type WebhookPost } from './webhook';

/*
 * Webhook subscriptions (MCP Events draft). A subscription is keyed by the connection, callback
 * URL, event name and canonical arguments, lives in its project's `mcp-events:` partition and
 * expires at its granted `refreshBefore` unless the client refreshes it. Secrets are encrypted.
 */

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const MIN_TTL_MS = 5 * 60 * 1000;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 25;
export const MAX_SUBSCRIPTIONS_PER_PROJECT = 100;
/** Verification POSTs per callback host and hour, across every account */
export const MAX_VERIFICATIONS_PER_HOST = 30;
const VERIFIED_ENDPOINT_SECONDS = 24 * 60 * 60;
/** The replaced secret also signs deliveries this long after a rotation */
const ROTATION_GRACE_MS = 5 * 60 * 1000;

export type McpEventSubscription = AppDoc & {
    type: 'mcp-event-subscription';
    projectId: string;
    workspaceId: string;
    /** The stable connection owner, used to resolve the credential or grant. */
    userId: string;
    /** Selected profile for this project's events; absent on older, single-account subscriptions. */
    actorUserId?: string;
    connectionId: string;
    connectionKind: McpIdentity['connection']['kind'];
    name: McpEventName;
    arguments: McpEventArguments;
    url: string;
    /** Encrypted `whsec_` value */
    secret: string;
    previousSecret?: { value: string; until: string };
    /** Only events at or after this time are delivered; events are not replayed */
    since: string;
    refreshBefore: string;
    createdAt: string;
    updatedAt: string;
    lastDeliveryAt?: string;
    lastError?: CallbackFailure;
    failedSince?: string;
};

/** A verified (connection, callback URL) pair; verification covers every subscription of it for a day. */
type McpEventEndpoint = AppDoc & { type: 'mcp-event-endpoint'; verifiedAt: string };

export const eventsPk = (projectId: string) => `mcp-events:${projectId}`;
const endpointPk = (connectionId: string) => `mcp-events-endpoint:${connectionId}`;

export class McpEventsError extends Error {
    constructor(readonly kind: 'invalid' | 'not_found' | 'forbidden' | 'resource_exhausted' | 'unsupported' | 'callback', message: string,
        readonly data?: Record<string, unknown>) {
        super(message);
        this.name = 'McpEventsError';
    }
}

/** Deterministic over (connection, URL, name, arguments): a routing handle, never a capability. */
export function subscriptionId(connectionId: string, url: string, name: McpEventName, args: McpEventArguments) {
    return `sub_${createHash('sha256').update(JSON.stringify(['uier-mcp-subscription', 1, connectionId, url, name, args])).digest('hex').slice(0, 32)}`;
}

function secretContext(subscription: Pick<McpEventSubscription, 'id' | 'workspaceId' | 'userId' | 'projectId'>): SecretContext {
    return { provider: 'mcp-events', workspaceId: subscription.workspaceId, subjectId: subscription.id, field: 'secret',
        userId: subscription.userId, projectId: subscription.projectId };
}
/** Derived from the server secret, which the app and the scheduled worker both have. */
function secretKey() {
    return { key: Buffer.from(keyedHash('mcp-event-secret-key', 'v1'), 'hex').toString('base64'), keyId: 'e1' };
}
export function subscriptionSecrets(subscription: McpEventSubscription, now = Date.now()) {
    const context = secretContext(subscription);
    const current = decryptSecret(subscription.secret, context, secretKey());
    const previous = subscription.previousSecret && Date.parse(subscription.previousSecret.until) > now
        ? decryptSecret(subscription.previousSecret.value, context, secretKey()) : undefined;
    return previous && previous !== current ? [current, previous] : [current];
}

export function isSubscriptionActive(subscription: McpEventSubscription, now = Date.now()) {
    return Date.parse(subscription.refreshBefore) > now;
}

/** Record lifetime: the grant plus a minute, so an expired subscription is never reused. */
function recordTtl(refreshBefore: number, now: number) {
    return Math.max(60, Math.ceil((refreshBefore - now) / 1000) + 60);
}

function grantedTtl(ttlMs: number | null | undefined) {
    // No-expiry requests get the longest finite grant: clients refresh before it ends.
    const requested = ttlMs === undefined ? DEFAULT_TTL_MS : ttlMs === null ? MAX_TTL_MS : ttlMs;
    return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, requested));
}

/** The project and current member actor for an event request; any access failure is Forbidden. */
export async function mcpEventProject(identity: McpIdentity, projectId: string) {
    if (!identity.scopes.includes('feedback:read')) throw new McpEventsError('forbidden', 'This connection needs feedback:read.');
    try { return await mcpProject(identity, projectId); }
    catch (error) {
        if (error instanceof ApiError && error.status === 403)
            throw new McpEventsError('forbidden', error.message);
        if (error instanceof ApiError && error.code === 'not_found')
            throw new McpEventsError('forbidden', 'Project not found. Check list_projects for the projects this connection can reach.');
        throw error;
    }
}

async function verifiedEndpoint(store: AppStore, connectionId: string, url: string) {
    return Boolean(await store.get<McpEventEndpoint>(endpointPk(connectionId), createHash('sha256').update(url).digest('hex')));
}

async function verifyEndpoint(store: AppStore, post: WebhookPost, connectionId: string, url: URL, id: string, secret: string) {
    const window = Math.floor(Date.now() / 3_600_000);
    if (!await getCommentsStore().incrementCounter('$mcp', `counter_${keyedHash('mcp-event-verification', `${url.hostname}:${window}`)}`,
        MAX_VERIFICATIONS_PER_HOST, 3600))
        throw new McpEventsError('resource_exhausted', 'Too many callback verifications for this host. Try again within the hour.', { limit: 'verifications', max: MAX_VERIFICATIONS_PER_HOST });
    const failure = await verifyCallback(post, url.href, id, secret);
    if (failure) throw new McpEventsError('callback', 'The callback endpoint did not verify.', { reason: failure });
    const doc: McpEventEndpoint = { type: 'mcp-event-endpoint', pk: endpointPk(connectionId), id: createHash('sha256').update(url.href).digest('hex'),
        verifiedAt: new Date().toISOString(), ttl: VERIFIED_ENDPOINT_SECONDS };
    // A concurrent verification of the same endpoint already wrote the record.
    await store.create(doc);
}

export type SubscribeInput = {
    name: string;
    arguments?: unknown;
    delivery: { mode?: unknown; url?: unknown; secret?: unknown };
    ttlMs?: number | null;
};

/** Creates or refreshes (idempotently) a webhook subscription; verifies a new endpoint first. */
export async function subscribeToMcpEvent(identity: McpIdentity, input: SubscribeInput, options: { post?: WebhookPost; store?: AppStore } = {}) {
    const store = options.store ?? getAppStore();
    const post = options.post ?? postWebhook;
    if (!isMcpEventName(input.name)) throw new McpEventsError('not_found', 'Unknown event. Call events/list.', { kind: 'event' });
    if (input.delivery.mode !== 'webhook')
        throw new McpEventsError('unsupported', 'Only webhook delivery is supported.', { feature: 'deliveryMode', value: typeof input.delivery.mode === 'string' ? input.delivery.mode.slice(0, 32) : null });
    const args = parseMcpEventArguments(input.name, input.arguments);
    if (!args) throw new McpEventsError('invalid', 'The arguments do not match the event inputSchema.');
    const url = callbackUrl(input.delivery.url);
    if (!url) throw new McpEventsError('invalid', 'Use a public HTTPS callback URL on the default port, without credentials or a fragment.');
    if (!webhookSecretBytes(input.delivery.secret)) throw new McpEventsError('invalid', 'The secret must be whsec_ followed by the base64 of 24–64 random bytes.');
    const secret = input.delivery.secret as string;
    const { project, actor } = await mcpEventProject(identity, args.projectId);
    const id = subscriptionId(identity.connection.id, url.href, input.name, args);
    const pk = eventsPk(project.id);
    const grant = grantedTtl(input.ttlMs);

    for (let attempt = 0; attempt < 5; attempt++) {
        const stored = await store.get<McpEventSubscription>(pk, id);
        const now = Date.now();
        const actorUserId = actor.userId;
        const existing = stored && stored.doc.type === 'mcp-event-subscription' && isSubscriptionActive(stored.doc, now)
            && (stored.doc.actorUserId ?? stored.doc.userId) === actorUserId ? stored : null;
        if (!existing) {
            const [ownCount, projectCount] = await Promise.all([
                store.count<McpEventSubscription>({ type: 'mcp-event-subscription', where: { connectionId: identity.connection.id } }),
                store.count<McpEventSubscription>({ type: 'mcp-event-subscription', pk })]);
            if (ownCount >= MAX_SUBSCRIPTIONS_PER_CONNECTION)
                throw new McpEventsError('resource_exhausted', `A connection can hold ${MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions. Unsubscribe from one first.`, { limit: 'subscriptions', max: MAX_SUBSCRIPTIONS_PER_CONNECTION });
            if (projectCount >= MAX_SUBSCRIPTIONS_PER_PROJECT)
                throw new McpEventsError('resource_exhausted', `A project can have ${MAX_SUBSCRIPTIONS_PER_PROJECT} subscriptions.`, { limit: 'project_subscriptions', max: MAX_SUBSCRIPTIONS_PER_PROJECT });
            if (!await verifiedEndpoint(store, identity.connection.id, url.href)) await verifyEndpoint(store, post, identity.connection.id, url, id, secret);
        }
        const refreshBefore = Date.now() + grant;
        const base = { id, pk, projectId: project.id, workspaceId: project.workspaceId, userId: identity.user.id };
        const encrypted = encryptSecret(secret, secretContext(base), secretKey());
        let previousSecret = existing?.doc.previousSecret && Date.parse(existing.doc.previousSecret.until) > now ? existing.doc.previousSecret : undefined;
        if (existing && subscriptionSecrets(existing.doc, now)[0] !== secret)
            previousSecret = { value: existing.doc.secret, until: new Date(now + ROTATION_GRACE_MS).toISOString() };
        const doc: McpEventSubscription = {
            ...(existing?.doc ?? {}), ...base, type: 'mcp-event-subscription',
            actorUserId,
            connectionId: identity.connection.id, connectionKind: identity.connection.kind,
            name: input.name, arguments: args, url: url.href, secret: encrypted,
            since: existing?.doc.since ?? new Date(now).toISOString(),
            refreshBefore: new Date(refreshBefore).toISOString(),
            createdAt: existing?.doc.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
            ttl: recordTtl(refreshBefore, Date.now())
        };
        if (!previousSecret) delete doc.previousSecret;
        else doc.previousSecret = previousSecret;
        // An expired record is replaced as a new subscription: its old delivery state does not carry over.
        if (stored && !existing) {
            delete doc.lastDeliveryAt; delete doc.lastError; delete doc.failedSince;
        }
        const saved = stored ? await store.replace(doc, stored.etag) === 'ok' : await store.create(doc);
        if (!saved) continue;
        return {
            id, refreshBefore: doc.refreshBefore, cursor: null, truncated: false,
            ...(existing ? { deliveryStatus: { active: true, lastDeliveryAt: existing.doc.lastDeliveryAt ?? null, lastError: existing.doc.lastError ?? null,
                ...(existing.doc.failedSince ? { failedSince: existing.doc.failedSince } : {}) } } : {})
        };
    }
    throw new McpEventsError('resource_exhausted', 'The subscription changed too often. Retry the same request.', { limit: 'concurrent_updates' });
}

export type UnsubscribeInput = { name: string; arguments?: unknown; delivery: { url?: unknown } };

/** Idempotent: an unknown or already removed subscription is not an error. Only the owning connection can address it. */
export async function unsubscribeFromMcpEvent(identity: McpIdentity, input: UnsubscribeInput, options: { store?: AppStore } = {}) {
    if (!isMcpEventName(input.name)) return {};
    const args = parseMcpEventArguments(input.name, input.arguments);
    if (!args) throw new McpEventsError('invalid', 'The arguments do not match the event inputSchema.');
    let url: string;
    try { url = new URL(String(input.delivery.url)).href; }
    catch { throw new McpEventsError('invalid', 'Use the callback URL of the subscription.'); }
    const store = options.store ?? getAppStore();
    await store.delete(eventsPk(args.projectId), subscriptionId(identity.connection.id, url, input.name, args));
    return {};
}

/** Every subscription of a project that has not expired */
export async function activeProjectSubscriptions(projectId: string, store: AppStore = getAppStore(), now = Date.now()) {
    return (await store.query<McpEventSubscription>({ type: 'mcp-event-subscription', pk: eventsPk(projectId) }))
        .filter(subscription => isSubscriptionActive(subscription, now));
}
