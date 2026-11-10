import { z } from 'zod';
import { ProtocolError, ProtocolErrorCode, type McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { ApiError } from '../../comments/http';
import type { McpIdentity } from '../credentials';
import { noteMcpError, type McpRequestLog } from '../telemetry';
import { isMcpEventName, mcpEventList, mcpEventNames, parseMcpEventArguments } from './catalog';
import { InvalidFeedCursorError, MAX_CURSOR_LENGTH, pollProjectEvents } from './feed';
import { streamMcpEvent, SUBSCRIPTION_ID_KEY, type StreamOptions } from './stream';
import { McpEventsError, mcpEventErrorCodes, mcpEventErrorNames, mcpEventProject, subscribeToMcpEvent, unsubscribeFromMcpEvent } from './subscriptions';
import type { WebhookPost } from './webhook';

/*
 * The MCP Events extension (SEP-3415, a draft): `events/list`, `events/poll`, `events/stream`,
 * `events/subscribe` and `events/unsubscribe`. The capability is the `io.modelcontextprotocol/events`
 * extension; the top-level `events` key of the earlier design sketch stays for ChatGPT, which reads
 * it. Error codes are in `subscriptions.ts`. Every result carries `resultType: "complete"`: the SDK
 * adds it on the 2026-07-28 wire, and requests of earlier revisions get it here.
 */
export const MCP_EVENTS_EXTENSION = 'io.modelcontextprotocol/events';
const complete = <T extends object>(result: T) => ({ resultType: 'complete' as const, ...result });

const DEFAULT_POLL_EVENTS = 20;
const MAX_POLL_EVENTS = 50;
const meta = { _meta: z.unknown().optional() };
const position = { cursor: z.string().max(MAX_CURSOR_LENGTH).nullable().optional(), maxAgeMs: z.number().min(0).optional() };
const subscribeParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.unknown(), url: z.unknown(), secret: z.unknown() }).loose(),
    ...position,
    // No rejection path for a TTL: any suggestion is clamped to a grant.
    ttlMs: z.number().nullable().optional(),
    ...meta
}).loose();
const pollParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    ...position,
    // A cap, not a demand: larger values are clamped to this server's page size.
    maxEvents: z.number().int().min(1).optional(),
    ...meta
}).loose();
const streamParams = z.object({ name: z.string().max(64), arguments: z.record(z.string(), z.unknown()).optional(), ...position, ...meta }).loose();
const unsubscribeParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.unknown().optional(), url: z.unknown() }).loose(),
    ...meta
}).loose();

function toProtocolError(error: unknown): ProtocolError {
    if (error instanceof McpEventsError)
        return new ProtocolError(mcpEventErrorCodes[error.kind], `${mcpEventErrorNames[error.kind]}: ${error.message}`, error.data);
    // Expected service errors keep their code and message; nothing else leaks.
    if (error instanceof ApiError) {
        const kind = error.status === 429 ? 'resource_exhausted' : error.status === 403 || error.status === 404 ? 'forbidden' : error.status === 400 ? 'invalid' : null;
        if (kind) return new ProtocolError(mcpEventErrorCodes[kind], `${mcpEventErrorNames[kind]}: ${error.message}`,
            kind === 'resource_exhausted' ? { limit: error.code, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } : undefined);
    }
    return new ProtocolError(ProtocolErrorCode.InternalError, 'The operation failed.');
}

async function handled<T>(action: () => Promise<T>) {
    try { return await action(); }
    catch (error) {
        if (!(error instanceof McpEventsError)) noteMcpError(error);
        throw toProtocolError(error);
    }
}

/** `events/poll`: one subscription per request, no server state (see `feed.ts`). */
async function pollMcpEvent(identity: McpIdentity, input: { name: string; arguments?: unknown; cursor: string | null; maxAgeMs?: number; maxEvents: number }, baseUrl?: string) {
    if (!isMcpEventName(input.name)) throw new McpEventsError('not_found', 'Unknown event. Call events/list.', { kind: 'event' });
    const args = parseMcpEventArguments(input.name, input.arguments);
    if (!args) throw new McpEventsError('invalid', 'The arguments do not match the event inputSchema.');
    const { project, actor } = await mcpEventProject(identity, args.projectId);
    const { projectId: _projectId, ...filters } = args;
    try {
        const { events, cursor, truncated, hasMore, nextPollMs } = await pollProjectEvents({ identity, project, actor, names: [input.name], args: filters,
            cursor: input.cursor, maxEvents: input.maxEvents, maxAgeMs: input.maxAgeMs, baseUrl });
        return { events, cursor, truncated, hasMore, nextPollMs };
    } catch (error) {
        if (error instanceof InvalidFeedCursorError) throw new McpEventsError('invalid', error.message);
        throw error;
    }
}

/** The methods whose `Mcp-Name` header mirrors `params.name` (SEP-3415, Streamable HTTP routing headers). */
const namedMethods = new Set(['events/poll', 'events/stream', 'events/subscribe', 'events/unsubscribe']);
export const isEventStreamRequest = (body: unknown) =>
    Boolean(body) && typeof body === 'object' && !Array.isArray(body) && (body as { method?: unknown }).method === 'events/stream';

/** A header value as sent, or the text of its `=?base64?…?=` form (SEP-2243); `null` when that form is malformed. */
function headerValue(value: string) {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('=?base64?') && trimmed.endsWith('?='))) return trimmed;
    const encoded = trimmed.slice(9, -2);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64')); } catch { return null; }
}

/**
 * On the 2026-07-28 wire an events request names its event in `Mcp-Name` as well, so intermediaries
 * can route by it. A missing or different header is `400` with `-32020` (HeaderMismatch), in the SDK's
 * shape for `tools/call`. The SDK checks its own methods only; the reply never repeats the request.
 */
export function eventNameHeaderRejection(headers: Headers, message: { id?: unknown; method?: unknown; params?: unknown }) {
    if (typeof message.method !== 'string' || !namedMethods.has(message.method)) return null;
    const name = message.params && typeof message.params === 'object' ? (message.params as { name?: unknown }).name : undefined;
    // Without a name there is nothing to mirror: the method rejects the request itself.
    if (typeof name !== 'string') return null;
    const header = headers.get('mcp-name');
    const value = header === null ? undefined : headerValue(header);
    if (value === name) return null;
    const body = header === null ? 'the body carries params.name but the required Mcp-Name header is absent'
        : value === null ? 'the Mcp-Name header carries an invalid Base64 sentinel value' : 'the Mcp-Name header names another event than params.name';
    return Response.json({ jsonrpc: '2.0', id: typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null,
        error: { code: -32020, message: `Bad Request: the request headers and body disagree: ${body}`, data: { mismatch: { header: header === null ? '(missing)' : 'Mcp-Name', body } } } },
    { status: 400 });
}

/** Registers the event methods on this request's server. `post` is for tests. */
export function registerMcpEvents(server: McpServer, identity: McpIdentity, log?: McpRequestLog, options: { post?: WebhookPost; baseUrl?: string; stream?: StreamOptions } = {}) {
    const baseUrl = options.baseUrl;
    server.server.registerCapabilities({ extensions: { [MCP_EVENTS_EXTENSION]: {} }, events: {} } as never);
    log?.watchEvents(mcpEventNames);
    const params = { params: z.unknown() };
    const observe = <R>(handler: (params: unknown, context: ServerContext) => Promise<R>) => log ? log.inRequest(handler) : handler;
    server.server.setRequestHandler('events/list', params, observe(async () => complete({ events: mcpEventList() })));
    server.server.setRequestHandler('events/subscribe', params, observe(async request => handled(async () => {
        const parsed = subscribeParams.safeParse(request);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments and delivery { mode, url, secret }.');
        const { name, arguments: args, delivery, ttlMs, cursor, maxAgeMs } = parsed.data;
        return complete(await subscribeToMcpEvent(identity, { name, arguments: args, delivery, ttlMs, cursor, maxAgeMs }, { post: options.post }));
    })));
    server.server.setRequestHandler('events/poll', params, observe(async request => handled(async () => {
        const parsed = pollParams.safeParse(request);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments, cursor (null to start from now) and optionally maxEvents and maxAgeMs.');
        const { name, arguments: args, cursor, maxAgeMs, maxEvents } = parsed.data;
        return complete(await pollMcpEvent(identity, { name, arguments: args, cursor: cursor ?? null, maxAgeMs, maxEvents: Math.min(maxEvents ?? DEFAULT_POLL_EVENTS, MAX_POLL_EVENTS) }, baseUrl));
    })));
    server.server.setRequestHandler('events/stream', params, observe(async (request, context) => handled(async () => {
        const parsed = streamParams.safeParse(request);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments, cursor (null to start from now) and optionally maxAgeMs.');
        const { name, arguments: args, cursor, maxAgeMs } = parsed.data;
        const { id, signal } = context.mcpReq;
        await streamMcpEvent(identity, { name, arguments: args, cursor: cursor ?? null, maxAgeMs },
            { id, signal, notify: notification => context.mcpReq.notify(notification) }, { baseUrl, ...options.stream });
        // The empty result that closes the stream; everything it had to say went out as notifications.
        return complete({ _meta: { [SUBSCRIPTION_ID_KEY]: id } });
    })));
    server.server.setRequestHandler('events/unsubscribe', params, observe(async request => handled(async () => {
        const parsed = unsubscribeParams.safeParse(request);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments and delivery { url }.');
        const { name, arguments: args, delivery } = parsed.data;
        return complete(await unsubscribeFromMcpEvent(identity, { name, arguments: args, delivery }));
    })));
}
