import { z } from 'zod';
import type { AppDoc, DbUser } from '../../app/model';
import { getAppStore } from '../../app/store';
import { isRandomToken, randomToken, sha256Hex } from '../../app/tokens';
import type { McpScope } from '../scopes';
import { isMcpResource, MAX_CONNECTED_APPS, mcpResource, OAUTH_LIFETIMES, parseScopes } from './config';
import { clientPresentation, resolveClient, touchClient } from './clients';
import { OAuthError, type OAuthErrorCode } from './errors';
import { agentAccessSchema, connectionNameSchema, grantScopesSchema, getGrant, listConnectedApps, userPk, validateAccessChoice, type AgentAccess, type ClientPresentation } from './grants';
import { redirectUriMatches } from './redirects';

export type McpAuthorizationRequest = AppDoc & {
    type: 'mcp-authorization-request';
    clientId: string;
    client: ClientPresentation;
    redirectUri: string;
    state?: string;
    codeChallenge: string;
    scopes: McpScope[];
    resource: string;
    createdAt: string;
    expiresAt: string;
};

export type McpAuthorizationCode = AppDoc & {
    type: 'mcp-code';
    userId: string;
    clientId: string;
    client: ClientPresentation;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    access: AgentAccess;
    scopes: McpScope[];
    name: string;
    replaceGrantId?: string;
    expiresAt: string;
    consumedAt?: string;
    grantId?: string;
};

const requestPk = (hash: string) => `mcp-authz:${hash}`;

/** Where to send the browser: the consent page, a uier error page, or an error back to a validated redirect URI */
export type AuthorizeOutcome =
    | { kind: 'consent'; requestId: string }
    | { kind: 'error-page'; error: 'invalid_client' | 'invalid_redirect_uri' | 'invalid_request' }
    | { kind: 'redirect'; url: string };

export function callbackUrl(redirectUri: string, issuer: string, params: Record<string, string | undefined>) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params))
        if (value !== undefined) url.searchParams.set(key, value);
    url.searchParams.set('iss', issuer);
    return url.toString();
}

/**
 * Validates an authorization request (RFC 6749 §4.1.1 with PKCE and RFC 8707) and stores it for
 * the consent page. Errors go back to the client only after its redirect URI is validated.
 */
export async function startAuthorization(params: URLSearchParams, issuer: string): Promise<AuthorizeOutcome> {
    const single = (name: string) => params.getAll(name).length > 1 ? null : params.get(name);
    const clientId = single('client_id');
    const redirectUri = single('redirect_uri');
    if (!clientId || params.getAll('client_id').length !== 1) return { kind: 'error-page', error: 'invalid_request' };
    const client = await resolveClient(clientId);
    if (!client) return { kind: 'error-page', error: 'invalid_client' };
    if (!redirectUri || !client.redirectUris.some(registered => redirectUriMatches(registered, redirectUri)))
        return { kind: 'error-page', error: 'invalid_redirect_uri' };

    const state = single('state') ?? undefined;
    const fail = (error: OAuthErrorCode, description: string): AuthorizeOutcome =>
        ({ kind: 'redirect', url: callbackUrl(redirectUri, issuer, { error, error_description: description, state }) });
    if (state !== undefined && state.length > 1024) return fail('invalid_request', 'The state is too long.');
    for (const name of ['response_type', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'prompt'])
        if (params.getAll(name).length > 1) return fail('invalid_request', `Send ${name} once.`);
    if (single('response_type') !== 'code') return fail('unsupported_response_type', 'Only the code response type is supported.');
    const challenge = single('code_challenge');
    if (single('code_challenge_method') !== 'S256' || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
        return fail('invalid_request', 'PKCE with S256 is required.');
    const resource = single('resource');
    if (resource && !isMcpResource(resource, issuer)) return fail('invalid_target', 'The resource must be the uier MCP endpoint.');
    const scopes = parseScopes(single('scope'));
    if (!scopes) return fail('invalid_scope', 'Unknown scope.');
    if (single('prompt')?.split(' ').includes('none')) return fail('interaction_required', 'Consent is always shown.');

    await touchClient(client);
    const requestId = randomToken();
    const now = Date.now();
    const doc: McpAuthorizationRequest = {
        type: 'mcp-authorization-request', id: sha256Hex(requestId), pk: requestPk(sha256Hex(requestId)),
        clientId, client: clientPresentation(client, redirectUri), redirectUri, state, codeChallenge: challenge, scopes,
        resource: mcpResource(issuer), createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + OAUTH_LIFETIMES.authorizationRequestSeconds * 1000).toISOString(),
        ttl: OAUTH_LIFETIMES.authorizationRequestSeconds
    };
    if (!await getAppStore().create(doc)) return fail('server_error', 'Try again.');
    return { kind: 'consent', requestId };
}

async function loadRequest(requestId: string) {
    if (!isRandomToken(requestId)) return null;
    const hash = sha256Hex(requestId);
    const stored = await getAppStore().get<McpAuthorizationRequest>(requestPk(hash), hash);
    return stored && stored.doc.type === 'mcp-authorization-request' && Date.parse(stored.doc.expiresAt) > Date.now() ? stored : null;
}

/** A pending, unexpired authorization request for the consent page; `null` when unknown, used or expired */
export async function getPendingAuthorization(requestId: string) {
    const stored = await loadRequest(requestId);
    if (!stored) return null;
    const { clientId, client, redirectUri, scopes, expiresAt } = stored.doc;
    return { clientId, client, redirectUri, scopes, expiresAt };
}
export type PendingAuthorization = NonNullable<Awaited<ReturnType<typeof getPendingAuthorization>>>;

export const approvalSchema = z.object({
    access: agentAccessSchema,
    scopes: grantScopesSchema,
    name: connectionNameSchema,
    /** An existing connected app to replace once the client exchanges the code */
    replaceGrantId: z.string().regex(/^grant_[A-Za-z0-9_-]{1,64}$/).optional()
}).strict();
export type Approval = z.input<typeof approvalSchema>;

/**
 * The signed-in person approved the request: consumes it and returns the client's callback URL
 * with a single-use code. Every chosen workspace and project is checked against current access.
 */
export async function approveAuthorization(user: Pick<DbUser, 'id' | 'email'>, requestId: string, value: unknown, issuer: string) {
    const input = approvalSchema.parse(value);
    const stored = await loadRequest(requestId);
    if (!stored) throw new OAuthError('invalid_request', 'This sign-in request expired. Start again from your coding tool.');
    if (!await validateAccessChoice(user.id, user.email, input.access as AgentAccess))
        throw new OAuthError('access_denied', 'Choose workspaces and projects you can access.');
    if (input.replaceGrantId && !await getGrant(user.id, input.replaceGrantId))
        throw new OAuthError('invalid_request', 'The connection to replace no longer exists.');
    if (!input.replaceGrantId && (await listConnectedApps(user.id)).length >= MAX_CONNECTED_APPS)
        throw new OAuthError('access_denied', `Revoke or replace a connected app first (maximum ${MAX_CONNECTED_APPS}).`);

    const store = getAppStore();
    // Single use: the request is consumed before a code exists.
    if (!await consume(stored))
        throw new OAuthError('invalid_request', 'This sign-in request was already used. Start again from your coding tool.');
    const request = stored.doc;
    const code = `uier_code.${user.id}.${randomToken()}`;
    const now = Date.now();
    const doc: McpAuthorizationCode = {
        type: 'mcp-code', id: sha256Hex(code), pk: userPk(user.id), userId: user.id,
        clientId: request.clientId, client: request.client, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge,
        resource: request.resource, access: input.access as AgentAccess, scopes: input.scopes, name: input.name,
        replaceGrantId: input.replaceGrantId, expiresAt: new Date(now + OAUTH_LIFETIMES.codeSeconds * 1000).toISOString(),
        ttl: OAUTH_LIFETIMES.codeRecordSeconds
    };
    if (!await store.create(doc)) throw new OAuthError('server_error', 'Try again from your coding tool.', 500);
    return callbackUrl(request.redirectUri, issuer, { code, state: request.state });
}

/** Conditional delete: only one approval or cancellation wins */
async function consume(stored: { doc: McpAuthorizationRequest; etag: string }) {
    return await getAppStore().transact([{ kind: 'delete', pk: stored.doc.pk, id: stored.doc.id, etag: stored.etag }]);
}

/** The person cancelled: consumes the request and returns the client's callback with access_denied. */
export async function denyAuthorization(requestId: string, issuer: string) {
    const stored = await loadRequest(requestId);
    if (!stored || !await consume(stored)) return null;
    return callbackUrl(stored.doc.redirectUri, issuer, { error: 'access_denied', error_description: 'The person cancelled.', state: stored.doc.state });
}
