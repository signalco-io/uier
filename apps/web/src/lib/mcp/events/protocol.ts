import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../../comments/http';
import type { McpIdentity } from '../credentials';
import { noteMcpError, type McpRequestLog } from '../telemetry';
import { isMcpEventName, mcpEventList, mcpEventNames, parseMcpEventArguments } from './catalog';
import { InvalidFeedCursorError, MAX_CURSOR_LENGTH, pollProjectEvents } from './feed';
import { McpEventsError, mcpEventProject, subscribeToMcpEvent, unsubscribeFromMcpEvent } from './subscriptions';
import type { WebhookPost } from './webhook';

/*
 * `events/list`, `events/subscribe`, `events/unsubscribe` and `events/poll` with a top-level `events`
 * capability, as ChatGPT consumes the MCP Events draft over `initialize`. Error codes follow the numbering
 * ChatGPT documents (-32011…-32015); SEP-3415 proposes -32023…-32027. Change them here only.
 */
export const mcpEventErrorCodes = {
    invalid: ErrorCode.InvalidParams,
    not_found: -32011,
    forbidden: -32012,
    resource_exhausted: -32013,
    unsupported: -32014,
    callback: -32015
} as const;
const errorNames = { invalid: 'InvalidParams', not_found: 'NotFound', forbidden: 'Forbidden', resource_exhausted: 'ResourceExhausted',
    unsupported: 'Unsupported', callback: 'CallbackEndpointError' } as const;

const DEFAULT_POLL_EVENTS = 20;
const MAX_POLL_EVENTS = 50;
const meta = { _meta: z.unknown().optional() };
const listRequest = z.object({ method: z.literal('events/list'), params: z.object({ cursor: z.string().optional(), ...meta }).loose().optional() });
const subscribeRequest = z.object({ method: z.literal('events/subscribe'), params: z.unknown() });
const unsubscribeRequest = z.object({ method: z.literal('events/unsubscribe'), params: z.unknown() });
const pollRequest = z.object({ method: z.literal('events/poll'), params: z.unknown() });
const subscribeParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.unknown(), url: z.unknown(), secret: z.unknown() }).loose(),
    cursor: z.string().max(1024).nullable().optional(),
    maxAgeMs: z.number().optional(),
    ttlMs: z.number().int().positive().nullable().optional(),
    ...meta
}).loose();
const pollParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    cursor: z.string().max(MAX_CURSOR_LENGTH).nullable().optional(),
    maxAgeMs: z.number().int().positive().optional(),
    maxEvents: z.number().int().min(1).max(MAX_POLL_EVENTS).optional(),
    ...meta
}).loose();
const unsubscribeParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.unknown().optional(), url: z.unknown() }).loose(),
    ...meta
}).loose();

function toMcpError(error: unknown): McpError {
    if (error instanceof McpEventsError)
        return new McpError(mcpEventErrorCodes[error.kind], `${errorNames[error.kind]}: ${error.message}`, error.data);
    // Expected service errors keep their code and message; nothing else leaks.
    if (error instanceof ApiError) {
        const kind = error.status === 429 ? 'resource_exhausted' : error.status === 403 || error.status === 404 ? 'forbidden' : error.status === 400 ? 'invalid' : null;
        if (kind) return new McpError(mcpEventErrorCodes[kind], `${errorNames[kind]}: ${error.message}`,
            kind === 'resource_exhausted' ? { limit: error.code, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } : undefined);
    }
    return new McpError(ErrorCode.InternalError, 'The operation failed.');
}

async function handled<T>(action: () => Promise<T>) {
    try { return await action(); }
    catch (error) {
        if (!(error instanceof McpEventsError)) noteMcpError(error);
        throw toMcpError(error);
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
        return await pollProjectEvents({ identity, project, actor, names: [input.name], args: filters, cursor: input.cursor,
            maxEvents: input.maxEvents, maxAgeMs: input.maxAgeMs, baseUrl });
    } catch (error) {
        if (error instanceof InvalidFeedCursorError) throw new McpEventsError('invalid', error.message);
        throw error;
    }
}

/** Registers the event methods on this request's server. `post` is for tests. */
export function registerMcpEvents(server: McpServer, identity: McpIdentity, log?: McpRequestLog, options: { post?: WebhookPost; baseUrl?: string } = {}) {
    const baseUrl = options.baseUrl;
    server.server.registerCapabilities({ events: {} } as never);
    log?.watchEvents(mcpEventNames);
    const observe = <A extends unknown[], R>(handler: (...args: A) => R) => log ? log.inRequest(handler) : handler;
    server.server.setRequestHandler(listRequest, observe(async () => ({ events: mcpEventList() })));
    server.server.setRequestHandler(subscribeRequest, observe(async request => handled(async () => {
        const parsed = subscribeParams.safeParse(request.params);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments and delivery { mode, url, secret }.');
        const { name, arguments: args, delivery, ttlMs } = parsed.data;
        return await subscribeToMcpEvent(identity, { name, arguments: args, delivery, ttlMs }, { post: options.post });
    })));
    server.server.setRequestHandler(pollRequest, observe(async request => handled(async () => {
        const parsed = pollParams.safeParse(request.params);
        if (!parsed.success) throw new McpEventsError('invalid', `Send name, arguments, cursor (null to start from now) and optionally maxEvents (1–${MAX_POLL_EVENTS}) and maxAgeMs.`);
        const { name, arguments: args, cursor, maxAgeMs, maxEvents } = parsed.data;
        return await pollMcpEvent(identity, { name, arguments: args, cursor: cursor ?? null, maxAgeMs, maxEvents: maxEvents ?? DEFAULT_POLL_EVENTS }, baseUrl);
    })));
    server.server.setRequestHandler(unsubscribeRequest, observe(async request => handled(async () => {
        const parsed = unsubscribeParams.safeParse(request.params);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments and delivery { url }.');
        const { name, arguments: args, delivery } = parsed.data;
        return await unsubscribeFromMcpEvent(identity, { name, arguments: args, delivery });
    })));
}
