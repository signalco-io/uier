import type { z } from 'zod';
import { MAX_BODY_BYTES } from './limits';
import { describeValidationError } from './validation';
import { resolveVisitor, type Visitor } from './visitor';
import { ensurePublicProject, PUBLIC_PROJECT_PARTITION, usesPublicProject } from './publicProject';
import { getProject } from '../app/projects';
import { assertCanUseComments, memberActor, type ProjectActor } from '../review/actor';
import { requestSessionUser } from '../app/sessionIdentity';

export type ApiErrorCode =
    | 'invalid_request'
    | 'forbidden'
    | 'bot_detected'
    | 'not_found'
    | 'conflict'
    | 'too_large'
    | 'unsupported_media_type'
    | 'rate_limited'
    | 'unavailable'
    | 'server_error'
    /** Project comments: the project turned comments off */
    | 'comments_disabled'
    /** Project comments: only signed-in members with access can do this */
    | 'sign_in_required';

/** Why a request was rate limited: the visitor (or their network) writes too fast, or the page had enough comments today */
export type RateLimitReason = 'too_fast' | 'page_full';

export type ApiErrorBody = {
    error: ApiErrorCode;
    message: string;
    /** Only with `rate_limited` */
    reason?: RateLimitReason;
};

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: ApiErrorCode,
        message: string,
        readonly retryAfterSeconds?: number,
        readonly reason?: RateLimitReason
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
    conflict: () => new ApiError(409, 'conflict', 'The comment changed while saving. Please try again.', 1),
    tooLarge: (maxBytes = MAX_BODY_BYTES) => new ApiError(413, 'too_large', `Request body is too large (maximum ${maxBytes} bytes).`),
    unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Request body must be sent as application/json.'),
    rateLimited: (message: string, retryAfterSeconds: number, reason: RateLimitReason) => new ApiError(429, 'rate_limited', message, retryAfterSeconds, reason),
    commentsDisabled: () => new ApiError(403, 'comments_disabled', 'Comments are turned off for this project.'),
    signInRequired: () => new ApiError(401, 'sign_in_required', 'Sign in to see and leave comments on this project.'),
    unavailable: (message: string) => new ApiError(503, 'unavailable', message)
};

export function errorResponse(error: unknown) {
    if (error instanceof ApiError) {
        const headers = new Headers();
        if (error.retryAfterSeconds !== undefined)
            headers.set('Retry-After', String(error.retryAfterSeconds));
        return Response.json({ error: error.code, message: error.message, reason: error.reason } satisfies ApiErrorBody, { status: error.status, headers });
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

async function readBodyText(request: Request, maxBytes: number) {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes)
        throw apiErrors.tooLarge(maxBytes);

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
        if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw apiErrors.tooLarge(maxBytes);
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

/**
 * Reads (max {@link MAX_BODY_BYTES}) and validates a JSON body. Unknown fields are stripped.
 * Only `application/json` is accepted: other types could be sent cross-site without a CORS preflight.
 */
/** The JSON body, validated; at most `maxBytes` (a new comment with a screenshot may be larger) */
export async function parseJsonBody<TSchema extends z.ZodType>(request: Request, schema: TSchema, maxBytes = MAX_BODY_BYTES): Promise<z.output<TSchema>> {
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json')
        throw apiErrors.unsupportedMediaType();

    const text = await readBodyText(request, maxBytes);
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

function isWrite(request: Request) {
    return request.method !== 'GET' && request.method !== 'HEAD';
}

/**
 * Writes are accepted only from pages on the API's own origin (the toolbar on this site). Until a
 * deliberate CORS policy for customer sites exists, cross-site writes are rejected.
 */
function assertSameOrigin(request: Request, domain: string) {
    const crossSite = apiErrors.forbidden('Cross-site requests are not allowed.');
    if (request.headers.get('sec-fetch-site') === 'cross-site')
        throw crossSite;

    const origin = request.headers.get('origin');
    if (origin === null)
        return;

    let originHost: string;
    try {
        originHost = new URL(origin).host.toLowerCase();
    } catch {
        throw crossSite;
    }
    if (originHost !== domain)
        throw crossSite;
}

export type CommentsApiHandlerOptions = {
    /** Whether a write creates the visitor identity when there is none (default `true`); not for signing out */
    createVisitor?: boolean;
};

/**
 * Wraps a comments API route handler: resolves the domain and the account or guest, maps errors to
 * `{ error, message }` responses and disables caching. The visitor cookie is created only by a
 * successful write, so reading comments never places a cookie.
 */
export function commentsApiHandler<TParams extends Record<string, string> = Record<string, never>>(
    handler: (context: CommentsApiContext, params: TParams) => Promise<Response>,
    { createVisitor = true }: CommentsApiHandlerOptions = {}
) {
    return async (request: Request, routeContext: { params: Promise<TParams> }) => {
        const write = isWrite(request);
        let visitor: Visitor = {};

        let response: Response;
        try {
            const domain = resolveDomain(request);
            if (write)
                assertSameOrigin(request, domain);
            const publicProject = usesPublicProject(domain);
            const provisioned = publicProject ? await ensurePublicProject() : null;
            // Provisioning is cached; access settings must always come from the current document.
            const project = provisioned ? await getProject(provisioned.workspaceId, provisioned.id) : null;
            if (publicProject && !project) throw apiErrors.notFound('Project not found.');
            const user = publicProject ? await requestSessionUser(request) : null;
            const member = user && project ? await memberActor(project, user.id) : null;
            visitor = user && member
                ? { authorId: `user:${user.id}`, name: user.name, member: true }
                : resolveVisitor(request, write && createVisitor);
            const actor: ProjectActor = member ?? (visitor.authorId ? { kind: 'guest', visitorId: visitor.authorId } : { kind: 'anonymous' });
            if (project) assertCanUseComments(project, actor);
            response = await handler({ request, domain: publicProject ? PUBLIC_PROJECT_PARTITION : domain, visitor }, await routeContext.params);
        } catch (error) {
            response = errorResponse(error);
        }

        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        if (visitor.setCookie && response.ok)
            headers.append('Set-Cookie', visitor.setCookie);

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
        });
    };
}

/** The visitor's author id; writes always have one (`resolveVisitor` creates it) */
export function writerId(context: CommentsApiContext) {
    if (!context.visitor.authorId)
        throw new Error('Writes need a visitor identity');
    return context.visitor.authorId;
}
