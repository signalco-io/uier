import { z } from 'zod';
import { mcpScopes } from './scopes';

/*
 * The `mcp_request` event contract. It depends on nothing but zod and the scope names, so tools
 * that read exported events (scripts/mcp-report.ts) validate them without loading the server.
 */

export const MAX_CALLS = 10;
export const methods = ['initialize', 'server/discover', 'subscriptions/listen', 'ping', 'tools/list', 'tools/call', 'prompts/list', 'prompts/get', 'resources/list',
    'resources/templates/list', 'resources/read', 'resources/directory/read', 'resources/subscribe', 'resources/unsubscribe', 'skills/list', 'skills/get',
    'completion/complete',
    'logging/setLevel', 'tasks/get', 'tasks/list', 'tasks/result', 'tasks/cancel', 'notifications/initialized',
    'notifications/cancelled', 'notifications/progress', 'notifications/roots/list_changed',
    'events/list', 'events/subscribe', 'events/unsubscribe', 'events/poll', 'events/stream'] as const;
export const codePattern = /^[a-z][a-z_]{0,39}$/;
export const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
export const requestedNamePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const code = z.string().regex(codePattern);
const count = z.number().int().nonnegative();
const ref = z.string().regex(/^[0-9a-f]{16}$/);
const failureSchema = z.object({ name: z.string().max(64), status: z.number().int().min(100).max(599).optional(),
    frames: z.array(z.string().max(200)).max(5) }).strict();
const argumentSchema = z.union([z.boolean(), z.number(), z.null(), z.string().max(64),
    z.object({ type: z.enum(['string', 'array', 'object', 'number']), length: count.optional() }).strict()]);
const callSchema = z.object({
    method: z.enum([...methods, 'other']),
    /** Registered tool, prompt, resource template or event; `unknown` when the client named another one */
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/).optional(),
    /** The name an `unknown` call asked for, when it looks like a tool or prompt name: what clients expect us to offer */
    requestedName: z.string().regex(requestedNamePattern).optional(),
    arguments: z.record(z.string().regex(identifierPattern), argumentSchema).optional(),
    unknownArguments: z.array(z.string().regex(identifierPattern)).max(10).optional(),
    outcome: z.enum(['success', 'tool_error', 'error', 'accepted', 'unanswered']),
    error: code.optional(),
    reason: z.enum(['too_fast', 'page_full']).optional(),
    missingScope: z.enum(mcpScopes).optional(),
    rpcError: z.number().int().optional(),
    issues: z.array(z.object({ path: z.string().max(64), code }).strict()).max(10).optional(),
    failure: failureSchema.optional(),
    result: z.object({ bytes: count, items: count, more: z.boolean(), remaining: count, truncated: z.literal(true),
        itemErrors: z.record(code, count) }).partial().strict().optional(),
}).strict();
export const mcpRequestEventSchema = z.object({
    event: z.literal('mcp_request'), version: z.literal(1), id: z.uuid(), timestamp: z.iso.datetime(),
    environment: z.enum(['production', 'preview', 'local', 'unknown']),
    httpMethod: z.enum(['POST', 'GET', 'DELETE', 'other']), status: z.number().int().min(100).max(599), durationMs: count,
    outcome: z.enum(['handled', 'rejected', 'interrupted', 'failed']),
    error: code.optional(),
    reason: z.enum(['too_fast', 'page_full']).optional(),
    authentication: z.enum(['missing', 'invalid']).optional(),
    failure: failureSchema.optional(),
    protocolVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** As the client describes itself: on `initialize`, and on every 2026-07-28 request (they have no handshake) */
    client: z.object({ name: z.string().max(64), version: z.string().max(32).optional() }).strict().optional(),
    /** Keyed hashes: the same connection and account match across events, without their ids */
    connection: z.object({ kind: z.enum(['oauth', 'credential']), ref, user: ref, scopes: z.array(z.enum(mcpScopes)),
        access: z.enum(['all', 'selected']) }).strict().optional(),
    calls: z.array(callSchema).max(MAX_CALLS),
    omittedCalls: z.number().int().positive().optional(),
}).strict();
export type McpRequestEvent = z.infer<typeof mcpRequestEventSchema>;
export type McpCall = z.infer<typeof callSchema>;
export type Failure = z.infer<typeof failureSchema>;
