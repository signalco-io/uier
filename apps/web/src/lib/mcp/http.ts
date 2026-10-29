import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { authenticateMcp, McpAuthenticationError } from '@/src/lib/mcp/credentials';
import { mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { bearerChallenge } from '@/src/lib/mcp/oauth/metadata';
import { createFeedbackMcpServer } from '@/src/lib/mcp/server';
import { ApiError, apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { keyedHash } from '@/src/lib/comments/environment';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const promptRequestSchema = z.object({ params: z.object({ arguments: z.record(z.string(), z.string()).optional() }) });

export async function handleMcp(request: Request, allowedOrigin: string, deadlineMs = 25_000) {
    let response: Response;
    try {
        const origin = request.headers.get('origin');
        if (origin && origin !== allowedOrigin) throw apiErrors.forbidden('Origin is not allowed.');
        const identity = await authenticateMcp(request, allowedOrigin);
        const window = Math.floor(Date.now() / 60_000);
        if (!await getCommentsStore().incrementCounter('$mcp', `counter_${keyedHash('mcp-request', `${identity.user.id}:${window}`)}`, 120, 120))
            throw apiErrors.rateLimited('MCP request limit reached. Try again in one minute.', 60, 'too_fast');
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
        const parsedBody = await parseJsonBody(request, z.unknown(), 16_384);
        // SDK record validation reports arbitrary argument keys in its diagnostics. Reject
        // non-string prompt arguments here without reflecting any submitted content.
        const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
        if (messages.some(message => message && typeof message === 'object' && 'method' in message && message.method === 'prompts/get'
            && !promptRequestSchema.safeParse(message).success))
            throw apiErrors.invalidRequest('Invalid prompt arguments.');
        const server = createFeedbackMcpServer(identity, request, allowedOrigin);
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort = () => {};
        try {
            const interrupted = new Promise<Response>(resolve => {
                const id = parsedBody && typeof parsedBody === 'object' && 'id' in parsedBody
                    && (typeof parsedBody.id === 'string' || typeof parsedBody.id === 'number') ? parsedBody.id : null;
                const error = (status: number, message: string) => resolve(Response.json({ jsonrpc: '2.0', id,
                    error: { code: ErrorCode.InternalError, message } }, { status }));
                timer = setTimeout(() => error(504, 'The request timed out.'), deadlineMs);
                onAbort = () => error(408, 'The request was cancelled.');
                request.signal.addEventListener('abort', onAbort, { once: true });
                if (request.signal.aborted) onAbort();
            });
            response = await Promise.race([interrupted, (async () => {
                if (request.signal.aborted) return interrupted;
                await server.connect(transport);
                return transport.handleRequest(request, { parsedBody });
            })()]);
        } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', onAbort);
            await server.close();
        }
    } catch (error) {
        response = errorResponse(error);
        // The challenge points OAuth clients to discovery (RFC 9728); allowedOrigin is the issuer.
        if (error instanceof ApiError && error.status === 401)
            response.headers.set('WWW-Authenticate', mcpOauthEnabled()
                ? bearerChallenge(allowedOrigin, error instanceof McpAuthenticationError && error.tokenPresented)
                : 'Bearer realm="uier MCP"');
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
}
