import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

export type StubLinearIssue = { id: string; identifier: string; url: string; title: string; description: string; creator: { id: string };
    team: { id: string }; project: { id: string } | null; state: { id: string }; labels: { nodes: { id: string }[] }; trashed: boolean; archivedAt: string | null };
export type StubLinearComment = { id: string; body: string; user: { id: string }; issue: { id: string } };
export type LinearFault = 'rate_limit' | 'partial' | 'lost' | 'forbidden' | 'invalid_success' | 'unauthenticated' | 'invalid_input';
export type LinearStub = Awaited<ReturnType<typeof startLinearStub>>;

async function rawBody(request: IncomingMessage) { const parts = []; for await (const part of request) parts.push(Buffer.from(part)); return Buffer.concat(parts); }
async function body(request: IncomingMessage) { return (await rawBody(request)).toString('utf8'); }
const send = (response: ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value));
};
const gqlError = (response: ServerResponse, code: string, data: unknown = null) => send(response, { errors: [{ message: 'Stub provider error, never display this text', extensions: { code } }], data });
const missingEntity = (response: ServerResponse, entity: 'Issue' | 'Comment') => send(response, { errors: [{
    message: `Entity not found: ${entity}`, extensions: { code: 'INPUT_ERROR', type: 'invalid input', statusCode: 400, userError: true }
}], data: null });

export async function startLinearStub(port = 0) {
    const organizationId = randomUUID(); const appUserId = randomUUID(); const teamId = randomUUID(); const projectId = randomUUID();
    const openStateId = randomUUID(); const doneStateId = randomUUID(); const labelId = randomUUID();
    const issues = new Map<string, StubLinearIssue>(); const comments = new Map<string, StubLinearComment>();
    const assets = new Map<string, { key: string; bytes?: Buffer; contentType: string }>();
    const codes = new Map<string, { challenge: string; app: boolean; orgId: string }>();
    const authorizations = new Map<string, { redirect: string; state: string; challenge: string; orgId: string }>();
    const tokens = new Map<string, { orgId: string; app: boolean; refresh: string }>();
    const refreshes = new Map<string, { access: string; refresh: string; replay?: { access: string; refresh: string }; orgId: string; app: boolean }>();
    const calls: { operation: string; variables: Record<string, unknown>; authorization?: string }[] = [];
    const faults = new Map<string, LinearFault[]>();
    const responseHeaders = new Map<string, Record<string, string>[]>();
    let url = '';
    let sequence = 0;
    let loseRefreshResponse = false;
    let loseUploadResponse = false;
    let pages = 1;
    let refreshCalls = 0;
    const options = (kind: string, after: unknown) => {
        const page = typeof after === 'string' ? Number(after) : 0;
        const nodes = kind === 'teams' ? [{ id: teamId, name: 'Engineering' }]
            : kind === 'projects' ? [{ id: projectId, name: 'Website' }]
                : kind === 'states' ? [{ id: openStateId, name: 'Todo', type: 'unstarted' }, { id: doneStateId, name: 'Done', type: 'completed' }]
                    : [{ id: labelId, name: 'Website feedback' }];
        return { nodes, pageInfo: { hasNextPage: page + 1 < pages, endCursor: String(page + 1) } };
    };
    function tokenPair(orgId: string, app: boolean) {
        const access = `linear-test-access-${randomUUID()}`; const refresh = `linear-test-refresh-${randomUUID()}`;
        tokens.set(access, { orgId, app, refresh }); refreshes.set(refresh, { access, refresh, orgId, app }); return { access, refresh };
    }
    const tokenPayload = (pair: { access: string; refresh: string }) => ({ access_token: pair.access, refresh_token: pair.refresh,
        expires_in: 86400, token_type: 'Bearer', scope: 'read write' });
    const server = createServer(async (request, response) => {
        try {
            const target = new URL(request.url!, url || 'http://127.0.0.1');
            if (target.pathname === '/') return send(response, { ready: true });
            if (target.pathname === '/oauth/authorize' && request.method === 'GET') {
                const redirect = new URL(target.searchParams.get('redirect_uri') ?? 'https://invalid.example');
                const state = target.searchParams.get('state') ?? '';
                const challenge = target.searchParams.get('code_challenge') ?? '';
                if (!['http:', 'https:'].includes(redirect.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
                    || redirect.pathname !== '/app/linear/callback' || redirect.username || redirect.password || redirect.hash
                    || target.searchParams.get('client_id') !== 'linear-test-client' || target.searchParams.get('actor') !== 'app'
                    || target.searchParams.get('response_type') !== 'code' || target.searchParams.get('code_challenge_method') !== 'S256'
                    || target.searchParams.get('scope') !== 'read,write' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !state)
                    return send(response, { error: 'invalid_authorization' }, 400);
                const flow = randomUUID();
                // Browser users each get a separate fake organization, so unrelated workspaces do not share a live installation.
                authorizations.set(flow, { redirect: redirect.href, state, challenge, orgId: randomUUID() });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return response.end(`<!doctype html><html lang="en"><head><title>Linear test authorization</title></head><body><main><h1>Connect Linear test workspace</h1><p>This local stand-in grants the uier app access to a test organization.</p><form method="post" action="/oauth/decision"><input type="hidden" name="flow" value="${flow}"><button name="decision" value="allow">Allow Linear connection</button><button name="decision" value="deny">Cancel Linear connection</button></form></main></body></html>`);
            }
            if (target.pathname === '/oauth/decision' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request));
                const flowId = params.get('flow') ?? ''; const flow = authorizations.get(flowId); authorizations.delete(flowId);
                if (!flow) return send(response, { error: 'invalid_authorization' }, 400);
                const redirect = new URL(flow.redirect); redirect.searchParams.set('state', flow.state);
                if (params.get('decision') === 'allow') {
                    const code = randomUUID(); codes.set(code, { challenge: flow.challenge, app: true, orgId: flow.orgId }); redirect.searchParams.set('code', code);
                } else redirect.searchParams.set('error', 'access_denied');
                response.writeHead(303, { Location: redirect.href, 'Cache-Control': 'no-store' }); return response.end();
            }
            if (target.pathname === '/oauth/token') {
                const params = new URLSearchParams(await body(request));
                if (params.get('client_id') !== 'linear-test-client' || params.get('client_secret') !== 'linear-test-secret') return send(response, { error: 'invalid_client' }, 401);
                if (params.get('grant_type') === 'authorization_code') {
                    const code = params.get('code')!; const flow = codes.get(code); codes.delete(code);
                    if (!flow || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== flow.challenge)
                        return send(response, { error: 'invalid_grant' }, 400);
                    return send(response, tokenPayload(tokenPair(flow.orgId, flow.app)));
                }
                if (params.get('grant_type') === 'refresh_token') {
                    refreshCalls++;
                    const old = refreshes.get(params.get('refresh_token')!);
                    if (!old) return send(response, { error: 'invalid_grant' }, 400);
                    old.replay ??= tokenPair(old.orgId, old.app);
                    if (loseRefreshResponse) { loseRefreshResponse = false; response.destroy(); return; }
                    return send(response, tokenPayload(old.replay));
                }
                return send(response, { error: 'unsupported_grant_type' }, 400);
            }
            if (target.pathname === '/oauth/revoke') {
                const params = new URLSearchParams(await body(request)); const token = params.get('token')!;
                const value = tokens.get(token); tokens.delete(token); if (value) refreshes.delete(value.refresh);
                calls.push({ operation: 'revoke', variables: {} }); return send(response, { success: true });
            }
            if (target.pathname.startsWith('/upload/')) {
                const id = target.pathname.split('/')[2]!; const asset = assets.get(id);
                const data = await rawBody(request);
                if (!asset || request.headers.authorization || request.headers['x-upload-key'] !== asset.key || target.searchParams.get('signature') !== 'stub-only') return send(response, {}, 403);
                const chunks = data; asset.bytes = chunks;
                calls.push({ operation: 'upload_put', variables: { id, length: chunks.length }, authorization: request.headers.authorization });
                if (loseUploadResponse) { loseUploadResponse = false; response.destroy(); return; }
                response.writeHead(200); return response.end();
            }
            if (target.pathname.startsWith('/asset/')) {
                const bearer = request.headers.authorization?.replace(/^Bearer /, '');
                const asset = assets.get(target.pathname.split('/')[2]!);
                if (!bearer || !tokens.has(bearer)) return send(response, {}, 401);
                if (!asset?.bytes) return send(response, {}, 404);
                calls.push({ operation: 'asset_get', variables: {}, authorization: bearer });
                response.writeHead(206, { 'Content-Type': asset.contentType }); return response.end(asset.bytes.subarray(0, 1));
            }
            if (target.pathname !== '/graphql') return send(response, {}, 404);
            const bearer = request.headers.authorization?.replace(/^Bearer /, '');
            const auth = bearer ? tokens.get(bearer) : undefined;
            if (!auth) return send(response, { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }, 401);
            const payload = JSON.parse(await body(request)) as { operationName: string; query: string; variables: Record<string, unknown> };
            const name = payload.operationName; const v = payload.variables;
            if (request.method !== 'POST' || !payload.query.includes(name) || request.headers['content-type'] !== 'application/json') return gqlError(response, 'BAD_REQUEST');
            calls.push({ operation: name, variables: structuredClone(v), authorization: bearer });
            const fault = faults.get(name)?.shift();
            if (fault === 'rate_limit') return send(response, { errors: [{ extensions: { code: 'RATELIMITED' } }] }, 429, { 'Retry-After': '7' });
            if (fault === 'forbidden') return gqlError(response, 'FORBIDDEN');
            if (fault === 'unauthenticated') return send(response, {}, 401);
            if (fault === 'partial') return gqlError(response, 'INTERNAL_SERVER_ERROR', { someUnrelatedField: 'partial success' });
            if (fault === 'invalid_success') return send(response, { data: { issueCreate: { success: false, issue: null } } });
            if (fault === 'invalid_input') return send(response, { errors: [{ message: 'Invalid issue filter',
                extensions: { code: 'INPUT_ERROR', type: 'invalid input', statusCode: 400, userError: true } }], data: null });
            let result: Record<string, unknown>;
            if (name === 'UierLinearIdentity') result = { viewer: { id: appUserId, app: auth.app, active: true }, organization: { id: auth.orgId, name: 'Test organization', urlKey: 'test' } };
            else if (['UierLinearTeams', 'UierLinearProjects', 'UierLinearStates', 'UierLinearLabels'].includes(name)) {
                const kind = name.replace('UierLinear', '').toLowerCase();
                if (kind !== 'teams' && v.teamId !== teamId) return gqlError(response, 'NOT_FOUND');
                result = kind === 'teams' ? { teams: options(kind, v.after) } : { team: { id: teamId, organization: { id: auth.orgId }, [kind]: options(kind, v.after) } };
            } else if (name === 'UierLinearDestination') result = { team: { id: teamId, archivedAt: null, organization: { id: auth.orgId } },
                open: { id: openStateId, type: 'unstarted', archivedAt: null, team: { id: teamId } }, done: { id: doneStateId, type: 'completed', archivedAt: null, team: { id: teamId } } };
            else if (name === 'UierLinearIssue') {
                const issue = issues.get(v.id as string); if (!issue) return missingEntity(response, 'Issue'); result = { issue };
            } else if (name === 'UierLinearIssueCreate') {
                const input = v.input as Record<string, unknown>;
                if (issues.has(input.id as string)) return gqlError(response, 'CONFLICT');
                if (input.teamId !== teamId || !String(input.description).includes('uier-source:')) return gqlError(response, 'BAD_REQUEST');
                const issue: StubLinearIssue = { id: input.id as string, identifier: `TEST-${++sequence}`, url: `https://linear.app/test/issue/TEST-${sequence}`,
                    title: input.title as string, description: input.description as string, team: { id: teamId }, creator: { id: appUserId },
                    project: input.projectId ? { id: input.projectId as string } : null, state: { id: input.stateId as string },
                    labels: { nodes: (input.labelIds as string[] ?? []).map(id => ({ id })) }, trashed: false, archivedAt: null };
                issues.set(issue.id, issue); result = { issueCreate: { success: true, issue } };
            } else if (name === 'UierLinearIssueUpdate') {
                const issue = issues.get(v.id as string); if (!issue) return gqlError(response, 'ENTITY_NOT_FOUND', { issueUpdate: null });
                const input = v.input as Record<string, unknown>;
                for (const key of ['title', 'description'] as const) if (typeof input[key] === 'string') issue[key] = input[key];
                if (typeof input.stateId === 'string') issue.state = { id: input.stateId };
                const labels = new Set(issue.labels.nodes.map(node => node.id));
                for (const id of input.addedLabelIds as string[] ?? []) labels.add(id);
                for (const id of input.removedLabelIds as string[] ?? []) labels.delete(id);
                issue.labels = { nodes: [...labels].map(id => ({ id })) }; result = { issueUpdate: { success: true, issue: { id: issue.id } } };
            } else if (name === 'UierLinearIssueDelete') {
                const issue = issues.get(v.id as string); if (!issue) return gqlError(response, 'ENTITY_NOT_FOUND');
                if (payload.query.includes('permanentlyDelete: true')) return gqlError(response, 'FORBIDDEN');
                issue.trashed = true; result = { issueDelete: { success: true } };
            } else if (name === 'UierLinearComment') {
                const comment = comments.get(v.id as string); if (!comment) return missingEntity(response, 'Comment'); result = { comment };
            } else if (name === 'UierLinearCommentCreate') {
                const input = v.input as Record<string, unknown>;
                if (comments.has(input.id as string)) return gqlError(response, 'CONFLICT');
                const comment: StubLinearComment = { id: input.id as string, body: input.body as string, user: { id: appUserId }, issue: { id: input.issueId as string } };
                comments.set(comment.id, comment); result = { commentCreate: { success: true, comment } };
            } else if (name === 'UierLinearCommentUpdate') {
                const comment = comments.get(v.id as string); if (!comment) return gqlError(response, 'ENTITY_NOT_FOUND');
                comment.body = (v.input as { body: string }).body; result = { commentUpdate: { success: true, comment: { id: comment.id } } };
            } else if (name === 'UierLinearCommentDelete') {
                comments.delete(v.id as string); result = { commentDelete: { success: true } };
            } else if (name === 'UierLinearFileUpload') {
                if (!payload.query.includes('makePublic: false')) return gqlError(response, 'FORBIDDEN');
                const id = randomUUID(); const key = randomUUID(); assets.set(id, { key, contentType: v.contentType as string });
                result = { fileUpload: { success: true, uploadFile: { uploadUrl: `${url}/upload/${id}?signature=stub-only`, assetUrl: `${url}/asset/${id}`,
                    headers: [{ key: 'x-upload-key', value: key }] } } };
            } else return gqlError(response, 'UNKNOWN_OPERATION');
            if (fault === 'lost') { response.destroy(); return; }
            send(response, { data: result }, 200, responseHeaders.get(name)?.shift() ?? {});
        } catch { send(response, { errors: [{ extensions: { code: 'STUB_ERROR' } }] }, 500); }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Stub address unavailable');
    url = `http://127.0.0.1:${address.port}`;
    return { url, organizationId, appUserId, teamId, projectId, openStateId, doneStateId, labelId, issues, comments, assets, calls, faults,
        get refreshCalls() { return refreshCalls; },
        code(challenge: string, options: { app?: boolean; organizationId?: string } = {}) { const code = randomUUID(); codes.set(code, { challenge, app: options.app !== false, orgId: options.organizationId ?? organizationId }); return code; },
        fault(operation: string, next: LinearFault) { const list = faults.get(operation) ?? []; list.push(next); faults.set(operation, list); },
        headers(operation: string, headers: Record<string, string>) { const values = responseHeaders.get(operation) ?? []; values.push(headers); responseHeaders.set(operation, values); },
        loseNextRefresh() { loseRefreshResponse = true; }, loseNextUpload() { loseUploadResponse = true; }, setPages(value: number) { pages = value; },
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local Linear stub PORT');
    const stub = await startLinearStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
