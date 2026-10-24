import type { z } from 'zod';
import { MAX_BODY_BYTES } from './limits';
import { describeValidationError } from './validation';
import { resolveVisitor, type Visitor } from './visitor';

export type ApiErrorCode =
    | 'invalid_request'
    | 'forbidden'
    | 'bot_detected'
    | 'not_found'
    | 'too_large'
    | 'rate_limited'
    | 'server_error';

export type ApiErrorBody = {
    error: ApiErrorCode;
    message: string;
};

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: ApiErrorCode,
        message: string,
        readonly retryAfterSeconds?: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const apiErrors = {
    invalidRequest: (message: string) => new ApiError(400, 'invalid_request', message),
    forbidden: (message = 'Only the author can do this.') => new ApiError(403, 'forbidden', message),
    botDetected: () => new ApiError(403, 'bot_detected', 'Automated requests are not allowed. Please try again from your browser.'),
    notFound: (message = 'Comment not found.') => new ApiError(404, 'not_found', message),
    tooLarge: () => new ApiError(413, 'too_large', `Request body is too large (maximum ${MAX_BODY_BYTES} bytes).`),
    rateLimited: (message: string, retryAfterSeconds: number) => new ApiError(429, 'rate_limited', message, retryAfterSeconds)
};

function errorResponse(error: unknown) {
    if (error instanceof ApiError) {
        const headers = new Headers();
        if (error.retryAfterSeconds !== undefined)
            headers.set('Retry-After', String(error.retryAfterSeconds));
        return Response.json({ error: error.code, message: error.message } satisfies ApiErrorBody, { status: error.status, headers });
    }

    console.error('[comments] Unhandled error', error);
    return Response.json({ error: 'server_error', message: 'Something went wrong. Please try again later.' } satisfies ApiErrorBody, { status: 500 });
}

// Host header (with optional port), e.g. uier.io, my-preview.vercel.app, localhost:4004, [::1]:4004
const hostPattern = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/** Comments are partitioned by the request host */
function resolveDomain(request: Request) {
    const host = request.headers.get('host')?.trim().toLowerCase();
    if (!host || host.length > 255 || !hostPattern.test(host))
        throw apiErrors.invalidRequest('Couldn\'t resolve the domain.');
    return host;
}

async function readBodyText(request: Request) {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
        throw apiErrors.tooLarge();

    if (!request.body)
        throw apiErrors.invalidRequest('Request body is required.');

    // Read incrementally so bodies without (or with a wrong) Content-Length can't exceed the limit
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;

        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw apiErrors.tooLarge();
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw apiErrors.invalidRequest('Request body must be UTF-8 encoded JSON.');
    }
}

/** Reads (max {@link MAX_BODY_BYTES}) and validates a JSON body. Unknown fields are stripped. */
export async function parseJsonBody<TSchema extends z.ZodType>(request: Request, schema: TSchema): Promise<z.output<TSchema>> {
    const text = await readBodyText(request);
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        throw apiErrors.invalidRequest('Request body must be valid JSON.');
    }

    const result = schema.safeParse(json);
    if (!result.success)
        throw apiErrors.invalidRequest(describeValidationError(result.error));
    return result.data;
}

export type CommentsApiContext = {
    request: Request;
    domain: string;
    visitor: Visitor;
};

/**
 * Wraps a comments API route handler: resolves the domain and the anonymous visitor (setting the
 * visitor cookie when missing), maps errors to `{ error, message }` responses and disables caching.
 */
export function commentsApiHandler<TParams extends Record<string, string> = Record<string, never>>(
    handler: (context: CommentsApiContext, params: TParams) => Promise<Response>
) {
    return async (request: Request, routeContext: { params: Promise<TParams> }) => {
        const visitor = resolveVisitor(request);

        let response: Response;
        try {
            const domain = resolveDomain(request);
            response = await handler({ request, domain, visitor }, await routeContext.params);
        } catch (error) {
            response = errorResponse(error);
        }

        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        if (visitor.setCookie)
            headers.append('Set-Cookie', visitor.setCookie);

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
        });
    };
}
