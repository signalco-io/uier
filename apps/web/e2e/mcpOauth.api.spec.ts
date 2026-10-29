import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientInformationFullSchema, OAuthMetadataSchema, OAuthProtectedResourceMetadataSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { GET as authorizeRoute } from '../app/api/oauth/authorize/route';
import { POST as tokenRoute } from '../app/api/oauth/token/route';
import { POST as registerRoute } from '../app/api/oauth/register/route';
import { POST as revokeRoute } from '../app/api/oauth/revoke/route';
import { GET as protectedResourceRoute } from '../app/api/oauth/metadata/protected-resource/route';
import { GET as authorizationServerRoute } from '../app/api/oauth/metadata/authorization-server/route';
import { handleMcp } from '../src/lib/mcp/http';
import { authenticateMcp, createMcpCredential, mcpProject, mcpScopes, type McpScope } from '../src/lib/mcp/credentials';
import { approveAuthorization, denyAuthorization, getPendingAuthorization, type McpAuthorizationCode, type McpAuthorizationRequest } from '../src/lib/mcp/oauth/authorize';
import { isMetadataClientId, isPublicAddress, resolveClient } from '../src/lib/mcp/oauth/clients';
import { getGrant, listConnectedApps, revokeConnectedApp, userPk as connectionPk, type AgentAccess, type McpGrant } from '../src/lib/mcp/oauth/grants';
import type { McpAccessToken, McpRefreshToken } from '../src/lib/mcp/oauth/tokens';
import { redirectUriMatches } from '../src/lib/mcp/oauth/redirects';
import { getAppStore } from '../src/lib/app/store';
import { sha256Hex } from '../src/lib/app/tokens';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { saveTeam, setTeamProjects, updateMemberAccess } from '../src/lib/app/teams';
import { createProject } from '../src/lib/app/projects';
import { memberId, workspacePk, type AppDoc, type DbMember, type DbUser, type DbWorkspace, type MemberRole, type ProjectsAccess } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, setProjectCommentPrivate } from '../src/lib/review/comments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { PUBLIC_PROJECT_ID, PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProject';
import { consume } from '../src/lib/comments/rateLimits';

// In-process tests call the route handlers and the MCP handler with this issuer, like mcp.api.spec.ts.
// Tests that take a `request` fixture reach the `next start` server, which has its own memory store.
const base = 'http://127.0.0.1:6516';
const resource = `${base}/api/mcp`;
const testEnv = {
    UIER_LOCAL: '1',
    UIER_COMMENTS_SECRET: 'mcp-oauth-test-secret-for-local-validation-only',
    UIER_BASE_URL: base,
    UIER_OAUTH_TEST_HTTP_CLIENT_METADATA: '1'
};
const originalEnv = Object.fromEntries([...Object.keys(testEnv), 'UIER_MCP_OAUTH', 'VERCEL'].map(key => [key, process.env[key]]));
function restoreEnv(keys = Object.keys(originalEnv)) {
    for (const key of keys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
}

// Client metadata documents, served on http://127.0.0.1 for the local-only test switch.
type ServedDocument = { status?: number; headers?: Record<string, string>; body: string };
const documents = new Map<string, ServedDocument>();
const hits = new Map<string, number>();
let metadataServer: Server;
let metadataOrigin: string;

test.beforeAll(async () => {
    Object.assign(process.env, testEnv);
    delete process.env.UIER_MCP_OAUTH;
    delete process.env.VERCEL;
    metadataServer = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://metadata.test').pathname;
        hits.set(path, (hits.get(path) ?? 0) + 1);
        const served = documents.get(path);
        if (!served) { response.writeHead(404).end(); return; }
        response.writeHead(served.status ?? 200, { 'Content-Type': 'application/json', ...served.headers }).end(served.body);
    });
    await new Promise<void>(resolve => metadataServer.listen(0, '127.0.0.1', resolve));
    metadataOrigin = `http://127.0.0.1:${(metadataServer.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
    restoreEnv();
    metadataServer.closeAllConnections();
    await new Promise(resolve => metadataServer.close(resolve));
});

/** Serves a client metadata document and returns its URL, the client id */
function serveClient(document: (clientId: string) => unknown = clientId => validDocument(clientId), served: Omit<ServedDocument, 'body'> = {}) {
    const path = `/${randomUUID()}/client.json`;
    const clientId = `${metadataOrigin}${path}`;
    const body = document(clientId);
    documents.set(path, { ...served, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { clientId, path };
}
function validDocument(clientId: string, overrides: Record<string, unknown> = {}) {
    return {
        client_id: clientId, client_name: 'Claude Code', client_uri: 'https://claude.ai',
        redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
        ...overrides
    };
}

// --- Helpers ---

function pkce() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(clientId: string, redirectUri: string, overrides: Record<string, string | undefined> = {}, issuer = base) {
    const params: Record<string, string> = {};
    const values: Record<string, string | undefined> = {
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: pkce().challenge,
        code_challenge_method: 'S256', state: 'state-123', scope: 'feedback:read', resource: `${issuer}/api/mcp`, ...overrides
    };
    for (const [key, value] of Object.entries(values)) if (value !== undefined) params[key] = value;
    return params;
}

/** GET /api/oauth/authorize in process; returns the 303 Location */
async function authorize(params: Record<string, string> | URLSearchParams) {
    const url = new URL('/api/oauth/authorize', base);
    url.search = new URLSearchParams(params).toString();
    const response = await authorizeRoute(new Request(url));
    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return new URL(response.headers.get('location')!);
}

/** The consent page's request id; fails for anything else */
function consentId(location: URL, issuer = base) {
    expect(`${location.origin}${location.pathname}`).toMatch(new RegExp(`^${issuer.replace(/[.:/]/g, '\\$&')}/app/connect/[A-Za-z0-9_-]{43}$`));
    return decodeURIComponent(location.pathname.split('/').pop()!);
}

function errorPage(location: URL, error: string, issuer = base) {
    expect(`${location.origin}${location.pathname}`).toBe(`${issuer}/app/connect/error`);
    expect(location.searchParams.get('error')).toBe(error);
}

function errorRedirect(location: URL, redirectUri: string, error: string, state: string | null = 'state-123') {
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri.replace(/\?.*$/, ''));
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('state')).toBe(state);
    expect(location.searchParams.get('iss')).toBe(base);
    expect(location.searchParams.has('code')).toBe(false);
}

async function register(body: unknown, headers: Record<string, string> = {}) {
    const response = await registerRoute(new Request(`${base}/api/oauth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body)
    }));
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

async function registeredClient(redirectUris = ['http://127.0.0.1/callback'], name = 'Test agent') {
    const registered = await register({ client_name: name, redirect_uris: redirectUris });
    expect(registered.status).toBe(201);
    return registered.body.client_id as string;
}

async function form(route: (request: Request) => Promise<Response>, path: string, values: Record<string, string> | string, contentType = 'application/x-www-form-urlencoded') {
    const response = await route(new Request(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body: typeof values === 'string' ? values : new URLSearchParams(values).toString()
    }));
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}
const token = (values: Record<string, string> | string, contentType?: string) => form(tokenRoute, '/api/oauth/token', values, contentType);
const revoke = (values: Record<string, string> | string, contentType?: string) => form(revokeRoute, '/api/oauth/revoke', values, contentType);

type Tokens = { access_token: string; refresh_token: string; scope: string; expires_in: number; token_type: string };

/** Authorization request, consent and approval; returns the code the client's callback receives */
async function approvedCode(user: Pick<DbUser, 'id' | 'email'>, options: { clientId?: string; redirectUri?: string; access?: AgentAccess; scopes?: McpScope[]; name?: string; replaceGrantId?: string } = {}) {
    const clientId = options.clientId ?? await registeredClient();
    const redirectUri = options.redirectUri ?? 'http://127.0.0.1:43123/callback';
    const scopes = options.scopes ?? ['feedback:read'];
    const { verifier, challenge } = pkce();
    const state = randomUUID();
    const requestId = consentId(await authorize(authorizeParams(clientId, redirectUri, { code_challenge: challenge, state, scope: scopes.join(' ') })));
    const callback = new URL(await approveAuthorization(user, requestId, {
        access: options.access ?? { kind: 'all' }, scopes, name: options.name ?? 'Claude Code',
        ...(options.replaceGrantId ? { replaceGrantId: options.replaceGrantId } : {})
    }, base));
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get('state')).toBe(state);
    expect(callback.searchParams.get('iss')).toBe(base);
    return { clientId, redirectUri, verifier, code: callback.searchParams.get('code')! };
}

/** A connected app: approved and exchanged */
async function connectApp(user: Pick<DbUser, 'id' | 'email'>, options: Parameters<typeof approvedCode>[1] = {}) {
    const approved = await approvedCode(user, options);
    const exchanged = await token({ grant_type: 'authorization_code', code: approved.code, code_verifier: approved.verifier,
        client_id: approved.clientId, redirect_uri: approved.redirectUri, resource });
    expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(200);
    const tokens = exchanged.body as Tokens;
    const identity = await authenticateMcp(bearer(tokens.access_token), base);
    return { ...approved, tokens, grantId: identity.connection.id };
}

function refresh(clientId: string, refreshToken: string, extra: Record<string, string> = {}) {
    return token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource, ...extra });
}

function bearer(value: string) {
    return new Request(resource, { headers: { Authorization: `Bearer ${value}` } });
}

/** One MCP request without a client: the status and challenge are what matter */
async function mcpRequest(value?: string, headers: Record<string, string> = {}) {
    return await handleMcp(new Request(resource, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(value === undefined ? {} : { Authorization: `Bearer ${value}` }), ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oauth-test', version: '1.0.0' } } })
    }), base);
}

const challenge = (error = false) => `Bearer realm="uier MCP", resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp", scope="feedback:read"${error ? ', error="invalid_token"' : ''}`;

async function connectMcp(accessToken: string) {
    const client = new Client({ name: 'oauth-connected-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
        fetch: async (input, init) => handleMcp(new Request(input, init), base)
    }));
    return client;
}
function data(result: Awaited<ReturnType<Client['callTool']>>) { return result.structuredContent as Record<string, any>; }
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) { return data(await client.callTool({ name, arguments: args })); }

async function patch<T extends AppDoc>(pk: string, id: string, change: Partial<T>) {
    const stored = (await getAppStore().get<T>(pk, id))!;
    expect(stored).toBeTruthy();
    expect(await getAppStore().replace({ ...stored.doc, ...change }, stored.etag)).toBe('ok');
}
const past = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

async function person(label: string) {
    const user = await findOrCreateUser(`${label}-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    return { user, member, context, workspaceId: member.workspaceId };
}
async function project(context: AppContext, name: string) {
    return await createProject(context, { name, urls: [`https://${randomUUID()}.example`] });
}
async function addMember(workspaceId: string, user: DbUser, projects: ProjectsAccess, role: MemberRole = 'commenter', createdAt = new Date().toISOString()) {
    const member: DbMember = { type: 'member', id: memberId(user.id), pk: workspacePk(workspaceId), workspaceId, userId: user.id, email: user.email, role, projects, createdAt };
    expect(await getAppStore().create(member)).toBe(true);
    return member;
}

// --- Discovery ---

test('the MCP endpoint challenges with RFC 9728 discovery and both metadata documents parse with the SDK schemas', async ({ request, baseURL }) => {
    const issuer = new URL(baseURL!).origin;
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const anonymous = await request.post('/api/mcp', { headers, data: initialize });
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()['www-authenticate']).toBe(`Bearer realm="uier MCP", resource_metadata="${issuer}/.well-known/oauth-protected-resource/api/mcp", scope="feedback:read"`);
    expect(await anonymous.json()).toMatchObject({ error: 'sign_in_required', message: expect.stringContaining('Sign in again from your coding tool') });
    const unknown = await request.post('/api/mcp', { headers: { ...headers, Authorization: `Bearer uier_at.u_unknown.${'a'.repeat(43)}` }, data: initialize });
    expect(unknown.status()).toBe(401);
    expect(unknown.headers()['www-authenticate']).toBe(`Bearer realm="uier MCP", resource_metadata="${issuer}/.well-known/oauth-protected-resource/api/mcp", scope="feedback:read", error="invalid_token"`);
    // The origin check still answers before authentication.
    const foreign = await request.post('/api/mcp', { headers: { ...headers, Origin: 'https://attacker.example' }, data: initialize });
    expect(foreign.status()).toBe(403);
    expect(foreign.headers()['www-authenticate']).toBeUndefined();

    const protectedResource = await request.get('/.well-known/oauth-protected-resource/api/mcp');
    expect(protectedResource.status()).toBe(200);
    expect(protectedResource.headers()).toMatchObject({ 'content-type': expect.stringMatching(/^application\/json/), 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
    const resourceMetadata = OAuthProtectedResourceMetadataSchema.parse(await protectedResource.json());
    expect(resourceMetadata).toEqual({
        resource: `${issuer}/api/mcp`, authorization_servers: [issuer], scopes_supported: [...mcpScopes],
        bearer_methods_supported: ['header'], resource_name: 'uier'
    });
    const authorizationServer = await request.get('/.well-known/oauth-authorization-server');
    expect(authorizationServer.status()).toBe(200);
    expect(authorizationServer.headers()).toMatchObject({ 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
    const metadata = OAuthMetadataSchema.parse(await authorizationServer.json());
    expect(metadata).toMatchObject({
        issuer, authorization_endpoint: `${issuer}/api/oauth/authorize`, token_endpoint: `${issuer}/api/oauth/token`,
        registration_endpoint: `${issuer}/api/oauth/register`, revocation_endpoint: `${issuer}/api/oauth/revoke`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: [...mcpScopes],
        client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true
    });
    expect(metadata.scopes_supported).not.toContain('offline_access');
    // Only the path-specific protected resource document exists (RFC 9728).
    expect((await request.get('/.well-known/oauth-protected-resource')).status()).toBe(404);

    // The SDK's own discovery finds both through the rewrites.
    expect((await discoverOAuthProtectedResourceMetadata(new URL('/api/mcp', issuer))).resource).toBe(`${issuer}/api/mcp`);
    expect((await discoverAuthorizationServerMetadata(issuer))?.issuer).toBe(issuer);

    // OAuth endpoints answer RFC 6749 JSON errors without CORS and without caching.
    const tokenError = await request.post('/api/oauth/token', { form: { grant_type: 'authorization_code', code: 'nope', client_id: 'nope', code_verifier: 'nope', redirect_uri: 'http://127.0.0.1/callback' } });
    expect(tokenError.status()).toBe(400);
    expect(await tokenError.json()).toMatchObject({ error: 'invalid_grant' });
    expect(tokenError.headers()['cache-control']).toBe('no-store');
    expect(tokenError.headers()['access-control-allow-origin']).toBeUndefined();
    expect((await request.post('/api/oauth/token', { data: { grant_type: 'refresh_token' } })).status()).toBe(400);
    expect((await request.post('/api/oauth/revoke', { form: { token: 'unknown' } })).status()).toBe(200);
});

test('in process the challenge marks unknown, expired, revoked, refresh, code and foreign-resource tokens invalid', async () => {
    const { user } = await person('oauth-invalid');
    const app = await connectApp(user);
    expect((await mcpRequest(app.tokens.access_token)).status).toBe(200);
    for (const [value, error] of [[undefined, false], ['', true], ['uier_at.invalid', true], [app.tokens.refresh_token, true], [`uier_code.${user.id}.${'a'.repeat(43)}`, true]] as const) {
        const response = await mcpRequest(value);
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(challenge(error));
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    // A malformed header counts as a presented token.
    const basic = await handleMcp(new Request(resource, { method: 'POST', headers: { Authorization: 'Basic dXNlcjpwYXNz' }, body: '{}' }), base);
    expect(basic.headers.get('www-authenticate')).toBe(challenge(true));

    const pk = connectionPk(user.id);
    const accessId = sha256Hex(app.tokens.access_token);
    const original = (await getAppStore().get<McpAccessToken>(pk, accessId))!.doc;
    await patch<McpAccessToken>(pk, accessId, { resource: 'https://other.example/api/mcp' });
    expect((await mcpRequest(app.tokens.access_token)).headers.get('www-authenticate')).toBe(challenge(true));
    await patch<McpAccessToken>(pk, accessId, { resource: original.resource, expiresAt: past(1) });
    expect((await mcpRequest(app.tokens.access_token)).status).toBe(401);
    await patch<McpAccessToken>(pk, accessId, { expiresAt: original.expiresAt });
    expect((await mcpRequest(app.tokens.access_token)).status).toBe(200);
    // A token of another client than its grant is not accepted either.
    await patch<McpAccessToken>(pk, accessId, { clientId: 'uier_client_other' });
    expect((await mcpRequest(app.tokens.access_token)).status).toBe(401);
    await patch<McpAccessToken>(pk, accessId, { clientId: original.clientId });
    expect(await revokeConnectedApp(user.id, app.grantId)).toBe(true);
    const revoked = await mcpRequest(app.tokens.access_token);
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('www-authenticate')).toBe(challenge(true));
    // The origin check stays first.
    expect((await mcpRequest(undefined, { Origin: 'https://attacker.example' })).status).toBe(403);
});

test('with OAuth turned off discovery and the OAuth endpoints are gone and the challenge is the old one', async () => {
    process.env.UIER_MCP_OAUTH = 'off';
    try {
        expect((await protectedResourceRoute()).status).toBe(404);
        expect((await authorizationServerRoute()).status).toBe(404);
        expect((await authorizeRoute(new Request(`${base}/api/oauth/authorize?client_id=x`))).status).toBe(404);
        expect((await token({ grant_type: 'refresh_token' })).status).toBe(404);
        expect((await register({ redirect_uris: ['http://127.0.0.1/callback'] })).status).toBe(404);
        expect((await mcpRequest()).headers.get('www-authenticate')).toBe('Bearer realm="uier MCP"');
    } finally { restoreEnv(['UIER_MCP_OAUTH']); }
    const metadata = OAuthMetadataSchema.parse(await (await authorizationServerRoute()).json());
    expect(metadata.issuer).toBe(base);
    expect(OAuthProtectedResourceMetadataSchema.parse(await (await protectedResourceRoute()).json()).resource).toBe(resource);
});

// --- Dynamic client registration ---

test('dynamic registration keeps only loopback and HTTPS redirect URIs, forces public clients and normalizes names', async ({ request }) => {
    const response = await request.post('/api/oauth/register', { data: {
        client_name: '  Cursor\u202e\u0000\u200f   agent\n' + 'x'.repeat(100),
        redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback', 'https://cursor.com/agents/oauth/callback', 'http://localhost:8787/callback',
            'http://evil.example/callback', 'https://app.example/callback#fragment', 'https://user:secret@app.example/callback', 'https://*.example.com/callback',
            `https://app.example/${'x'.repeat(520)}`, 'http://localhost:8787/callback'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post', scope: 'feedback:read', logo_uri: 'https://cursor.com/logo.png'
    } });
    expect(response.status()).toBe(201);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
    const body = await response.json();
    const information = OAuthClientInformationFullSchema.parse(body);
    expect(information.client_id).toMatch(/^uier_client_[A-Za-z0-9]{24}$/);
    expect(information.redirect_uris).toEqual(['https://cursor.com/agents/oauth/callback', 'http://localhost:8787/callback']);
    expect(information.token_endpoint_auth_method).toBe('none');
    expect(body).not.toHaveProperty('client_secret');
    expect(body).not.toHaveProperty('registration_access_token');
    expect(information.client_name).toBe(`Cursor agent ${'x'.repeat(47)}`);
    expect([...information.client_name!].length).toBeLessThanOrEqual(60);

    const noValid = await request.post('/api/oauth/register', { data: { client_name: 'Custom', redirect_uris: ['cursor://callback', 'http://evil.example/callback'] } });
    expect(noValid.status()).toBe(400);
    expect(await noValid.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    for (const invalid of [{ redirect_uris: [] }, { client_name: 'No redirects' }, { redirect_uris: 'https://app.example/callback' },
        { redirect_uris: ['https://app.example/callback'], grant_types: ['client_credentials'] }, { redirect_uris: ['https://app.example/callback'], response_types: ['token'] }]) {
        const rejected = await request.post('/api/oauth/register', { data: invalid });
        expect(rejected.status(), JSON.stringify(invalid)).toBe(400);
        expect(await rejected.json()).toMatchObject({ error: 'invalid_client_metadata' });
    }
    const notJson = await request.post('/api/oauth/register', { headers: { 'Content-Type': 'application/json' }, data: '{"redirect_uris":' });
    expect(await notJson.json()).toMatchObject({ error: 'invalid_client_metadata' });
    expect((await request.post('/api/oauth/register', { form: { redirect_uris: 'https://app.example/callback' } })).status()).toBe(400);
    const nameless = await request.post('/api/oauth/register', { data: { client_name: '\u0000\u202e ', redirect_uris: ['https://app.example/callback'] } });
    expect((await nameless.json()).client_name).toBe('Coding tool');
});

test('dynamic registration is limited per IP address and across all addresses', async () => {
    // Rate-limit counters live in this worker's memory store; restore them so the budgets spent here,
    // the global one included, do not leak into another run in the same worker.
    type Counters = Map<string, { count: number; expiresAt: number }>;
    const memory = globalThis as typeof globalThis & { __uierCommentsMemoryStore2?: { domains: Map<string, unknown>; counters: Counters; version: number } };
    const counters = (memory.__uierCommentsMemoryStore2 ??= { domains: new Map(), counters: new Map(), version: 0 }).counters;
    const snapshot = new Map([...counters].map(([key, value]) => [key, { ...value }]));
    try {
        const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
        const body = { client_name: 'Limited', redirect_uris: ['http://127.0.0.1/callback'] };
        for (let i = 0; i < 20; i++) expect((await register(body, { 'x-forwarded-for': ip })).status).toBe(201);
        const blocked = await register(body, { 'x-forwarded-for': ip });
        expect(blocked.status).toBe(429);
        expect(blocked.body).toMatchObject({ error: 'temporarily_unavailable' });
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
        // Another address and local loopback requests are not affected.
        expect((await register(body, { 'x-forwarded-for': `198.51.100.${1 + Math.floor(Math.random() * 250)}` })).status).toBe(201);
        expect((await register(body)).status).toBe(201);
        // Registrations from all addresses share one hourly budget of 2000.
        const window = { key: 'oauth-register', limit: 2000, windowSeconds: 3600, reason: 'too_fast' as const, message: 'Too many requests. Try again later.' };
        try { for (let i = 0; i < 2000; i++) await consume(getCommentsStore(), '$mcp', window); } catch { /* reached the limit */ }
        const global = await register(body, { 'x-forwarded-for': `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
        expect(global.status).toBe(429);
        expect(global.body).toMatchObject({ error: 'temporarily_unavailable' });
        expect((await register(body)).status).toBe(201);
    } finally {
        counters.clear();
        for (const [key, value] of snapshot) counters.set(key, value);
    }
});

// --- Client ID Metadata Documents ---

test('client metadata documents are fetched through the local test switch, validated and cached', async ({ request, baseURL }) => {
    const issuer = new URL(baseURL!).origin;
    const start = async (clientId: string, redirectUri = 'http://127.0.0.1:51234/callback') => {
        const response = await request.get('/api/oauth/authorize', { params: authorizeParams(clientId, redirectUri, {}, issuer), maxRedirects: 0 });
        expect(response.status()).toBe(303);
        return new URL(response.headers().location!);
    };
    const valid = serveClient(clientId => validDocument(clientId), { headers: { 'Cache-Control': 'public, max-age=3600' } });
    consentId(await start(valid.clientId), issuer);
    consentId(await start(valid.clientId, 'http://localhost:61000/callback'), issuer);
    expect(hits.get(valid.path)).toBe(1);
    // A redirect URI the document does not list never receives a redirect.
    errorPage(await start(valid.clientId, 'http://127.0.0.1:51234/other'), 'invalid_redirect_uri', issuer);
    errorPage(await start(valid.clientId, 'https://attacker.example/callback'), 'invalid_redirect_uri', issuer);

    const invalid = [
        serveClient(clientId => validDocument(`${clientId}x`)),
        serveClient(clientId => validDocument(clientId, { client_name: undefined })),
        serveClient(clientId => validDocument(clientId, { client_name: '  ' })),
        serveClient(clientId => validDocument(clientId, { redirect_uris: ['http://127.0.0.1/callback', 'cursor://callback'] })),
        serveClient(clientId => validDocument(clientId, { redirect_uris: [] })),
        serveClient(clientId => validDocument(clientId, { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://app.example/callback/${i}`) })),
        serveClient(clientId => validDocument(clientId, { token_endpoint_auth_method: 'client_secret_basic' })),
        serveClient(clientId => validDocument(clientId, { grant_types: ['authorization_code', 'client_credentials'] })),
        serveClient(() => '<html>not json</html>'),
        serveClient(clientId => validDocument(clientId), { headers: { 'Content-Type': 'text/html' } }),
        serveClient(clientId => ({ ...validDocument(clientId), padding: 'x'.repeat(17 * 1024) })),
        serveClient(() => '', { status: 302, headers: { Location: `${valid.clientId}` } }),
        serveClient(clientId => validDocument(clientId), { status: 500 })
    ];
    for (const entry of invalid) {
        const location = await start(entry.clientId);
        errorPage(location, 'invalid_client', issuer);
        expect(location.searchParams.has('state')).toBe(false);
    }
    errorPage(await start(`${metadataOrigin}/${randomUUID()}/missing.json`), 'invalid_client', issuer);
    // Failures are cached too: fixing the document takes effect only after the failure expires.
    const broken = invalid[0]!;
    documents.set(broken.path, { body: JSON.stringify(validDocument(broken.clientId)) });
    errorPage(await start(broken.clientId), 'invalid_client', issuer);
    expect(hits.get(broken.path)).toBe(1);
});

test('the metadata test switch is local-only and metadata hosts must be public DNS names', async () => {
    const local = `${metadataOrigin}/client.json`;
    expect(isMetadataClientId(local)).toBe(true);
    expect(isMetadataClientId('http://localhost:4004/client.json')).toBe(true);
    for (const value of ['http://example.com/client.json', `${metadataOrigin}/`, `${metadataOrigin}/client.json?x=1`, `${metadataOrigin}/client.json#x`])
        expect(isMetadataClientId(value), value).toBe(false);
    for (const value of ['https://10.0.0.1/client.json', 'https://[::1]/client.json', 'https://127.0.0.1/client.json', 'https://example.com:8443/client.json',
        'https://example.com/', 'https://user@example.com/client.json', 'https://localhost/client.json', `https://example.com/${'x'.repeat(520)}`])
        expect(isMetadataClientId(value), value).toBe(false);
    expect(isMetadataClientId('https://claude.ai/oauth/claude-code-client-metadata')).toBe(true);
    try {
        delete process.env.UIER_OAUTH_TEST_HTTP_CLIENT_METADATA;
        expect(isMetadataClientId(local)).toBe(false);
        process.env.UIER_OAUTH_TEST_HTTP_CLIENT_METADATA = '1';
        process.env.VERCEL = '1';
        expect(isMetadataClientId(local)).toBe(false);
    } finally { restoreEnv(['VERCEL']); process.env.UIER_OAUTH_TEST_HTTP_CLIENT_METADATA = '1'; }
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
        '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', 'ff02::1', 'not-an-ip'])
        expect(isPublicAddress(address), address).toBe(false);
    // Every public IPv4 address passes (Node's BlockList matches an IPv4-mapped IPv6 rule against IPv4).
    for (const address of ['8.8.8.8', '1.1.1.1', '160.79.104.10', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808'])
        expect(isPublicAddress(address), address).toBe(true);
    expect(await resolveClient('uier_client_unknown000000000000000')).toBeNull();
    expect(await resolveClient('')).toBeNull();
});

test('a metadata document client signs in end to end and is presented by its host', async () => {
    const { user } = await person('oauth-cimd');
    const { clientId } = serveClient();
    const app = await connectApp(user, { clientId, redirectUri: 'http://localhost:51999/callback', name: 'Claude Code' });
    const grant = (await getGrant(user.id, app.grantId))!.doc;
    expect(grant.client).toEqual({ name: 'Claude Code', kind: 'cimd', metadataHost: new URL(metadataOrigin).host, redirectHost: null });
    expect(grant.clientId).toBe(clientId);
    const refreshed = await refresh(clientId, app.tokens.refresh_token);
    expect(refreshed.status).toBe(200);
});

// --- Authorization requests ---

test('unknown clients and unregistered redirect URIs get the uier error page, never a redirect', async () => {
    const clientId = await registeredClient(['http://127.0.0.1/callback', 'https://app.example/oauth/callback']);
    errorPage(await authorize(authorizeParams('uier_client_doesnotexist0000000000', 'https://app.example/oauth/callback')), 'invalid_client');
    errorPage(await authorize(authorizeParams('https://unknown.invalid/client.json', 'https://app.example/oauth/callback')), 'invalid_client');
    errorPage(await authorize(authorizeParams('', 'https://app.example/oauth/callback')), 'invalid_request');
    const twice = new URLSearchParams(authorizeParams(clientId, 'https://app.example/oauth/callback'));
    twice.append('client_id', clientId);
    errorPage(await authorize(twice), 'invalid_request');
    for (const redirectUri of ['https://attacker.example/oauth/callback', 'https://app.example/oauth/callback/', 'https://app.example/oauth/callback?x=1', ''])
        errorPage(await authorize(authorizeParams(clientId, redirectUri, { response_type: 'token', code_challenge: undefined })), 'invalid_redirect_uri');
    const twoRedirects = new URLSearchParams(authorizeParams(clientId, 'https://app.example/oauth/callback'));
    twoRedirects.append('redirect_uri', 'https://attacker.example/oauth/callback');
    errorPage(await authorize(twoRedirects), 'invalid_redirect_uri');
});

test('invalid authorization requests return to the validated redirect URI with state and iss', async () => {
    const redirectUri = 'https://app.example/oauth/callback';
    const clientId = await registeredClient([redirectUri, 'http://127.0.0.1/callback']);
    const cases: Array<[Record<string, string | undefined>, string]> = [
        [{ response_type: 'token' }, 'unsupported_response_type'],
        [{ response_type: undefined }, 'unsupported_response_type'],
        [{ code_challenge: undefined }, 'invalid_request'],
        [{ code_challenge_method: 'plain' }, 'invalid_request'],
        [{ code_challenge_method: undefined }, 'invalid_request'],
        [{ code_challenge: 'a'.repeat(42) }, 'invalid_request'],
        [{ code_challenge: `${'a'.repeat(42)}=` }, 'invalid_request'],
        [{ resource: 'https://other.example/api/mcp' }, 'invalid_target'],
        [{ resource: `${base}/api` }, 'invalid_target'],
        [{ resource: `${base}/api/mcp/tools` }, 'invalid_target'],
        [{ resource: `${base}/api/mcp?x=1` }, 'invalid_target'],
        [{ resource: 'not a url' }, 'invalid_target'],
        [{ scope: 'feedback:read feedback:delete' }, 'invalid_scope'],
        [{ scope: 'openid' }, 'invalid_scope'],
        [{ prompt: 'none' }, 'interaction_required']
    ];
    for (const [overrides, error] of cases)
        errorRedirect(await authorize(authorizeParams(clientId, redirectUri, overrides)), redirectUri, error);
    errorRedirect(await authorize(authorizeParams(clientId, redirectUri, { state: undefined, code_challenge_method: 'plain' })), redirectUri, 'invalid_request', null);
    for (const name of ['response_type', 'code_challenge', 'scope', 'resource', 'prompt', 'state']) {
        const params = new URLSearchParams(authorizeParams(clientId, redirectUri, { prompt: 'consent' }));
        params.append(name, params.get(name)!);
        const location = await authorize(params);
        expect(location.searchParams.get('error'), name).toBe('invalid_request');
        expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    }
    // A long state is refused rather than stored.
    expect((await authorize(authorizeParams(clientId, redirectUri, { state: 'x'.repeat(1025) }))).searchParams.get('error')).toBe('invalid_request');

    // Accepted: a canonical resource in another spelling, a missing resource (decision 10), offline_access and prompt=consent.
    for (const overrides of [{ resource: `${base.toUpperCase()}/api/mcp/` }, { resource: undefined },
        { scope: 'feedback:read feedback:reply offline_access', prompt: 'consent' }, { scope: undefined }]) {
        const requestId = consentId(await authorize(authorizeParams(clientId, redirectUri, overrides)));
        const pending = (await getPendingAuthorization(requestId))!;
        expect(pending).toMatchObject({ clientId, redirectUri, client: { kind: 'dcr', name: 'Test agent', redirectHost: 'app.example' } });
        expect(pending.scopes).toEqual(overrides.scope?.includes('reply') ? ['feedback:read', 'feedback:reply'] : ['feedback:read']);
        const stored = (await getAppStore().get<McpAuthorizationRequest>(`mcp-authz:${sha256Hex(requestId)}`, sha256Hex(requestId)))!.doc;
        expect(stored.resource).toBe(resource);
        expect(JSON.stringify(stored)).not.toContain(requestId);
    }
});

test('loopback redirect URIs match on any port for localhost, 127.0.0.1 and [::1] only', async () => {
    const registered = ['http://localhost/callback', 'http://127.0.0.1/callback', 'http://[::1]/callback', 'https://app.example/oauth/callback', 'http://localhost/cb?client=1'];
    const clientId = await registeredClient(registered);
    const accepted = ['http://localhost:53123/callback', 'http://localhost/callback', 'http://127.0.0.1:1/callback', 'http://127.0.0.1:65535/callback',
        'http://[::1]:8080/callback', 'https://app.example/oauth/callback', 'http://localhost:3000/cb?client=1'];
    for (const redirectUri of accepted) consentId(await authorize(authorizeParams(clientId, redirectUri)));
    const rejected = ['http://localhost:53123/other', 'http://127.0.0.1:53123/callback/', 'http://localhost:53123/callback?x=1', 'http://localhost:3000/cb',
        'https://app.example:8443/oauth/callback', 'https://app.example/oauth/callback/x', 'http://app.example/oauth/callback', 'http://127.0.0.2:53123/callback',
        'http://localhost.app.example:53123/callback', 'https://localhost:53123/callback', 'http://[::1]:1/callback#x', 'http://user@localhost:1/callback',
        'http://0.0.0.0:53123/callback', 'http://[::2]:53123/callback'];
    for (const redirectUri of rejected) errorPage(await authorize(authorizeParams(clientId, redirectUri)), 'invalid_redirect_uri');
    // Hosts are compared exactly: a client that registered 127.0.0.1 cannot use localhost.
    const ipOnly = await registeredClient(['http://127.0.0.1/callback']);
    errorPage(await authorize(authorizeParams(ipOnly, 'http://localhost:53123/callback')), 'invalid_redirect_uri');
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example/cb')).toBe(true);
    expect(redirectUriMatches('https://app.example/cb', 'https://APP.example/cb')).toBe(false);
    expect(redirectUriMatches('http://localhost/cb', 'http://localhost:1/cb')).toBe(true);
    expect(redirectUriMatches('cursor://callback', 'cursor://callback')).toBe(false);
});

test('consent requests are single use, expire, can be cancelled and approvals are checked against current access', async () => {
    const { user, workspaceId, context } = await person('oauth-consent');
    const visible = await project(context, 'Visible');
    const other = await person('oauth-consent-other');
    const foreign = await project(other.context, 'Foreign');
    const redirectUri = 'https://app.example/oauth/callback';
    const clientId = await registeredClient([redirectUri]);
    const start = async () => consentId(await authorize(authorizeParams(clientId, redirectUri)));

    const cancelled = await start();
    const denied = new URL((await denyAuthorization(cancelled, base))!);
    errorRedirect(denied, redirectUri, 'access_denied');
    expect(await denyAuthorization(cancelled, base)).toBeNull();
    await expect(approveAuthorization(user, cancelled, { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'x' }, base)).rejects.toMatchObject({ code: 'invalid_request' });

    const expired = await start();
    await patch<McpAuthorizationRequest>(`mcp-authz:${sha256Hex(expired)}`, sha256Hex(expired), { expiresAt: past(1) });
    expect(await getPendingAuthorization(expired)).toBeNull();
    await expect(approveAuthorization(user, expired, { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'x' }, base)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await getPendingAuthorization('not-a-request-id')).toBeNull();

    const requestId = await start();
    for (const access of [{ kind: 'selected', workspaces: [{ workspaceId: other.workspaceId, projects: 'all' }] },
        { kind: 'selected', workspaces: [{ workspaceId, projects: [foreign.id] }] },
        { kind: 'selected', workspaces: [{ workspaceId: 'w_missing', projects: 'all' }] }] as const)
        await expect(approveAuthorization(user, requestId, { access, scopes: ['feedback:read'], name: 'x' }, base)).rejects.toMatchObject({ code: 'access_denied' });
    for (const value of [{ access: { kind: 'all' }, scopes: ['feedback:reply'], name: 'x' }, { access: { kind: 'all' }, scopes: ['feedback:read'], name: ' ' },
        { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'x'.repeat(61) }, { access: { kind: 'selected', workspaces: [] }, scopes: ['feedback:read'], name: 'x' },
        { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'x', extra: true }])
        await expect(approveAuthorization(user, requestId, value, base)).rejects.toThrow();
    // Rejected approvals did not consume the request.
    const approved = new URL(await approveAuthorization(user, requestId, { access: { kind: 'selected', workspaces: [{ workspaceId, projects: [visible.id] }] }, scopes: ['feedback:read'], name: 'x' }, base));
    expect(approved.searchParams.get('code')).toMatch(new RegExp(`^uier_code\\.${user.id}\\.[A-Za-z0-9_-]{43}$`));
    await expect(approveAuthorization(user, requestId, { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'x' }, base)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await denyAuthorization(requestId, base)).toBeNull();
});

test('a person has at most 20 connected apps unless one is replaced', async () => {
    const { user } = await person('oauth-limit');
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
        const grant: McpGrant = { type: 'mcp-grant', id: `grant_seeded${i}`, pk: connectionPk(user.id), userId: user.id, clientId: 'uier_client_seeded',
            client: { name: 'Seeded', kind: 'dcr', redirectHost: null }, name: `Seeded ${i}`, access: { kind: 'all' }, scopes: ['feedback:read'], resource,
            createdAt: new Date(now - 60_000 + i).toISOString(), updatedAt: new Date(now).toISOString(),
            idleExpiresAt: new Date(now + 86400_000).toISOString(), absoluteExpiresAt: new Date(now + 86400_000).toISOString() };
        expect(await getAppStore().create(grant)).toBe(true);
    }
    expect(await listConnectedApps(user.id)).toHaveLength(20);
    const clientId = await registeredClient();
    const requestId = consentId(await authorize(authorizeParams(clientId, 'http://127.0.0.1:1234/callback')));
    await expect(approveAuthorization(user, requestId, { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'New' }, base)).rejects.toMatchObject({ code: 'access_denied' });
    await expect(approveAuthorization(user, requestId, { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'New', replaceGrantId: 'grant_missing' }, base)).rejects.toMatchObject({ code: 'invalid_request' });
    // Replacing one keeps the count; the replaced grant ends when the code is exchanged.
    const app = await connectApp(user, { clientId, name: 'Replacement', replaceGrantId: 'grant_seeded3' });
    expect(await getGrant(user.id, 'grant_seeded3')).toBeNull();
    const apps = await listConnectedApps(user.id);
    expect(apps).toHaveLength(20);
    expect(apps[0]).toMatchObject({ id: app.grantId, name: 'Replacement' });
});

// --- Tokens ---

test('code exchange checks verifier, client, redirect URI and resource, and a replayed code revokes its grant', async () => {
    const { user } = await person('oauth-code');
    const approved = await approvedCode(user, { scopes: ['feedback:read', 'feedback:reply'], name: 'Codex' });
    const exchange = (changes: Record<string, string | undefined> = {}) => {
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries({ grant_type: 'authorization_code', code: approved.code, code_verifier: approved.verifier,
            client_id: approved.clientId, redirect_uri: approved.redirectUri, resource, ...changes })) if (value !== undefined) values[key] = value;
        return token(values);
    };
    for (const [changes, error] of [
        [{ code_verifier: pkce().verifier }, 'invalid_grant'],
        [{ code_verifier: 'short' }, 'invalid_grant'],
        [{ client_id: await registeredClient() }, 'invalid_grant'],
        [{ redirect_uri: 'http://127.0.0.1:43124/callback' }, 'invalid_grant'],
        [{ redirect_uri: 'http://localhost:43123/callback' }, 'invalid_grant'],
        [{ resource: 'https://other.example/api/mcp' }, 'invalid_target'],
        [{ code_verifier: undefined }, 'invalid_request'],
        [{ client_id: undefined }, 'invalid_request'],
        [{ code: `uier_code.${user.id}.${'b'.repeat(43)}` }, 'invalid_grant'],
        [{ code: 'not-a-code' }, 'invalid_grant']
    ] as const) {
        const failed = await exchange(changes);
        expect(failed.status, JSON.stringify(changes)).toBe(400);
        expect(failed.body.error, JSON.stringify(changes)).toBe(error);
    }
    // Failed attempts did not consume the code.
    const exchanged = await exchange({ resource: undefined });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get('cache-control')).toBe('no-store');
    expect(exchanged.headers.get('pragma')).toBe('no-cache');
    expect(exchanged.headers.get('access-control-allow-origin')).toBeNull();
    const tokens = OAuthTokensSchema.parse(exchanged.body);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'feedback:read feedback:reply' });
    expect(tokens.access_token).toMatch(new RegExp(`^uier_at\\.${user.id}\\.[A-Za-z0-9_-]{43}$`));
    expect(tokens.refresh_token).toMatch(new RegExp(`^uier_rt\\.${user.id}\\.[A-Za-z0-9_-]{43}$`));
    const identity = await authenticateMcp(bearer(tokens.access_token), base);
    expect(identity).toMatchObject({ user: { id: user.id }, connection: { kind: 'oauth', name: 'Codex', clientId: approved.clientId }, scopes: ['feedback:read', 'feedback:reply'], access: { kind: 'all' } });
    expect(identity.connection.id).toMatch(/^grant_/);
    // Only hashes are stored.
    const partition = JSON.stringify(await Promise.all(['mcp-code', 'mcp-grant', 'mcp-access-token', 'mcp-refresh-token']
        .map(type => getAppStore().query({ type: type as 'mcp-grant', pk: connectionPk(user.id) }))));
    for (const secret of [approved.code, approved.verifier, tokens.access_token, tokens.refresh_token!]) expect(partition).not.toContain(secret);

    const replay = await exchange();
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: 'invalid_grant' });
    await expect(authenticateMcp(bearer(tokens.access_token), base)).rejects.toMatchObject({ status: 401 });
    expect((await refresh(approved.clientId, tokens.refresh_token!)).body).toMatchObject({ error: 'invalid_grant' });
    expect(await listConnectedApps(user.id)).toEqual([]);
});

test('expired codes and malformed token requests fail with RFC 6749 errors', async () => {
    const { user } = await person('oauth-expired-code');
    const approved = await approvedCode(user);
    await patch<McpAuthorizationCode>(connectionPk(user.id), sha256Hex(approved.code), { expiresAt: past(1) });
    const expired = await token({ grant_type: 'authorization_code', code: approved.code, code_verifier: approved.verifier, client_id: approved.clientId, redirect_uri: approved.redirectUri });
    expect(expired).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await listConnectedApps(user.id)).toEqual([]);

    expect((await token(JSON.stringify({ grant_type: 'refresh_token' }), 'application/json')).body).toMatchObject({ error: 'invalid_request' });
    expect((await token({ code: 'x' })).body).toMatchObject({ error: 'invalid_request' });
    expect((await token('grant_type=refresh_token&grant_type=authorization_code')).body).toMatchObject({ error: 'invalid_request' });
    expect((await token({ grant_type: 'client_credentials' })).body).toMatchObject({ error: 'unsupported_grant_type' });
    expect((await token({ grant_type: 'password', username: 'a', password: 'b' })).body).toMatchObject({ error: 'unsupported_grant_type' });
    expect((await token(`grant_type=authorization_code&code=${approved.code}&code=${approved.code}`)).body).toMatchObject({ error: 'invalid_request' });
    const large = await token({ grant_type: 'refresh_token', refresh_token: 'x'.repeat(17_000) });
    expect(large).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
});

test('refresh tokens rotate, tolerate a lost response for 60 seconds and revoke the grant on later reuse', async () => {
    const { user } = await person('oauth-refresh');
    const app = await connectApp(user, { scopes: ['feedback:read', 'feedback:reply'] });
    const pk = connectionPk(user.id);
    const first = await refresh(app.clientId, app.tokens.refresh_token);
    expect(first.status).toBe(200);
    const second = OAuthTokensSchema.parse(first.body);
    expect(second.refresh_token).not.toBe(app.tokens.refresh_token);
    expect(second.access_token).not.toBe(app.tokens.access_token);
    expect((await getAppStore().get<McpRefreshToken>(pk, sha256Hex(app.tokens.refresh_token)))!.doc.rotatedAt).toBeTruthy();
    const grantAfterRefresh = (await getGrant(user.id, app.grantId))!.doc;
    expect(grantAfterRefresh.lastUsedAt).toBeTruthy();
    // Within the grace period the rotated token gets another pair and the grant stays.
    const lost = await refresh(app.clientId, app.tokens.refresh_token);
    expect(lost.status).toBe(200);
    for (const value of [app.tokens.access_token, second.access_token, lost.body.access_token])
        expect((await authenticateMcp(bearer(value), base)).connection.id).toBe(app.grantId);
    // Concurrent refreshes of one token both succeed: one rotates, the other takes the grace path.
    const concurrent = await Promise.all([refresh(app.clientId, second.refresh_token!), refresh(app.clientId, second.refresh_token!)]);
    expect(concurrent.map(result => result.status)).toEqual([200, 200]);
    expect(concurrent[0]!.body.refresh_token).not.toBe(concurrent[1]!.body.refresh_token);

    // Another client or resource cannot use it, and that does not revoke anything.
    expect((await refresh(await registeredClient(), concurrent[0]!.body.refresh_token)).body).toMatchObject({ error: 'invalid_grant' });
    expect((await refresh(app.clientId, concurrent[0]!.body.refresh_token, { resource: 'https://other.example/api/mcp' })).body).toMatchObject({ error: 'invalid_target' });
    expect((await authenticateMcp(bearer(concurrent[0]!.body.access_token), base)).connection.id).toBe(app.grantId);

    // A refresh may repeat or narrow the granted scopes, never widen them. Narrowing applies to that
    // access token only; a later refresh without scope gets the granted scopes again (RFC 6749 §6).
    const narrowed = await refresh(app.clientId, concurrent[0]!.body.refresh_token, { scope: 'feedback:read' });
    expect(narrowed.body.scope).toBe('feedback:read');
    expect((await authenticateMcp(bearer(narrowed.body.access_token), base)).scopes).toEqual(['feedback:read']);
    expect((await authenticateMcp(bearer(concurrent[1]!.body.access_token), base)).scopes).toEqual(['feedback:read', 'feedback:reply']);
    const restored = await refresh(app.clientId, narrowed.body.refresh_token);
    expect(restored.body.scope).toBe('feedback:read feedback:reply');
    expect((await authenticateMcp(bearer(restored.body.access_token), base)).scopes).toEqual(['feedback:read', 'feedback:reply']);
    expect((await refresh(app.clientId, restored.body.refresh_token, { scope: 'feedback:read feedback:assign' })).body).toMatchObject({ error: 'invalid_scope' });
    expect((await refresh(app.clientId, restored.body.refresh_token, { scope: 'openid' })).body).toMatchObject({ error: 'invalid_scope' });
    const kept = await refresh(app.clientId, restored.body.refresh_token, { scope: 'feedback:reply feedback:read' });
    expect(kept.body.scope).toBe('feedback:read feedback:reply');

    // After the grace period, reuse revokes the whole grant.
    await patch<McpRefreshToken>(pk, sha256Hex(app.tokens.refresh_token), { rotatedAt: past(61) });
    const reused = await refresh(app.clientId, app.tokens.refresh_token);
    expect(reused).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await getGrant(user.id, app.grantId)).toBeNull();
    await expect(authenticateMcp(bearer(kept.body.access_token), base)).rejects.toMatchObject({ status: 401 });
    expect((await refresh(app.clientId, kept.body.refresh_token)).body).toMatchObject({ error: 'invalid_grant' });
});

test('idle and absolute grant expiry and refresh token expiry end the connection', async () => {
    const { user } = await person('oauth-expiry');
    for (const change of [{ idleExpiresAt: past(1) }, { absoluteExpiresAt: past(1) }] as Array<Partial<McpGrant>>) {
        const app = await connectApp(user);
        await patch<McpGrant>(connectionPk(user.id), app.grantId, change);
        await expect(authenticateMcp(bearer(app.tokens.access_token), base)).rejects.toMatchObject({ status: 401 });
        expect((await refresh(app.clientId, app.tokens.refresh_token)).body).toMatchObject({ error: 'invalid_grant' });
        expect((await listConnectedApps(user.id)).some(grant => grant.id === app.grantId)).toBe(false);
    }
    const app = await connectApp(user);
    await patch<McpRefreshToken>(connectionPk(user.id), sha256Hex(app.tokens.refresh_token), { expiresAt: past(1) });
    expect((await refresh(app.clientId, app.tokens.refresh_token)).body).toMatchObject({ error: 'invalid_grant' });
    // An expired refresh token alone does not end the grant's current access token.
    expect((await authenticateMcp(bearer(app.tokens.access_token), base)).connection.id).toBe(app.grantId);
});

test('revocation: a refresh token ends the grant, an access token only itself, unknown tokens still succeed', async () => {
    const { user } = await person('oauth-revoke');
    const app = await connectApp(user);
    const revokedAccess = await revoke({ token: app.tokens.access_token, client_id: app.clientId });
    expect(revokedAccess.status).toBe(200);
    expect(revokedAccess.headers.get('cache-control')).toBe('no-store');
    await expect(authenticateMcp(bearer(app.tokens.access_token), base)).rejects.toMatchObject({ status: 401 });
    const next = await refresh(app.clientId, app.tokens.refresh_token);
    expect(next.status).toBe(200);
    // Another client's revocation is ignored, like an unknown token.
    expect((await revoke({ token: next.body.refresh_token, client_id: 'uier_client_someoneelse0000000000' })).status).toBe(200);
    expect((await authenticateMcp(bearer(next.body.access_token), base)).connection.id).toBe(app.grantId);
    expect((await revoke({ token: next.body.refresh_token, client_id: app.clientId, token_type_hint: 'refresh_token' })).status).toBe(200);
    await expect(authenticateMcp(bearer(next.body.access_token), base)).rejects.toMatchObject({ status: 401 });
    expect((await refresh(app.clientId, next.body.refresh_token)).body).toMatchObject({ error: 'invalid_grant' });
    expect(await getGrant(user.id, app.grantId)).toBeNull();

    expect((await revoke({ token: 'unknown' })).status).toBe(200);
    expect((await revoke({ token: `uier_rt.${user.id}.${'c'.repeat(43)}` })).status).toBe(200);
    expect(await revoke({ client_id: app.clientId })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await revoke(JSON.stringify({ token: 'x' }), 'application/json')).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
});

// --- Grants ---

test('"all" reaches every workspace the person can access now and later, ordered by membership age and project name', async () => {
    const a = await person('oauth-all');
    const zeta = await project(a.context, 'Zeta site');
    const alpha = await project(a.context, 'Alpha site');
    const b = await person('oauth-all-b');
    const beta = await project(b.context, 'Beta site');
    const hidden = await project(b.context, 'Hidden');
    await addMember(b.workspaceId, a.user, [beta.id], 'commenter', new Date(Date.now() + 1000).toISOString());
    const app = await connectApp(a.user, { access: { kind: 'all' } });
    const client = await connectMcp(app.tokens.access_token);
    try {
        const listed = await callTool(client, 'list_projects', { limit: 25 });
        expect(listed.access).toBe('all');
        expect(listed.actingAs).toMatchObject({ userId: a.user.id, credential: 'Claude Code', connection: { kind: 'oauth' } });
        const ownWorkspace = { id: a.workspaceId, name: a.user.email };
        const bWorkspace = { id: b.workspaceId, name: b.user.email };
        expect(listed.items.map((item: { id: string }) => item.id)).toEqual([PUBLIC_PROJECT_ID, alpha.id, zeta.id, beta.id]);
        expect(listed.items[0].workspace.id).toBe(PUBLIC_WORKSPACE_ID);
        expect(listed.items.slice(1)).toEqual([
            { id: alpha.id, name: 'Alpha site', status: 'active', workspace: ownWorkspace },
            { id: zeta.id, name: 'Zeta site', status: 'active', workspace: ownWorkspace },
            { id: beta.id, name: 'Beta site', status: 'active', workspace: bWorkspace }
        ]);
        expect((await callTool(client, 'list_projects', { workspaceId: b.workspaceId })).items).toEqual([{ id: beta.id, name: 'Beta site', status: 'active', workspace: bWorkspace }]);
        expect((await callTool(client, 'list_projects', { workspaceId: 'w_unknown' })).items).toEqual([]);
        const paged = await callTool(client, 'list_projects', { limit: 2 });
        expect(paged).toMatchObject({ nextCursor: 2 });
        expect((await callTool(client, 'list_projects', { limit: 2, cursor: 2 })).items.map((item: { id: string }) => item.id)).toEqual([zeta.id, beta.id]);
        expect((await callTool(client, 'list_feedback', { projectId: beta.id })).items).toEqual([]);
        expect((await callTool(client, 'list_feedback', { projectId: hidden.id })).error).toBe('not_found');

        // A workspace joined later is covered at once.
        const c = await person('oauth-all-c');
        const gamma = await project(c.context, 'Gamma');
        await addMember(c.workspaceId, a.user, 'all', 'commenter', new Date(Date.now() + 2000).toISOString());
        expect((await callTool(client, 'list_projects', { limit: 25 })).items.map((item: { id: string }) => item.id).at(-1)).toBe(gamma.id);
        expect((await callTool(client, 'list_feedback', { projectId: gamma.id })).error).toBeUndefined();
        // Losing a membership takes effect on the next request.
        await getAppStore().delete(workspacePk(b.workspaceId), memberId(a.user.id));
        expect((await callTool(client, 'list_projects', { limit: 25 })).items.map((item: { id: string }) => item.id)).toEqual([PUBLIC_PROJECT_ID, alpha.id, zeta.id, gamma.id]);
        expect((await callTool(client, 'list_feedback', { projectId: beta.id })).error).toBe('not_found');
    } finally { await client.close(); }
});

test('selected workspaces cover all projects including new ones, or exactly the chosen projects', async () => {
    const a = await person('oauth-selected');
    const p1 = await project(a.context, 'One');
    const b = await person('oauth-selected-b');
    const q1 = await project(b.context, 'Q one');
    const q2 = await project(b.context, 'Q two');
    await addMember(b.workspaceId, a.user, 'all', 'commenter', new Date(Date.now() + 1000).toISOString());
    const c = await person('oauth-selected-c');
    const r1 = await project(c.context, 'R one');
    await addMember(c.workspaceId, a.user, 'all', 'commenter', new Date(Date.now() + 2000).toISOString());
    const access: AgentAccess = { kind: 'selected', workspaces: [{ workspaceId: a.workspaceId, projects: 'all' }, { workspaceId: b.workspaceId, projects: [q1.id] }] };
    const app = await connectApp(a.user, { access });
    const identity = await authenticateMcp(bearer(app.tokens.access_token), base);
    expect(identity.access).toEqual(access);
    const client = await connectMcp(app.tokens.access_token);
    const ids = async (args: Record<string, unknown> = {}) => (await callTool(client, 'list_projects', { limit: 25, ...args })).items.map((item: { id: string }) => item.id);
    try {
        expect(await ids()).toEqual([p1.id, q1.id]);
        expect((await callTool(client, 'list_projects')).access).toEqual({ workspaces: 2 });
        expect(await ids({ workspaceId: c.workspaceId })).toEqual([]);
        for (const projectId of [q2.id, r1.id, PUBLIC_PROJECT_ID]) {
            expect((await callTool(client, 'list_feedback', { projectId })).error, projectId).toBe('not_found');
            await expect(mcpProject(identity, projectId)).rejects.toMatchObject({ status: 404 });
        }
        // A project added later inside an "all projects" workspace is covered.
        const p2 = await project(a.context, 'Two');
        expect(await ids()).toEqual([p1.id, p2.id, q1.id]);
        expect((await mcpProject(identity, p2.id)).project.id).toBe(p2.id);
        // Current access still decides: losing the project in B removes it.
        await patch<DbMember>(workspacePk(b.workspaceId), memberId(a.user.id), { projects: [q2.id] });
        expect(await ids()).toEqual([p1.id, p2.id]);
        expect((await callTool(client, 'list_feedback', { projectId: q1.id })).error).toBe('not_found');
    } finally { await client.close(); }
});

test('team grants and private threads are rechecked on every request of an OAuth connection', async () => {
    const owner = await person('oauth-team-owner');
    const workspace = (await getWorkspace(owner.workspaceId))!;
    const context: AppContext = { user: owner.user, member: owner.member, workspace, isAdmin: true, memberships: [{ member: owner.member, workspace }] };
    const teamed = await project(context, 'Team project');
    const a = await person('oauth-team-member');
    await addMember(owner.workspaceId, a.user, [], 'commenter', new Date(Date.now() + 1000).toISOString());
    const design = await saveTeam(context, { name: 'Design' });
    await setTeamProjects(context, design, [teamed.id]);
    await updateMemberAccess(context, a.user.id, { projects: [], teamIds: [design] });
    const ownerActor = (await memberActor(teamed, owner.user.id))!;
    const open = await createProjectComment(new Request(base), teamed, ownerActor, { origin: teamed.urls[0]!, path: '/', kind: 'feedback', position: { type: 'page' }, text: 'Open thread' });
    const hidden = await createProjectComment(new Request(base), teamed, ownerActor, { origin: teamed.urls[0]!, path: '/', kind: 'feedback', position: { type: 'page' }, text: 'Private thread' });
    await setProjectCommentPrivate(teamed, ownerActor, hidden.id, true);
    const app = await connectApp(a.user, { access: { kind: 'selected', workspaces: [{ workspaceId: owner.workspaceId, projects: 'all' }] } });
    const client = await connectMcp(app.tokens.access_token);
    try {
        expect((await callTool(client, 'list_projects')).items.map((item: { id: string }) => item.id)).toEqual([teamed.id]);
        expect((await callTool(client, 'list_feedback', { projectId: teamed.id })).items.map((item: { id: string }) => item.id)).toEqual([open.id]);
        expect((await callTool(client, 'get_feedback', { projectId: teamed.id, commentId: hidden.id })).error).toBe('not_found');
        await updateMemberAccess(context, a.user.id, { projects: [], teamIds: [] });
        expect((await callTool(client, 'list_projects')).items).toEqual([]);
        expect((await callTool(client, 'get_feedback', { projectId: teamed.id, commentId: open.id })).error).toBe('not_found');
    } finally { await client.close(); }
});

test('list_projects scans at most 50 workspaces and asks for a workspace filter beyond that', async () => {
    const a = await person('oauth-bound');
    const start = Date.now() + 1000;
    const workspaceIds: string[] = [];
    for (let i = 0; i < 50; i++) {
        const workspaceId = `w_bound_${randomUUID().replace(/-/g, '')}`;
        const workspace: DbWorkspace = { type: 'workspace', id: workspaceId, pk: workspacePk(workspaceId), name: `Bound ${i}`, createdBy: a.user.id, createdAt: new Date(start).toISOString() };
        expect(await getAppStore().create(workspace)).toBe(true);
        await addMember(workspaceId, a.user, 'all', 'admin', new Date(start + i).toISOString());
        workspaceIds.push(workspaceId);
    }
    const last = await project({ ...a.context, workspace: { id: workspaceIds.at(-1)! } } as AppContext, 'Last workspace project');
    const app = await connectApp(a.user, { access: { kind: 'all' } });
    const client = await connectMcp(app.tokens.access_token);
    try {
        // The uier workspace, the person's own and 50 more: the 52nd is not scanned.
        const listed = await callTool(client, 'list_projects', { limit: 25 });
        expect(listed).toMatchObject({ truncated: true, message: expect.stringContaining('Filter by workspaceId') });
        expect(listed.items.map((item: { id: string }) => item.id)).toEqual([PUBLIC_PROJECT_ID]);
        const filtered = await callTool(client, 'list_projects', { workspaceId: workspaceIds.at(-1) });
        expect(filtered.truncated).toBeUndefined();
        expect(filtered.items).toEqual([{ id: last.id, name: 'Last workspace project', status: 'active', workspace: { id: workspaceIds.at(-1), name: 'Bound 49' } }]);
        // Tools reach a project beyond the bound directly.
        expect((await callTool(client, 'list_feedback', { projectId: last.id })).error).toBeUndefined();
    } finally { await client.close(); }
});

// --- Coexistence ---

test('manual credentials keep their one-workspace shape next to OAuth connections', async () => {
    const a = await person('oauth-manual');
    const p1 = await project(a.context, 'Manual one');
    const p2 = await project(a.context, 'Manual two');
    const { token: secret, credential } = await createMcpCredential(a.context, { name: 'Headless CI', projectIds: [p1.id], scopes: ['feedback:read'], days: 7 });
    const manual = await authenticateMcp(bearer(secret), base);
    expect(manual.connection).toEqual({ id: credential.id, kind: 'credential', name: 'Headless CI' });
    expect(manual.access).toEqual({ kind: 'selected', workspaces: [{ workspaceId: a.workspaceId, projects: [p1.id] }] });
    const app = await connectApp(a.user, { name: 'Claude Code' });
    const manualClient = await connectMcp(secret);
    const oauthClient = await connectMcp(app.tokens.access_token);
    try {
        const manualList = await callTool(manualClient, 'list_projects');
        expect(manualList.items.map((item: { id: string }) => item.id)).toEqual([p1.id]);
        expect(manualList.actingAs).toEqual({ userId: a.user.id, name: a.user.name, credential: 'Headless CI', connection: { kind: 'credential' } });
        expect((await callTool(manualClient, 'list_feedback', { projectId: p2.id })).error).toBe('not_found');
        const oauthList = await callTool(oauthClient, 'list_projects', { limit: 25 });
        expect(oauthList.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([p1.id, p2.id]));
        expect(oauthList.actingAs).toEqual({ userId: a.user.id, name: a.user.name, credential: 'Claude Code', connection: { kind: 'oauth' } });
    } finally { await manualClient.close(); await oauthClient.close(); }
    // A manual credential is never a refresh token and an access token is never a manual credential.
    expect((await refresh(app.clientId, secret)).body).toMatchObject({ error: 'invalid_grant' });
    expect((await revoke({ token: secret })).status).toBe(200);
    expect((await authenticateMcp(bearer(secret), base)).connection.id).toBe(credential.id);
});

test('idempotent writes keep their receipt across a token refresh and replies carry the connection name', async () => {
    const a = await person('oauth-writes');
    const reviewed = await project(a.context, 'Reviewed');
    const actor = (await memberActor(reviewed, a.user.id))!;
    const comment = await createProjectComment(new Request(base), reviewed, actor, { origin: reviewed.urls[0]!, path: '/', kind: 'feedback', position: { type: 'page' }, text: 'The button is broken.' });
    const app = await connectApp(a.user, { scopes: ['feedback:read', 'feedback:reply', 'feedback:status'], name: 'Claude Code on laptop' });
    const reply = { projectId: reviewed.id, commentId: comment.id, text: 'Fixed in the latest deploy.', idempotencyKey: randomUUID() };
    const status = { projectId: reviewed.id, commentId: comment.id, resolved: true, idempotencyKey: randomUUID() };
    let client = await connectMcp(app.tokens.access_token);
    try {
        expect((await client.callTool({ name: 'reply_to_feedback', arguments: reply })).isError).not.toBe(true);
        expect((await client.callTool({ name: 'set_feedback_status', arguments: status })).isError).not.toBe(true);
    } finally { await client.close(); }
    // The client refreshed (for example after an hour) and retries the same approved actions.
    const refreshed = await refresh(app.clientId, app.tokens.refresh_token);
    client = await connectMcp(refreshed.body.access_token);
    try {
        expect((await client.callTool({ name: 'reply_to_feedback', arguments: reply })).isError).not.toBe(true);
        expect((await client.callTool({ name: 'set_feedback_status', arguments: status })).isError).not.toBe(true);
        expect((await client.callTool({ name: 'reply_to_feedback', arguments: { ...reply, text: 'A different reply' } })).isError).toBe(true);
    } finally { await client.close(); }
    const saved = (await getCommentsStore().get(comment.domain, comment.id))!.comment;
    expect(saved.thread.items).toHaveLength(2);
    expect(saved.resolved).toBe(true);
    const agent = { credentialId: app.grantId, name: 'Claude Code on laptop', kind: 'oauth' };
    expect(saved.thread.items[1]).toMatchObject({ authorId: `user:${a.user.id}`, text: reply.text, agent });
    expect(saved.notificationEvents?.slice(1).map(event => [event.kind, event.agent])).toEqual([['reply', agent], ['resolved', agent]]);
});

test('the 120 requests per minute cap is shared by manual credentials and OAuth connections', async () => {
    const a = await person('oauth-rate');
    const p1 = await project(a.context, 'Rate');
    const { token: secret } = await createMcpCredential(a.context, { name: 'Manual', projectIds: [p1.id], scopes: ['feedback:read'], days: 7 });
    const app = await connectApp(a.user);
    const remaining = 60_000 - Date.now() % 60_000;
    if (remaining < 5000) await new Promise(resolve => setTimeout(resolve, remaining + 50));
    const get = (value: string) => handleMcp(new Request(resource, { headers: { Authorization: `Bearer ${value}` } }), base);
    for (let i = 0; i < 120; i++) expect((await get(i % 2 ? secret : app.tokens.access_token)).status).toBe(405);
    const blocked = await get(app.tokens.access_token);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: 'rate_limited', reason: 'too_fast' });
});

// --- The official SDK client ---

class TestOAuthProvider implements OAuthClientProvider {
    information?: OAuthClientInformationMixed;
    saved?: OAuthTokens;
    verifier = '';
    redirects: URL[] = [];
    readonly expectedState = randomUUID();
    constructor(readonly redirectUrl: string, private readonly onRedirect: (url: URL) => Promise<void>) {}
    get clientMetadata(): OAuthClientMetadata {
        return { client_name: 'SDK test agent', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    }
    state() { return this.expectedState; }
    clientInformation() { return this.information; }
    saveClientInformation(information: OAuthClientInformationMixed) { this.information = information; }
    tokens() { return this.saved; }
    saveTokens(tokens: OAuthTokens) { this.saved = tokens; }
    async redirectToAuthorization(url: URL) { this.redirects.push(url); await this.onRedirect(url); }
    saveCodeVerifier(verifier: string) { this.verifier = verifier; }
    codeVerifier() { return this.verifier; }
    invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
        if (scope === 'all' || scope === 'tokens') this.saved = undefined;
        if (scope === 'all' || scope === 'client') this.information = undefined;
    }
}

/** The deployed routes, including the next.config.ts discovery rewrites, in process */
async function inProcessFetch(input: string | URL | Request, init?: RequestInit) {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    const routes: Record<string, (request: Request) => Promise<Response>> = {
        '/.well-known/oauth-protected-resource/api/mcp': () => protectedResourceRoute(),
        '/.well-known/oauth-authorization-server': () => authorizationServerRoute(),
        '/api/oauth/register': registerRoute,
        '/api/oauth/token': tokenRoute,
        '/api/oauth/revoke': revokeRoute,
        '/api/mcp': value => handleMcp(value, base)
    };
    return routes[pathname] ? await routes[pathname]!(request) : new Response(null, { status: 404 });
}

test('the official SDK client discovers, registers, signs in, refreshes and loses access after revocation', async () => {
    const a = await person('oauth-sdk');
    const own = await project(a.context, 'SDK project');
    const b = await person('oauth-sdk-b');
    const shared = await project(b.context, 'Shared project');
    await addMember(b.workspaceId, a.user, [shared.id], 'commenter', new Date(Date.now() + 1000).toISOString());
    let approve = true;
    let code: string | undefined;
    const provider = new TestOAuthProvider('http://127.0.0.1:47999/callback', async url => {
        expect(`${url.origin}${url.pathname}`).toBe(`${base}/api/oauth/authorize`);
        expect(url.searchParams.get('resource')).toBe(resource);
        expect(url.searchParams.get('scope')).toBe('feedback:read');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        if (!approve) return;
        const consent = await authorizeRoute(new Request(url));
        const requestId = consentId(new URL(consent.headers.get('location')!));
        expect(await getPendingAuthorization(requestId)).toMatchObject({ scopes: ['feedback:read'], client: { kind: 'dcr', name: 'SDK test agent', redirectHost: null } });
        // The person chooses all workspaces and adds reply access on the consent page.
        const callback = new URL(await approveAuthorization(a.user, requestId, { access: { kind: 'all' }, scopes: ['feedback:read', 'feedback:reply'], name: 'SDK agent' }, base));
        expect(callback.searchParams.get('state')).toBe(provider.expectedState);
        expect(callback.searchParams.get('iss')).toBe(base);
        code = callback.searchParams.get('code')!;
    });
    const transport = () => new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider, fetch: inProcessFetch });
    const first = transport();
    await expect(new Client({ name: 'sdk-oauth', version: '1.0.0' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.information?.client_id).toMatch(/^uier_client_/);
    expect(code).toBeTruthy();
    await first.finishAuth(code!);
    expect(provider.saved).toMatchObject({ token_type: 'Bearer', scope: 'feedback:read feedback:reply', refresh_token: expect.stringMatching(/^uier_rt\./) });

    const client = new Client({ name: 'sdk-oauth', version: '1.0.0' });
    await client.connect(transport());
    try {
        const listed = await callTool(client, 'list_projects', { limit: 25 });
        expect(listed.items.map((item: { id: string }) => item.id)).toEqual([PUBLIC_PROJECT_ID, own.id, shared.id]);
        expect(listed.actingAs).toMatchObject({ credential: 'SDK agent', connection: { kind: 'oauth' } });

        // The access token expires; the transport refreshes on the 401 and retries.
        const before = provider.saved!;
        const grantId = (await authenticateMcp(bearer(before.access_token), base)).connection.id;
        await patch<McpAccessToken>(connectionPk(a.user.id), sha256Hex(before.access_token), { expiresAt: past(1) });
        expect((await callTool(client, 'list_projects', { workspaceId: b.workspaceId })).items.map((item: { id: string }) => item.id)).toEqual([shared.id]);
        expect(provider.saved!.access_token).not.toBe(before.access_token);
        expect(provider.saved!.refresh_token).not.toBe(before.refresh_token);
        expect((await getAppStore().get<McpRefreshToken>(connectionPk(a.user.id), sha256Hex(before.refresh_token!)))!.doc.rotatedAt).toBeTruthy();

        // Revoked in Account: the refresh fails and the client has to sign in again.
        approve = false;
        expect(await revokeConnectedApp(a.user.id, grantId)).toBe(true);
        await expect(client.callTool({ name: 'list_projects', arguments: {} })).rejects.toThrow();
        expect(provider.saved).toBeUndefined();
        expect(provider.redirects).toHaveLength(2);
    } finally { await client.close(); }
});
