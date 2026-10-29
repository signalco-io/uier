export type OAuthErrorCode =
    | 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type'
    | 'invalid_scope' | 'invalid_target' | 'access_denied' | 'unsupported_response_type' | 'interaction_required'
    | 'invalid_redirect_uri' | 'invalid_client_metadata' | 'slow_down' | 'server_error' | 'temporarily_unavailable';

/** An RFC 6749 error with its HTTP status (400 unless stated) */
export class OAuthError extends Error {
    constructor(readonly code: OAuthErrorCode, readonly description: string, readonly status = code === 'invalid_client' ? 401 : 400, readonly retryAfterSeconds?: number) {
        super(description);
        this.name = 'OAuthError';
    }
}

export const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' } as const;

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return Response.json(body, { status, headers: { ...noStoreHeaders, ...headers } });
}

export function oauthErrorResponse(error: unknown) {
    if (error instanceof OAuthError)
        return oauthJson({ error: error.code, error_description: error.description }, error.status,
            error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {});
    // Never log tokens, codes, verifiers, states or request bodies.
    console.error('[oauth] Request failed', error instanceof Error ? error.name : 'unknown');
    return oauthJson({ error: 'server_error', error_description: 'The request failed. Try again.' }, 500);
}
