import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { logEnvironment } from '../app/deployment';
import { keyedHash } from '../comments/environment';
import { ApiError } from '../comments/http';
import { McpAuthenticationError, McpScopeError, type McpIdentity } from './credentials';
import { mcpScopes } from './scopes';
import { codePattern, identifierPattern, MAX_CALLS, methods, requestedNamePattern, type Failure, type McpCall,
    type McpRequestEvent } from './telemetrySchema';

export { mcpRequestEventSchema, type McpRequestEvent } from './telemetrySchema';

/*
 * One `mcp_request` event per /api/mcp request, for improving the tools, prompts and resources:
 * what clients call, which calls fail and why, and how large the answers are. Events carry names,
 * codes, counts and sizes only. Feedback, replies, search text, ids, tokens, names and raw error
 * messages never enter them. Argument values are logged only for numbers and fixed options the
 * schema itself declares; every other value is reduced to its type and length.
 */

const methodNames = new Set<string>(methods);
type Note = Pick<McpCall, 'error' | 'reason' | 'missingScope' | 'issues' | 'failure'>;
type Input = { shape: Record<string, unknown>; schema: z.ZodType };
type Callback = (...args: unknown[]) => unknown;
type ObjectValue = Record<string, unknown>;

const record = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const requestId = (value: unknown): RequestId | undefined => typeof value === 'string' || typeof value === 'number' ? value : undefined;
const label = (value: unknown, max: number) =>
    typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9 ._/()+-]*$/.test(value) ? value : undefined;
const issueCode = (value: unknown) => typeof value === 'string' && codePattern.test(value) ? value : 'other';
const calls = new AsyncLocalStorage<{ log: McpRequestLog; id: RequestId }>();

function inputOf(schema: unknown): Input {
    if (schema instanceof z.ZodObject) return { shape: schema.shape, schema };
    if (schema && typeof schema === 'object' && !(schema instanceof z.ZodType))
        return { shape: schema as ObjectValue, schema: z.object(schema as Record<string, z.ZodType>) };
    return { shape: {}, schema: z.object({}) };
}

/** Numbers and the fixed options a field declares are safe to log; anything else could be content or an id. */
function accepts(schema: unknown, into = { literals: new Set<string>(), numbers: false }, depth = 0) {
    if (depth > 8) return into;
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault)
        accepts(schema.unwrap(), into, depth + 1);
    else if (schema instanceof z.ZodPipe) accepts(schema.in, into, depth + 1);
    else if (schema instanceof z.ZodUnion) for (const option of schema.options) accepts(option, into, depth + 1);
    else if (schema instanceof z.ZodEnum || schema instanceof z.ZodLiteral) {
        for (const value of schema instanceof z.ZodEnum ? schema.options : schema.values)
            if (typeof value === 'string' && value.length <= 64) into.literals.add(value);
    } else if (schema instanceof z.ZodNumber) into.numbers = true;
    return into;
}

function summarizeArguments(args: unknown, shape: ObjectValue): Pick<McpCall, 'arguments' | 'unknownArguments'> {
    const summary: NonNullable<McpCall['arguments']> = {};
    const unknown = new Set<string>();
    for (const [key, value] of Object.entries(record(args)).slice(0, 50)) {
        if (!Object.hasOwn(shape, key)) { if (unknown.size < 10) unknown.add(identifierPattern.test(key) ? key : 'other'); continue; }
        const field = accepts(shape[key]);
        summary[key] = value === null || typeof value === 'boolean' ? value
            : typeof value === 'number' ? field.numbers ? value : { type: 'number' }
                : typeof value === 'string' ? field.literals.has(value) ? value : { type: 'string', length: value.length }
                    : Array.isArray(value) ? { type: 'array', length: value.length } : { type: 'object' };
    }
    return { ...(Object.keys(summary).length ? { arguments: summary } : {}), ...(unknown.size ? { unknownArguments: [...unknown] } : {}) };
}

/** Which fields failed and how, never the submitted values or the validator's messages */
async function validationIssues(input: Input, args: unknown) {
    const parsed = await input.schema.safeParseAsync(args ?? {});
    if (parsed.success) return undefined;
    return parsed.error.issues.slice(0, 10).map(issue => {
        const key = issue.path[0];
        return { path: typeof key === 'string' && Object.hasOwn(input.shape, key) ? key : issue.path.length ? 'other' : '', code: issueCode(issue.code) };
    });
}

/** The error class, a status code if it has one and the code location; never the message */
function failureOf(error: unknown): Failure {
    const value = error instanceof Error ? error : undefined;
    const name = value && /^[A-Za-z][\w$.]{0,63}$/.test(value.name) ? value.name : 'unknown';
    const raw = record(error);
    const status = [raw.statusCode, raw.status, raw.code].find((entry): entry is number => Number.isInteger(entry) && Number(entry) >= 100 && Number(entry) <= 599);
    // The message can carry submitted content, so it is removed before reading the frames.
    const stack = typeof value?.stack === 'string' ? (value.message ? value.stack.replace(value.message, '') : value.stack) : '';
    const frames = stack.split('\n').map(line => line.trim()).filter(line => /^at \S.*:\d+:\d+\)?$/.test(line))
        .slice(0, 5).map(line => line.slice(3, 203));
    return { name, ...(status ? { status } : {}), frames };
}

function describeError(error: unknown): Note {
    if (error instanceof McpScopeError) return { error: 'forbidden', missingScope: error.scope };
    if (error instanceof ApiError) return { error: error.code, ...(error.reason ? { reason: error.reason } : {}) };
    if (error instanceof z.ZodError) return { error: 'invalid_arguments', issues: error.issues.slice(0, 10).map(issue => ({ path: '', code: issueCode(issue.code) })) };
    return { error: 'server_error', failure: failureOf(error) };
}

function toolError(name: string | undefined, result: ObjectValue) {
    if (name === 'unknown') return 'unknown_tool';
    const content = Array.isArray(result.content) ? result.content.map(record) : [];
    // The SDK turns rejected arguments into a tool result with this text before any handler runs.
    if (content.some(item => typeof item.text === 'string' && /^MCP error -32602: (?:Input validation error|Invalid arguments for tool)/.test(item.text)))
        return 'invalid_arguments';
    const value = record(result.structuredContent).error;
    return typeof value === 'string' && codePattern.test(value) ? value : 'other';
}

function protocolError(method: McpCall['method'], name: string | undefined, error: ObjectValue) {
    if (method === 'prompts/get' && name === 'unknown') return 'unknown_prompt';
    if (method === 'resources/read' && name === 'unknown') return 'unknown_resource';
    if (typeof error.message === 'string' && error.message.startsWith('MCP error -32602: Invalid arguments for prompt')) return 'invalid_arguments';
    return ({ [-32700]: 'parse_error', [-32600]: 'invalid_request', [-32601]: 'method_not_found', [-32602]: 'invalid_params',
        // MCP event errors (events/protocol.ts)
        [-32011]: 'not_found', [-32012]: 'forbidden', [-32013]: 'resource_exhausted', [-32014]: 'unsupported', [-32015]: 'callback_failed' } as Record<number, string>)[Number(error.code)] ?? 'protocol_error';
}

function resultSummary(method: McpCall['method'], result: ObjectValue): McpCall['result'] {
    if (method === 'resources/read') {
        const contents = Array.isArray(result.contents) ? result.contents.map(record) : [];
        return { bytes: contents.reduce((sum, item) => sum + (typeof item.blob === 'string' ? Buffer.byteLength(item.blob, 'base64')
            : typeof item.text === 'string' ? Buffer.byteLength(item.text) : 0), 0) };
    }
    if (method === 'events/poll') {
        const events = Array.isArray(result.events) ? result.events : [];
        return { items: events.length, more: result.hasMore === true, ...(result.truncated === true ? { truncated: true as const } : {}) };
    }
    if (method !== 'tools/call') return undefined;
    const content = Array.isArray(result.content) ? result.content.map(record) : [];
    const data = record(result.structuredContent);
    const items = Array.isArray(data.items) ? data.items : undefined;
    const itemErrors = new Map<string, number>();
    for (const item of items ?? []) {
        const value = record(item).error;
        if (typeof value === 'string' && codePattern.test(value)) itemErrors.set(value, (itemErrors.get(value) ?? 0) + 1);
    }
    return { bytes: content.reduce((sum, item) => sum + (typeof item.text === 'string' ? Buffer.byteLength(item.text) : 0), 0),
        ...(items ? { items: items.length } : {}),
        ...('nextCursor' in data ? { more: data.nextCursor !== null && data.nextCursor !== undefined } : {}),
        ...('hasMore' in data ? { more: data.hasMore === true } : {}),
        ...(Array.isArray(data.remainingIds) ? { remaining: data.remainingIds.length } : {}),
        ...(data.truncated === true ? { truncated: true as const } : {}),
        ...(itemErrors.size ? { itemErrors: Object.fromEntries(itemErrors) } : {}) };
}

function emitEvent(event: McpRequestEvent) {
    const line = JSON.stringify(event);
    // Unexpected failures are errors in the hosting logs; everything else is information.
    if (event.failure || event.calls.some(call => call.failure)) console.error(line);
    else console.info(line);
}

/** Records the handler's error for the request it is answering; tools, prompts and resources call this from their catch blocks. */
export function noteMcpError(error: unknown) {
    const current = calls.getStore();
    if (current) current.log.note(current.id, error);
    else if (!(error instanceof ApiError)) console.error('[mcp] Request failed', failureOf(error).name);
}

export class McpRequestLog {
    private readonly started = performance.now();
    private readonly tools = new Map<string, Input>();
    private readonly prompts = new Map<string, Input>();
    private readonly resources = new Map<string, (uri: string) => boolean>();
    private readonly events = new Set<string>();
    private readonly responses = new Map<RequestId, ObjectValue>();
    private readonly notes = new Map<RequestId, Note>();
    private messages: unknown[] = [];
    private identity?: McpIdentity;
    private interruption?: 'timeout' | 'cancelled';
    private rejection?: { error: unknown };
    private done = false;

    constructor(private readonly request: Request, private readonly emit: (event: McpRequestEvent) => void = emitEvent) {}

    authenticated(identity: McpIdentity) { this.identity = identity; }
    received(body: unknown) { this.messages = Array.isArray(body) ? body : [body]; }
    interrupted(reason: 'timeout' | 'cancelled') { this.interruption ??= reason; }
    rejected(error: unknown) { this.rejection ??= { error }; }
    note(id: RequestId, error: unknown) { if (!this.done && !this.notes.has(id)) this.notes.set(id, describeError(error)); }

    /** Runs a request handler where `noteMcpError` can find the request it answers (its last argument carries the id). */
    inRequest<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
        return (...args) => {
            const id = requestId(record(args.at(-1)).requestId);
            return id === undefined ? callback(...args) : calls.run({ log: this, id }, () => callback(...args));
        };
    }

    /** Event names `events/subscribe`, `events/unsubscribe` and `events/poll` are logged by. */
    watchEvents(names: readonly string[]) { for (const name of names) this.events.add(name); }

    /** Learns each registration's input schema and runs its handler where `noteMcpError` can find this request. */
    watch(server: McpServer) {
        const inContext = (callback: Callback): Callback => this.inRequest(callback);
        const registerTool = server.registerTool.bind(server);
        server.registerTool = ((name: string, config: { inputSchema?: unknown }, callback: Callback) => {
            this.tools.set(name, inputOf(config.inputSchema));
            return registerTool(name, config as never, inContext(callback) as never);
        }) as unknown as McpServer['registerTool'];
        const registerPrompt = server.registerPrompt.bind(server);
        server.registerPrompt = ((name: string, config: { argsSchema?: unknown }, callback: Callback) => {
            this.prompts.set(name, inputOf(config.argsSchema));
            return registerPrompt(name, config as never, inContext(callback) as never);
        }) as unknown as McpServer['registerPrompt'];
        const registerResource = server.registerResource.bind(server);
        server.registerResource = ((name: string, target: string | ResourceTemplate, config: unknown, callback: Callback) => {
            this.resources.set(name, typeof target === 'string' ? uri => uri === target : uri => Boolean(target.uriTemplate.match(uri)));
            return registerResource(name, target as never, config as never, inContext(callback) as never);
        }) as unknown as McpServer['registerResource'];
    }

    /** Sees each JSON-RPC answer the server sends for this request. */
    observe(transport: WebStandardStreamableHTTPServerTransport) {
        const send = transport.send.bind(transport);
        transport.send = (message, options) => {
            const reply = record(message);
            const id = requestId(reply.id);
            if (!this.done && id !== undefined && ('result' in reply || 'error' in reply) && !this.responses.has(id)) this.responses.set(id, reply);
            return send(message, options);
        };
    }

    /** Emits the event once. Logging never changes or fails the response. */
    async finish(response: Response) {
        if (this.done) return;
        try { this.emit(await this.event(response.status)); }
        catch { /* Telemetry must not fail an MCP request. */ }
        finally { this.done = true; }
    }

    private async event(status: number): Promise<McpRequestEvent> {
        const entries: McpCall[] = [];
        for (const message of this.messages.slice(0, MAX_CALLS)) entries.push(await this.call(message, status));
        const identity = this.identity;
        const initialize = this.messages.map(record).find(message => message.method === 'initialize');
        const info = record(record(initialize?.params).clientInfo);
        const clientVersion = label(info.version, 32);
        const protocolVersion = [this.request.headers.get('mcp-protocol-version'), record(initialize?.params).protocolVersion]
            .find((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
        return {
            event: 'mcp_request', version: 1, id: randomUUID(), timestamp: new Date().toISOString(), environment: logEnvironment(),
            httpMethod: (['POST', 'GET', 'DELETE'] as const).find(method => method === this.request.method) ?? 'other',
            status, durationMs: Math.max(0, Math.round(performance.now() - this.started)),
            ...this.outcome(status),
            ...(protocolVersion ? { protocolVersion } : {}),
            ...(initialize && info.name !== undefined ? { client: { name: label(info.name, 64) ?? 'other', ...(clientVersion ? { version: clientVersion } : {}) } } : {}),
            ...(identity ? { connection: { kind: identity.connection.kind,
                ref: keyedHash('mcp-log-connection', identity.connection.id).slice(0, 16),
                user: keyedHash('mcp-log-user', identity.user.id).slice(0, 16),
                scopes: mcpScopes.filter(scope => identity.scopes.includes(scope)), access: identity.access.kind } } : {}),
            calls: entries,
            ...(this.messages.length > MAX_CALLS ? { omittedCalls: this.messages.length - MAX_CALLS } : {}),
        };
    }

    private outcome(status: number): Pick<McpRequestEvent, 'outcome' | 'error' | 'reason' | 'authentication' | 'failure'> {
        if (this.interruption) return { outcome: 'interrupted', error: this.interruption };
        const error = this.rejection?.error;
        if (error instanceof ApiError) return { outcome: 'rejected', error: error.code, ...(error.reason ? { reason: error.reason } : {}),
            ...(error instanceof McpAuthenticationError ? { authentication: error.tokenPresented ? 'invalid' : 'missing' } : {}) };
        if (this.rejection) return { outcome: 'failed', error: 'server_error', failure: failureOf(error) };
        if (status === 405) return { outcome: 'rejected', error: 'method_not_allowed' };
        // The transport itself refused the request, for example a missing Accept header.
        if (status >= 400) return { outcome: 'rejected', error: 'transport_error' };
        return { outcome: 'handled' };
    }

    private async call(raw: unknown, status: number): Promise<McpCall> {
        const message = record(raw);
        const method = typeof message.method === 'string' && methodNames.has(message.method) ? message.method as McpCall['method'] : 'other';
        const params = record(message.params);
        const input = method === 'tools/call' ? this.tools.get(String(params.name))
            : method === 'prompts/get' ? this.prompts.get(String(params.name)) : undefined;
        const call: McpCall = { method, outcome: 'unanswered' };
        if (method === 'tools/call' || method === 'prompts/get') {
            call.name = input ? String(params.name) : 'unknown';
            if (input) Object.assign(call, summarizeArguments(params.arguments, input.shape));
            else if (typeof params.name === 'string' && requestedNamePattern.test(params.name)) call.requestedName = params.name;
        }
        if (method === 'resources/read') call.name = this.resource(params.uri);
        // The event name only: never the arguments, callback URL or secret.
        if (method === 'events/subscribe' || method === 'events/unsubscribe' || method === 'events/poll') {
            call.name = this.events.has(String(params.name)) ? String(params.name) : 'unknown';
            if (call.name === 'unknown' && typeof params.name === 'string' && requestedNamePattern.test(params.name)) call.requestedName = params.name;
        }
        const id = requestId(message.id);
        if (typeof message.method !== 'string' || id === undefined) {
            call.outcome = status < 400 ? 'accepted' : 'unanswered';
            return call;
        }
        const reply = this.responses.get(id);
        if (!reply) return call;
        const note = this.notes.get(id);
        if ('error' in reply) {
            const error = record(reply.error);
            Object.assign(call, { outcome: 'error' }, Number.isInteger(error.code) ? { rpcError: error.code } : {},
                note ?? { error: protocolError(method, call.name, error) });
        } else {
            const result = record(reply.result);
            if (method === 'tools/call' && result.isError === true) Object.assign(call, { outcome: 'tool_error' }, note ?? { error: toolError(call.name, result) });
            else call.outcome = 'success';
            const summary = resultSummary(method, result);
            if (summary) call.result = summary;
        }
        if (call.error === 'invalid_arguments' && input && !call.issues) {
            const issues = await validationIssues(input, params.arguments);
            if (issues) call.issues = issues;
        }
        return call;
    }

    private resource(uri: unknown) {
        if (typeof uri !== 'string') return 'unknown';
        for (const [name, matches] of this.resources) {
            try { if (matches(uri)) return name; } catch { /* An unmatchable address names no resource. */ }
        }
        return 'unknown';
    }
}
