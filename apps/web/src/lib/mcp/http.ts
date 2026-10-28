import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { authenticateMcp } from '@/src/lib/mcp/credentials';
import { createFeedbackMcpServer } from '@/src/lib/mcp/server';
import { ApiError, apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { keyedHash } from '@/src/lib/comments/environment';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

const promptRequestSchema = z.object({ params: z.object({ arguments: z.record(z.string(), z.string()).optional() }) });

export async function handleMcp(request: Request, allowedOrigin: string) {
    let response: Response;
    try {
        const origin = request.headers.get('origin');
        if (origin && origin !== allowedOrigin) throw apiErrors.forbidden('Origin is not allowed.');
        const identity = await authenticateMcp(request);
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
        try {
            await server.connect(transport);
            response = await transport.handleRequest(request, { parsedBody });
        } finally { await server.close(); }
    } catch (error) {
        response = errorResponse(error);
        if (error instanceof ApiError && error.status === 401)
            response.headers.set('WWW-Authenticate', 'Bearer realm="uier MCP"');
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
}
