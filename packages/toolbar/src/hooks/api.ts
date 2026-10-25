import { toolbarConfig } from '../config';
import { getVisitorToken, projectHeaders } from '../project/projectSession';
import { reviewVerification } from '../project/verification';

// Requests to the uier API (comments, visitor) and the query keys of its data

/**
 * Error codes returned by the comments API (`{ error, message }` bodies), plus
 * `network_error` when the API could not be reached.
 */
export type CommentsApiErrorCode =
    | 'invalid_request'
    | 'forbidden'
    | 'bot_detected'
    | 'not_found'
    | 'too_large'
    | 'rate_limited'
    | 'unavailable'
    | 'server_error'
    /** A project's comments: the project turned comments off */
    | 'comments_disabled'
    /** A project's comments: only signed-in members with access can do this */
    | 'sign_in_required'
    | 'network_error';

export type CommentsRateLimitReason = 'too_fast' | 'page_full';

export class CommentsApiError extends Error {
    readonly code: CommentsApiErrorCode | (string & {});
    readonly status: number;
    /** Seconds until the request may be retried (`Retry-After`), for `rate_limited` */
    readonly retryAfter?: number;
    /**
     * Why a request was rate limited: `too_fast` (this visitor sends too much) or `page_full`
     * (the page has too many open comments). A missing reason means `too_fast`.
     */
    readonly reason?: CommentsRateLimitReason | (string & {});

    constructor(code: CommentsApiError['code'], message: string, status: number, retryAfter?: number, reason?: string) {
        super(message);
        this.name = 'CommentsApiError';
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
        this.reason = reason;
    }
}

function errorCodeFromStatus(status: number): CommentsApiErrorCode {
    switch (status) {
        case 400: return 'invalid_request';
        case 403: return 'forbidden';
        case 404: return 'not_found';
        case 413: return 'too_large';
        case 429: return 'rate_limited';
        default: return 'server_error';
    }
}

/** A request to the uier API, answered with 2xx; errors are thrown as {@link CommentsApiError} */
async function apiFetch(url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<Response> {
    const hasBody = init?.body !== undefined;
    const crossOriginWrite = toolbarConfig.project && init?.method && init.method !== 'GET'
        && new URL(url).origin !== window.location.origin;
    let verification: string | undefined;
    if (crossOriginWrite) {
        try {
            verification = await reviewVerification();
        } catch {
            throw new CommentsApiError('bot_detected', 'Browser verification failed.', 403);
        }
    }
    let response: Response;
    try {
        response = await fetch(url, {
            method: init?.method ?? 'GET',
            // Anonymous visitor identity is the API's HttpOnly `uier_visitor` cookie. A project's
            // reviewers are identified by headers instead: the API is on another site than the
            // reviewed one, where its cookies would be third-party cookies.
            credentials: toolbarConfig.project ? 'omit' : 'include',
            headers: {
                ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
                ...(toolbarConfig.project ? projectHeaders() : { 'X-Uier-Visitor': getVisitorToken() }),
                ...(verification ? { 'X-Uier-Verification': verification } : {})
            },
            body: hasBody ? JSON.stringify(init.body) : undefined
        });
    } catch (error) {
        throw new CommentsApiError('network_error', error instanceof Error ? error.message : 'Network error', 0);
    }

    if (!response.ok) {
        let body: { error?: unknown; message?: unknown; reason?: unknown } | undefined;
        try {
            body = await response.json() as typeof body;
        } catch {
            body = undefined;
        }

        // Readable cross-origin only when the API exposes it (Access-Control-Expose-Headers)
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new CommentsApiError(
            typeof body?.error === 'string' ? body.error : errorCodeFromStatus(response.status),
            typeof body?.message === 'string' ? body.message : response.statusText,
            response.status,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
            typeof body?.reason === 'string' ? body.reason : undefined);
    }
    return response;
}

/** A request to the uier API with a JSON answer; errors are thrown as {@link CommentsApiError} */
export async function apiRequest<T>(url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T | undefined> {
    const response = await apiFetch(url, init);
    if (response.status === 204) {
        return undefined;
    }

    const text = await response.text();
    return text.length ? JSON.parse(text) as T : undefined;
}

/**
 * An image of the uier API as a data URL. Fetched, not loaded by an `<img src>`: a project's
 * reviewers are identified by headers, and a reviewed site's CSP allows `data:` images (the
 * install guide's sources) but not necessarily the API's origin.
 */
export async function apiImage(url: string): Promise<string> {
    const blob = await (await apiFetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new CommentsApiError('network_error', 'The image could not be read', 0));
        reader.readAsDataURL(blob);
    });
}

export function required<T>(value: T | undefined): T {
    if (value === undefined) {
        throw new CommentsApiError('server_error', 'Empty response', 200);
    }
    return value;
}

/** Prefix of the comments queries of every page */
export const commentsQueryKeyPrefix = ['comments'] as const;

export const visitorQueryKey = ['visitor'] as const;

/** Screenshots of comments (`GET .../comments/<id>/screenshot`), per comment */
export const screenshotQueryKey = (commentId: string) => ['screenshot', commentId] as const;

/** A project's reviewer and settings (project/ProjectGate.tsx) */
export const projectViewerQueryKey = ['project-viewer'] as const;
