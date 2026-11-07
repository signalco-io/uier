import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../../comments/http';
import type { McpIdentity } from '../credentials';
import { noteMcpError, type McpRequestLog } from '../telemetry';
import { mcpEventList, mcpEventNames } from './catalog';
import { McpEventsError, subscribeToMcpEvent, unsubscribeFromMcpEvent } from './subscriptions';
import type { WebhookPost } from './webhook';

/*
 * `events/list`, `events/subscribe` and `events/unsubscribe` with a top-level `events` capability,
 * as ChatGPT consumes the MCP Events draft over `initialize`. Error codes follow the numbering
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

const meta = { _meta: z.unknown().optional() };
const listRequest = z.object({ method: z.literal('events/list'), params: z.object({ cursor: z.string().optional(), ...meta }).loose().optional() });
const subscribeRequest = z.object({ method: z.literal('events/subscribe'), params: z.unknown() });
const unsubscribeRequest = z.object({ method: z.literal('events/unsubscribe'), params: z.unknown() });
const subscribeParams = z.object({
    name: z.string().max(64),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.unknown(), url: z.unknown(), secret: z.unknown() }).loose(),
    cursor: z.string().max(1024).nullable().optional(),
    maxAgeMs: z.number().optional(),
    ttlMs: z.number().int().positive().nullable().optional(),
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

/** Registers the event methods on this request's server. `post` is for tests. */
export function registerMcpEvents(server: McpServer, identity: McpIdentity, log?: McpRequestLog, options: { post?: WebhookPost } = {}) {
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
    server.server.setRequestHandler(unsubscribeRequest, observe(async request => handled(async () => {
        const parsed = unsubscribeParams.safeParse(request.params);
        if (!parsed.success) throw new McpEventsError('invalid', 'Send name, arguments and delivery { url }.');
        const { name, arguments: args, delivery } = parsed.data;
        return await unsubscribeFromMcpEvent(identity, { name, arguments: args, delivery });
    })));
}
