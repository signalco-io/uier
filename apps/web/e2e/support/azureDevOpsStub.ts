import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

export type StubWorkItem = { id: number; rev: number; projectId: string; type: string; createdDate: string; deleted: boolean; fields: Record<string, unknown> };
export type AzureDevOpsFault = 'rate_limit' | 'lost' | 'unanswered' | 'forbidden' | 'unauthenticated' | 'bad_request' | 'server_error' | 'not_found';
export type AzureDevOpsStub = Awaited<ReturnType<typeof startAzureDevOpsStub>>;

const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
async function body(request: IncomingMessage) { const parts = []; for await (const part of request) parts.push(Buffer.from(part)); return Buffer.concat(parts).toString('utf8'); }
const send = (response: ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value));
};
// Provider messages are never shown to people; the stub's text makes a leak easy to spot.
const fail = (response: ServerResponse, status: number) => send(response, { message: 'Stub provider error, never display this text', typeKey: 'StubError' }, status);

/** A loopback stand-in for Microsoft Entra ID and the Azure DevOps REST API subset uier uses. */
export async function startAzureDevOpsStub(port = 0) {
    const organization = 'uier-test'; const organizationId = randomUUID(); const userId = randomUUID();
    const projectId = randomUUID(); const projectName = 'Website'; let currentProjectName = projectName;
    const types = [
        { name: 'Bug', fields: ['System.Title', 'System.Description', 'Microsoft.VSTS.TCM.ReproSteps', 'System.State', 'System.AreaPath'],
            states: [['New', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed'], ['Removed', 'Removed']] },
        { name: 'Task', fields: ['System.Title', 'System.Description', 'System.State', 'System.AreaPath'],
            states: [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed']] },
        { name: 'Shared Steps', fields: ['System.Title', 'System.State'], states: [['Active', 'InProgress'], ['Closed', 'Completed']] }
    ];
    const workItems = new Map<number, StubWorkItem>();
    const codes = new Map<string, { challenge: string; userId: string; scope: string }>();
    const authorizations = new Map<string, { redirect: string; state: string; challenge: string }>();
    const tokens = new Map<string, { userId: string }>();
    const refreshes = new Map<string, { userId: string }>();
    const calls: { operation: string; method: string; path: string; body?: unknown; authorization?: string }[] = [];
    const faults = new Map<string, AzureDevOpsFault[]>();
    let url = '';
    let sequence = 100;
    let refreshCalls = 0;
    const tokenPair = (owner: string) => {
        const access = `ado-test-access-${randomUUID()}`; const refresh = `ado-test-refresh-${randomUUID()}`;
        tokens.set(access, { userId: owner }); refreshes.set(refresh, { userId: owner });
        return { token_type: 'Bearer', expires_in: 3599, access_token: access, refresh_token: refresh,
            scope: `${RESOURCE}/vso.work_write ${RESOURCE}/vso.profile` };
    };
    const typeOf = (name: string) => types.find(type => type.name.toLowerCase() === name.toLowerCase());
    const itemDto = (item: StubWorkItem, fields?: string[]) => ({ id: item.id, rev: item.rev, url: `${url}/devops/${organization}/_apis/wit/workItems/${item.id}`,
        fields: Object.fromEntries(Object.entries({ ...item.fields, 'System.Id': item.id, 'System.TeamProject': currentProjectName,
            'System.WorkItemType': item.type, 'System.CreatedDate': item.createdDate }).filter(([key]) => !fields || fields.includes(key))) });
    function applyPatch(item: StubWorkItem, operations: unknown) {
        if (!Array.isArray(operations)) return false;
        const type = typeOf(item.type)!;
        for (const operation of operations as { op: string; path: string; value: unknown }[]) {
            const field = operation.path.replace(/^\/fields\//, '');
            if (operation.op !== 'add' || !operation.path.startsWith('/fields/') || !type.fields.includes(field) || typeof operation.value !== 'string') return false;
            if (field === 'System.State' && !type.states.some(([name]) => name === operation.value)) return false;
            if (field === 'System.AreaPath' && ![projectName, `${projectName}\\Marketing`].includes(operation.value)) return false;
            item.fields[field] = operation.value;
        }
        item.rev++; return true;
    }

    const server = createServer(async (request, response) => {
        try {
            const target = new URL(request.url!, url || 'http://127.0.0.1');
            const path = target.pathname;
            if (path === '/') return send(response, { ready: true });
            if (path === '/oauth2/v2.0/authorize' && request.method === 'GET') {
                const redirect = new URL(target.searchParams.get('redirect_uri') ?? 'https://invalid.example');
                const state = target.searchParams.get('state') ?? ''; const challenge = target.searchParams.get('code_challenge') ?? '';
                if (!['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) || redirect.pathname !== '/app/azure-devops/callback'
                    || target.searchParams.get('client_id') !== 'ado-test-client' || target.searchParams.get('response_type') !== 'code'
                    || target.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !state
                    || target.searchParams.get('scope') !== `${RESOURCE}/vso.work_write ${RESOURCE}/vso.profile offline_access`)
                    return send(response, { error: 'invalid_request' }, 400);
                const flow = randomUUID(); authorizations.set(flow, { redirect: redirect.href, state, challenge });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return response.end(`<!doctype html><html lang="en"><head><title>Microsoft test sign-in</title></head><body><main><h1>Sign in to the Azure DevOps test organization</h1><p>This local stand-in grants uier delegated access to work items.</p><form method="post" action="/oauth2/v2.0/decision"><input type="hidden" name="flow" value="${flow}"><button name="decision" value="allow">Accept Azure DevOps access</button><button name="decision" value="deny">Cancel Azure DevOps access</button></form></main></body></html>`);
            }
            if (path === '/oauth2/v2.0/decision' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request));
                const flow = authorizations.get(params.get('flow') ?? ''); authorizations.delete(params.get('flow') ?? '');
                if (!flow) return send(response, { error: 'invalid_request' }, 400);
                const redirect = new URL(flow.redirect); redirect.searchParams.set('state', flow.state);
                if (params.get('decision') === 'allow') {
                    const code = randomUUID(); codes.set(code, { challenge: flow.challenge, userId: randomUUID(), scope: 'full' }); redirect.searchParams.set('code', code);
                } else { redirect.searchParams.set('error', 'access_denied'); redirect.searchParams.set('error_description', 'Stub provider error, never display this text'); }
                response.writeHead(303, { Location: redirect.href, 'Cache-Control': 'no-store' }); return response.end();
            }
            if (path === '/oauth2/v2.0/token' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request));
                calls.push({ operation: 'token', method: 'POST', path, body: { grant_type: params.get('grant_type') } });
                const fault = faults.get('token')?.shift();
                if (fault === 'unanswered') { response.destroy(); return; }
                if (params.get('client_id') !== 'ado-test-client' || params.get('client_secret') !== 'ado-test-secret') return send(response, { error: 'invalid_client' }, 401);
                if (params.get('scope') !== `${RESOURCE}/vso.work_write ${RESOURCE}/vso.profile offline_access`) return send(response, { error: 'invalid_scope' }, 400);
                if (params.get('grant_type') === 'authorization_code') {
                    const flow = codes.get(params.get('code') ?? ''); codes.delete(params.get('code') ?? '');
                    if (!flow || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== flow.challenge)
                        return send(response, { error: 'invalid_grant' }, 400);
                    const pair = tokenPair(flow.userId);
                    return send(response, flow.scope === 'full' ? pair : { ...pair, scope: `${RESOURCE}/vso.profile` });
                }
                if (params.get('grant_type') === 'refresh_token') {
                    refreshCalls++;
                    const old = refreshes.get(params.get('refresh_token') ?? '');
                    if (!old || fault === 'bad_request') return send(response, { error: 'invalid_grant' }, 400);
                    // Entra keeps a redeemed refresh token valid until it expires.
                    return send(response, tokenPair(old.userId));
                }
                return send(response, { error: 'unsupported_grant_type' }, 400);
            }
            const bearer = request.headers.authorization?.replace(/^Bearer /, '');
            const auth = bearer ? tokens.get(bearer) : undefined;
            const raw = request.method === 'GET' || request.method === 'DELETE' ? '' : await body(request);
            const payload = raw ? JSON.parse(raw) as unknown : undefined;
            let operation = 'unknown';
            const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
            if (path === '/vssps/_apis/profile/profiles/me') operation = 'profile';
            else if (path === '/vssps/_apis/accounts') operation = 'accounts';
            else if (segments[0] === 'devops' && segments[1] === organization) {
                const rest = segments.slice(2);
                if (rest.join('/') === '_apis/projects') operation = 'projects';
                else if (rest[0] === '_apis' && rest[1] === 'projects' && rest.length === 3) operation = 'project';
                else if (rest[0] === '_apis' && rest[1] === 'wit' && rest[2] === 'workitems' && rest.length === 4)
                    operation = request.method === 'PATCH' ? 'update' : request.method === 'DELETE' ? 'delete' : 'get';
                else if (rest[0] === projectId && rest[1] === '_apis' && rest[2] === 'wit') {
                    const wit = rest.slice(3);
                    if (wit.join('/') === 'workitemtypes') operation = 'types';
                    else if (wit.join('/') === 'workitemtypecategories') operation = 'categories';
                    else if (wit.join('/') === 'classificationnodes/areas') operation = 'areas';
                    else if (wit[0] === 'workitemtypes' && wit[2] === 'fields') operation = 'fields';
                    else if (wit[0] === 'workitems' && wit[1]?.startsWith('$') && request.method === 'POST') operation = 'create';
                    else if (wit.join('/') === 'wiql' && request.method === 'POST') operation = 'wiql';
                    else if (wit.join('/') === 'workitemsbatch' && request.method === 'POST') operation = 'batch';
                }
            }
            calls.push({ operation, method: request.method ?? 'GET', path, body: payload, authorization: bearer });
            if (target.searchParams.get('api-version') !== '7.1') return fail(response, 400);
            if (!auth) return fail(response, 401);
            const fault = faults.get(operation)?.shift();
            if (fault === 'rate_limit') return send(response, { message: 'throttled' }, 429, { 'Retry-After': '7' });
            if (fault === 'unauthenticated') { tokens.delete(bearer!); return fail(response, 401); }
            if (fault === 'forbidden') return fail(response, 403);
            if (fault === 'not_found') return fail(response, 404);
            if (fault === 'bad_request') return fail(response, 400);
            if (fault === 'server_error') return fail(response, 500);
            if (fault === 'unanswered') { response.destroy(); return; }
            let result: unknown; let status = 200;
            if (operation === 'profile') result = { id: auth.userId, displayName: 'Test Microsoft user', publicAlias: auth.userId, emailAddress: 'stub@example.test' };
            else if (operation === 'accounts') {
                if (target.searchParams.get('memberId') !== auth.userId) return fail(response, 400);
                result = { count: 1, value: [{ accountId: organizationId, accountName: organization, accountUri: `https://vssps.dev.azure.com/${organization}/` }] };
            } else if (operation === 'projects') result = { count: 1, value: [{ id: projectId, name: currentProjectName, state: 'wellFormed' }] };
            else if (operation === 'project') {
                if (segments[4] !== projectId) return fail(response, 404);
                result = { id: projectId, name: currentProjectName, state: 'wellFormed' };
            } else if (operation === 'types') result = { count: types.length, value: types.map(type => ({ name: type.name, referenceName: `Microsoft.VSTS.WorkItemTypes.${type.name}`,
                isDisabled: false, states: type.states.map(([name, category]) => ({ name, category, color: '000000' })) })) };
            else if (operation === 'categories') result = { count: 2, value: [
                { name: 'Bug Category', referenceName: 'Microsoft.BugCategory', workItemTypes: [{ name: 'Bug' }] },
                { name: 'Hidden Types Category', referenceName: 'Microsoft.HiddenCategory', workItemTypes: [{ name: 'Shared Steps' }] }] };
            else if (operation === 'areas') result = { id: 1, name: currentProjectName, structureType: 'area', hasChildren: true,
                children: [{ id: 2, name: 'Marketing', structureType: 'area', hasChildren: false }] };
            else if (operation === 'fields') {
                const type = typeOf(segments.at(-2)!); if (!type) return fail(response, 404);
                result = { count: type.fields.length, value: type.fields.map(referenceName => ({ referenceName, name: referenceName })) };
            } else if (operation === 'create') {
                const type = typeOf(segments.at(-1)!.slice(1));
                if (!type || request.headers['content-type'] !== 'application/json-patch+json') return fail(response, 400);
                const item: StubWorkItem = { id: ++sequence, rev: 0, projectId, type: type.name, createdDate: new Date().toISOString(), deleted: false,
                    fields: { 'System.State': type.states[0]![0], 'System.AreaPath': projectName, 'System.Title': '' } };
                if (!applyPatch(item, payload)) return fail(response, 400);
                workItems.set(item.id, item); result = itemDto(item);
            } else if (operation === 'get' || operation === 'update' || operation === 'delete') {
                const item = workItems.get(Number(segments.at(-1))); if (!item || item.deleted) return fail(response, 404);
                if (operation === 'get') result = itemDto(item, target.searchParams.get('fields')?.split(','));
                else if (operation === 'update') {
                    if (request.headers['content-type'] !== 'application/json-patch+json' || !applyPatch(item, payload)) return fail(response, 400);
                    result = itemDto(item);
                } else {
                    if (target.searchParams.get('destroy') === 'true') return fail(response, 403);
                    item.deleted = true; result = { id: item.id, project: projectName, type: item.type, deletedDate: new Date().toISOString() };
                }
            } else if (operation === 'wiql') {
                const query = String((payload as { query?: unknown })?.query ?? '');
                const match = /\[System\.WorkItemType\] = '((?:[^']|'')+)' AND \[System\.CreatedDate\] >= '([^']+)' AND \[System\.CreatedDate\] <= '([^']+)' AND \[System\.Id\] > (\d+) ORDER BY \[System\.Id\]$/.exec(query);
                if (!query.includes('[System.TeamProject] = @project') || !match || target.searchParams.get('timePrecision') !== 'true') return fail(response, 400);
                const [, type, since, until, after] = match;
                const top = Number(target.searchParams.get('$top') ?? 20_000);
                const ids = [...workItems.values()].filter(item => item.type === type!.replace(/''/g, "'") && item.createdDate >= since! && item.createdDate <= until!
                    && item.id > Number(after) && !item.deleted).map(item => item.id).sort((a, b) => a - b).slice(0, top);
                result = { queryType: 'flat', workItems: ids.map(id => ({ id, url: `${url}/devops/${organization}/_apis/wit/workItems/${id}` })) };
            } else if (operation === 'batch') {
                const input = payload as { ids?: number[]; fields?: string[]; errorPolicy?: string };
                if (!Array.isArray(input?.ids) || input.ids.length > 200) return fail(response, 400);
                result = { count: input.ids.length, value: input.ids.map(id => workItems.get(id)).map(item => item && !item.deleted ? itemDto(item, input.fields) : null) };
            } else return fail(response, 404);
            if (fault === 'lost') { response.destroy(); return; }
            send(response, result, status);
        } catch { send(response, { message: 'stub failure' }, 500); }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Stub address unavailable');
    url = `http://127.0.0.1:${address.port}`;
    return { url, organization, organizationId, userId, projectId, projectName, workItems, calls, faults,
        get refreshCalls() { return refreshCalls; },
        code(challenge: string, options: { userId?: string; profileOnly?: boolean } = {}) {
            const code = randomUUID(); codes.set(code, { challenge, userId: options.userId ?? userId, scope: options.profileOnly ? 'profile' : 'full' }); return code;
        },
        fault(operation: string, next: AzureDevOpsFault) { const list = faults.get(operation) ?? []; list.push(next); faults.set(operation, list); },
        renameProject(name: string) { currentProjectName = name; },
        revokeTokens() { tokens.clear(); },
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local Azure DevOps stub PORT');
    const stub = await startAzureDevOpsStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
