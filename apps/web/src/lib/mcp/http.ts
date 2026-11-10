import { classifyInboundRequest, createMcpHandler, ProtocolErrorCode, WebStandardStreamableHTTPServerTransport, type McpHttpHandler, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { authenticateMcp, McpAuthenticationError } from '@/src/lib/mcp/credentials';
import { mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { bearerChallenge } from '@/src/lib/mcp/oauth/metadata';
import { createFeedbackMcpServer } from '@/src/lib/mcp/server';
import { eventNameHeaderRejection, isEventStreamRequest } from '@/src/lib/mcp/events/protocol';
import type { StreamOptions } from '@/src/lib/mcp/events/stream';
import { McpRequestLog, type McpRequestEvent } from '@/src/lib/mcp/telemetry';
import { ApiError, apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { keyedHash } from '@/src/lib/comments/environment';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

/*
 * The MCP endpoint serves two protocol eras from one server definition. A request that carries the
 * 2026-07-28 per-request envelope goes to the SDK's stateless entry (`server/discover`, standard
 * headers, `resultType`); anything else is a 2025-era request (the `initialize` handshake and what
 * follows it) and gets the stateless Streamable HTTP transport. Both answer with one JSON body,
 * except a push stream (`events/stream`), which is the only response that stays open.
 */

const promptRequestSchema = z.object({ params: z.object({ arguments: z.record(z.string(), z.string()).optional() }) });

type McpOptions = {
    /** Deadline for the answer, inside the route's limit; a push stream that has opened has its own lifetime instead */
    deadlineMs?: number;
    /** Receives the request's `mcp_request` event; server logs by default */
    emit?: (event: McpRequestEvent) => void;
    /** Push stream timing (API specs) */
    stream?: StreamOptions;
};

/** The server built for a 2026-07-28 request, handed to the SDK entry when it asks for one. */
const servers = new WeakMap<Request, McpServer>();
let modern: McpHttpHandler | undefined;
function modernEntry() {
    return modern ??= createMcpHandler(context => {
        const server = context.requestInfo && servers.get(context.requestInfo);
        if (!server) throw new Error('No server was prepared for this request.');
        return server;
    }, {
        legacy: 'reject',
        // A push stream keeps itself alive with heartbeats that carry its position; SSE comments cannot (SEP-3415).
        keepAliveMs: 0,
        // Rejections quote the request; only unexpected failures are worth a line, without their message.
        onerror: error => { if (!error.message.startsWith('Rejected ')) console.error('[mcp] Protocol entry failed', error.name); }
    });
}

const isStream = (response: Response) => Boolean(response.body) && (response.headers.get('content-type') ?? '').startsWith('text/event-stream');

/** The same response; `done` runs once, when its body has been sent, failed or was abandoned by the client. */
function whenSent(response: Response, done: () => void) {
    const reader = response.body!.getReader();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done: ended, value } = await reader.read();
                if (ended) { finish(); controller.close(); return; }
                if (value !== undefined) controller.enqueue(value);
            } catch (error) { finish(); controller.error(error); }
        },
        cancel(reason) { finish(); return reader.cancel(reason).catch(() => undefined); }
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function handleMcp(request: Request, allowedOrigin: string, { deadlineMs = 25_000, emit, stream }: McpOptions = {}) {
    const log = new McpRequestLog(request, emit);
    /** What an open stream still holds; runs when it ends */
    const held: (() => void)[] = [];
    const response = await respond(request, allowedOrigin, deadlineMs, log, held, stream);
    // A stream is answered over its lifetime: its server closes and its event is written when it ends.
    if (isStream(response)) return whenSent(response, () => { for (const release of held) release(); void log.finish(response); });
    await log.finish(response);
    return response;
}

async function respond(request: Request, allowedOrigin: string, deadlineMs: number, log: McpRequestLog, held: (() => void)[], stream?: StreamOptions) {
    let response: Response;
    try {
        const origin = request.headers.get('origin');
        if (origin && origin !== allowedOrigin) throw apiErrors.forbidden('Origin is not allowed.');
        const identity = await authenticateMcp(request, allowedOrigin);
        log.authenticated(identity);
        const window = Math.floor(Date.now() / 60_000);
        if (!await getCommentsStore().incrementCounter('$mcp', `counter_${keyedHash('mcp-request', `${identity.user.id}:${window}`)}`, 120, 120))
            throw apiErrors.rateLimited('MCP request limit reached. Try again in one minute.', 60, 'too_fast');
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
        const parsedBody = await parseJsonBody(request, z.unknown(), 16_384);
        log.received(parsedBody);
        // Registers the tools and prompts, so a rejected request below still names what it called.
        const server = createFeedbackMcpServer(identity, request, allowedOrigin, log, { stream });
        // SDK record validation reports arbitrary argument keys in its diagnostics. Reject
        // non-string prompt arguments here without reflecting any submitted content.
        const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
        if (messages.some(message => message && typeof message === 'object' && 'method' in message && message.method === 'prompts/get'
            && !promptRequestSchema.safeParse(message).success))
            throw apiErrors.invalidRequest('Invalid prompt arguments.');

        const route = classifyInboundRequest({ httpMethod: request.method, body: parsedBody,
            protocolVersionHeader: request.headers.get('mcp-protocol-version') ?? undefined,
            mcpMethodHeader: request.headers.get('mcp-method') ?? undefined, mcpNameHeader: request.headers.get('mcp-name') ?? undefined });
        // After the SDK's own header checks would pass: it answers a missing version or method header first.
        const mismatch = route.kind === 'modern' && route.messageKind === 'request' && request.headers.has('mcp-protocol-version') && request.headers.has('mcp-method')
            ? eventNameHeaderRejection(request.headers, route.message) : null;
        const serve = async () => {
            if (mismatch) return mismatch;
            if (route.kind !== 'legacy') {
                servers.set(request, server);
                return modernEntry().fetch(request, { parsedBody });
            }
            // A push stream is the one 2025-era answer that cannot be a single JSON body.
            const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: !isEventStreamRequest(parsedBody), keepAliveMs: 0 });
            await server.connect(transport);
            return transport.handleRequest(request, { parsedBody });
        };
        const close = () => { void server.close().catch(() => undefined); };

        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort = () => {};
        let streaming = false;
        try {
            const interrupted = new Promise<Response>(resolve => {
                const id = parsedBody && typeof parsedBody === 'object' && 'id' in parsedBody
                    && (typeof parsedBody.id === 'string' || typeof parsedBody.id === 'number') ? parsedBody.id : null;
                const error = (status: number, message: string) => {
                    // An open stream ends with its server; there is no other answer to give any more.
                    if (streaming) { close(); return; }
                    log.interrupted(status === 504 ? 'timeout' : 'cancelled');
                    resolve(Response.json({ jsonrpc: '2.0', id, error: { code: ProtocolErrorCode.InternalError, message } }, { status }));
                };
                // The deadline for an answer to begin. A push stream that has opened ends itself (`events/stream.ts`).
                timer = setTimeout(() => error(504, 'The request timed out.'), deadlineMs);
                onAbort = () => error(408, 'The request was cancelled.');
                request.signal.addEventListener('abort', onAbort, { once: true });
                if (request.signal.aborted) onAbort();
            });
            response = await Promise.race([interrupted, (async () => request.signal.aborted ? interrupted : serve())()]);
            streaming = isStream(response);
        } finally {
            clearTimeout(timer);
            if (!streaming) {
                request.signal.removeEventListener('abort', onAbort);
                await server.close();
            }
        }
        if (streaming) held.push(() => { request.signal.removeEventListener('abort', onAbort); close(); });
        // The 2026-07-28 entry refuses a request it cannot serve with an HTTP error and a JSON-RPC error body.
        else if (response.status >= 400 && route.kind !== 'legacy')
            log.refused(await response.clone().json().then(body => (body as { error?: { code?: unknown } } | null)?.error?.code, () => undefined));
    } catch (error) {
        log.rejected(error);
        response = errorResponse(error);
        // The challenge points OAuth clients to discovery (RFC 9728); allowedOrigin is the issuer.
        if (error instanceof ApiError && error.status === 401)
            response.headers.set('WWW-Authenticate', mcpOauthEnabled()
                ? bearerChallenge(allowedOrigin, error instanceof McpAuthenticationError && error.tokenPresented)
                : 'Bearer realm="uier MCP"');
    }
    // A stream also tells intermediaries not to buffer or re-encode it.
    response.headers.set('Cache-Control', isStream(response) ? 'private, no-store, no-transform' : 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
}
