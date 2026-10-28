import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

type Obj = Record<string, any>;
type Fault = { method: string; path: string | RegExp; status?: number; code?: string; afterCommit?: boolean; retryAfter?: number; reason?: string };
const id = () => randomUUID();
const plain = (value: unknown) => Array.isArray(value) ? value.map(part => (part as Obj)?.text?.content ?? (part as Obj)?.plain_text ?? '').join('') : '';
const errorBody = (status: number, code: string, reason?: string) => ({ object: 'error', status, code, message: 'Untrusted provider response with private text', additional_data: reason ? { rate_limit_reason: reason } : {} });

/** Stateful HTTP contract stub. It rejects old query verbs, old append positions and public image bypasses. */
export async function startNotionStub(port = 0) {
    const calls: { method: string; path: string; body: Obj; version?: string; auth: string }[] = [];
    const codes = new Map<string, Obj>(); const tokens = new Map<string, Obj>(); const refreshes = new Map<string, Obj>();
    const sources = new Map<string, Obj>(); const databases = new Map<string, Obj>();
    const pages = new Map<string, Obj>(); const blocks = new Map<string, Obj>(); const uploads = new Map<string, Obj>();
    const faults: Fault[] = [];
    function send(response: ServerResponse, status: number, body: Obj) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
    function issue(workspaceId: string, botId: string, noRefresh = false) {
        const access = `access-${id()}`; const refresh = noRefresh ? null : `refresh-${id()}`;
        const token = { access_token: access, refresh_token: refresh, token_type: 'bearer', workspace_id: workspaceId, workspace_name: 'Test workspace', bot_id: botId };
        tokens.set(access, token); if (refresh) refreshes.set(refresh, token); return token;
    }
    function properties(source: Obj, input: Obj) {
        const result: Obj = {};
        for (const [key, value] of Object.entries(input)) {
            const property = Object.values(source.properties).find((entry: any) => entry.id === key || entry.name === key) as Obj | undefined;
            if (!property) throw new Error('validation_error');
            const entry = value as Obj;
            if (!(property.type in entry)) throw new Error('validation_error');
            if (property.type === 'status' && entry.status && !property.status.options.some((option: Obj) => option.name === entry.status.name)) throw new Error('validation_error');
            result[property.id] = { ...structuredClone(entry), id: property.id, type: property.type };
        }
        return result;
    }
    function attach(uploadId: string) {
        const upload = uploads.get(uploadId);
        if (!upload || upload.status !== 'uploaded' || (!upload.attached && Date.parse(upload.expiry_time) <= Date.now())) throw new Error('validation_error');
        upload.attached = true;
    }
    function append(page: Obj, children: Obj[], position?: Obj) {
        if (children.length > 100) throw new Error('validation_error');
        let offset = page.children.length;
        if (position?.type === 'start') offset = 0;
        else if (position?.type === 'after_block') {
            offset = page.children.indexOf(position.after_block?.id) + 1;
            if (offset === 0) throw new Error('validation_error');
        } else if (position && position.type !== 'end') throw new Error('validation_error');
        const results = children.map(raw => {
            const body = structuredClone(raw[raw.type] ?? {});
            if (raw.type === 'code' && !body.language) throw new Error('validation_error');
            if (Array.isArray(body.rich_text) && (body.rich_text.length > 100 || body.rich_text.some((part: Obj) => String(part.text?.content ?? '').length > 2000))) throw new Error('validation_error');
            if (raw.type === 'image') {
                if (body.type !== 'file_upload') throw new Error('validation_error');
                attach(body.file_upload.id);
                delete body.file_upload; body.type = 'file'; body.file = { url: 'https://notion-files.example/protected-image' };
            }
            const block = { object: 'block', id: id(), type: raw.type, [raw.type]: body, parent: { type: 'page_id', page_id: page.id }, created_by: page.created_by, in_trash: false };
            blocks.set(block.id, block); return block;
        });
        page.children.splice(offset, 0, ...results.map(block => block.id)); return results;
    }
    function dataSource(workspaceId: string, name = 'Feedback') {
            const sourceId = id(); const databaseId = id();
            const definitions = [ ['Name', 'title', 'title'], ['uier id', 'uid', 'rich_text'], ['Status', 'status', 'status'], ['Kind', 'kind', 'select'], ['Environment', 'env', 'select'],
                ['Link', 'link', 'url'], ['Page', 'page', 'url'], ['Created', 'created', 'date'], ['Assignee', 'assignee', 'rich_text'], ['Screenshot', 'shot', 'files'] ];
            const schema = Object.fromEntries(definitions.map(([key, propertyId, type]) => [key!, { id: propertyId, name: key, type,
                [type!]: type === 'status' ? { options: [{ name: 'Open' }, { name: 'Done' }] } : type === 'select' ? { options: [] } : {} }]));
            sources.set(sourceId, { object: 'data_source', id: sourceId, title: [{ type: 'text', text: { content: name } }], properties: schema,
                parent: { type: 'database_id', database_id: databaseId }, in_trash: false, workspaceId });
            databases.set(databaseId, { object: 'database', id: databaseId, data_sources: [{ id: sourceId, name }] });
            return { id: sourceId, databaseId, schema };
        }
    const browserWorkspace = id(); const browserBot = id(); let browserReady = false;
    const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');
    function callback(value: string | null) {
        if (!value) throw new Error('Invalid callback');
        const url = new URL(value); const expected = process.env.UIER_NOTION_STUB_APP_BASE_URL;
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/app/notion/callback'
            || url.username || url.password || url.search || url.hash || (expected && url.origin !== new URL(expected).origin)) throw new Error('Invalid callback');
        return url;
    }
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1'); const path = url.pathname; const method = request.method ?? 'GET';
            if (path === '/') { send(response, 200, { ready: true }); return; }
            if (path === '/v1/oauth/authorize' && method === 'GET') {
                const redirect = callback(url.searchParams.get('redirect_uri')); const state = url.searchParams.get('state') ?? '';
                if (!/^[A-Za-z0-9_-]{40,100}$/.test(state) || url.searchParams.get('response_type') !== 'code') throw new Error('Invalid state');
                if (!browserReady) { dataSource(browserWorkspace, 'Website feedback'); dataSource(browserWorkspace, 'Other feedback'); browserReady = true; }
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; form-action 'self' ${redirect.origin}; base-uri 'none'` });
                response.end(`<!doctype html><html lang="en"><head><title>Notion test connection</title></head><body><main><h1>Connect Notion test workspace</h1>
                    <p>Allow the test uier app to read and update shared databases.</p><form method="post" action="/oauth/consent">
                    <input type="hidden" name="state" value="${escapeHtml(state)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirect.href)}">
                    <button name="choice" value="allow">Allow Notion connection</button><button name="choice" value="cancel">Cancel Notion connection</button></form></main></body></html>`);
                return;
            }
            const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const raw = Buffer.concat(chunks);
            if (path === '/oauth/consent' && method === 'POST') {
                const form = new URLSearchParams(raw.toString()); const redirect = callback(form.get('redirect_uri')); const state = form.get('state') ?? '';
                if (!/^[A-Za-z0-9_-]{40,100}$/.test(state)) throw new Error('Invalid state');
                redirect.searchParams.set('state', state);
                if (form.get('choice') === 'allow') { const code = id(); codes.set(code, { workspaceId: browserWorkspace, botId: browserBot }); redirect.searchParams.set('code', code); }
                else redirect.searchParams.set('error', 'access_denied');
                response.writeHead(302, { Location: redirect.href, 'Cache-Control': 'no-store' }); response.end(); return;
            }
            const multipart = String(request.headers['content-type']).startsWith('multipart/form-data; boundary=');
            let body: Obj = {}; if (raw.length && !multipart) { try { body = JSON.parse(raw.toString()) as Obj; } catch { send(response, 400, errorBody(400, 'invalid_json')); return; } }
            const auth = request.headers.authorization ?? '';
            calls.push({ method, path, body: path === '/v1/oauth/token' ? { grant_type: body.grant_type } : multipart ? { multipart: true, bytes: raw.length } : structuredClone(body),
                version: request.headers['notion-version'] as string | undefined, auth: auth.startsWith('Basic ') ? 'basic' : auth.startsWith('Bearer ') ? 'bearer' : 'none' });
            if (request.headers['notion-version'] !== '2026-03-11') { send(response, 400, errorBody(400, 'missing_version')); return; }
            const faultIndex = faults.findIndex(fault => fault.method === method && (typeof fault.path === 'string' ? fault.path === path : fault.path.test(path)));
            const fault = faultIndex < 0 ? undefined : faults.splice(faultIndex, 1)[0];
            if (fault && !fault.afterCommit) {
                if (fault.retryAfter !== undefined) response.setHeader('Retry-After', fault.retryAfter);
                send(response, fault.status ?? 500, errorBody(fault.status ?? 500, fault.code ?? 'internal_server_error', fault.reason)); return;
            }
            const reply = (status: number, result: Obj) => {
                if (fault?.afterCommit) { response.destroy(); return; }
                send(response, status, result);
            };
            if (path === '/v1/oauth/token' && method === 'POST') {
                if (!auth.startsWith('Basic ')) { send(response, 401, errorBody(401, 'invalid_client')); return; }
                if (body.grant_type === 'authorization_code') {
                    const selected = codes.get(body.code); codes.delete(body.code);
                    if (!selected) { send(response, 400, errorBody(400, 'invalid_grant')); return; }
                    reply(200, { ...issue(selected.workspaceId, selected.botId, selected.noRefresh), duplicated_template_id: selected.templateId ?? null }); return;
                }
                const old = refreshes.get(body.refresh_token); refreshes.delete(body.refresh_token);
                if (!old) { send(response, 400, errorBody(400, 'invalid_grant')); return; }
                tokens.delete(old.access_token); reply(200, issue(old.workspace_id, old.bot_id)); return;
            }
            const token = tokens.get(auth.replace(/^Bearer /, ''));
            if (!token) { send(response, 401, errorBody(401, 'unauthorized')); return; }
            if (path === '/v1/users/me') { reply(200, { object: 'user', id: token.bot_id, type: 'bot', bot: { workspace_limits: { max_file_upload_size_in_bytes: 5 * 1024 * 1024 } } }); return; }
            if (path === '/v1/search' && method === 'POST') {
                const results = [...sources.values()].filter(source => source.workspaceId === token.workspace_id && !source.in_trash).map(source => { const { workspaceId: _workspace, ...safe } = source; return safe; });
                reply(200, { object: 'list', results, has_more: false, next_cursor: null }); return;
            }
            const dataSourceMatch = /^\/v1\/data_sources\/([^/]+)(\/query)?$/.exec(path);
            if (dataSourceMatch) {
                const source = sources.get(dataSourceMatch[1]!);
                if (!source || source.workspaceId !== token.workspace_id) { send(response, 404, errorBody(404, 'object_not_found')); return; }
                if (dataSourceMatch[2]) {
                    if (method !== 'POST') { send(response, 400, errorBody(400, 'invalid_request')); return; }
                    const property = Object.values(source.properties).find((value: any) => value.id === body.filter?.property || value.name === body.filter?.property) as Obj | undefined;
                    const results = [...pages.values()].filter(page => page.parent.data_source_id === source.id && (!body.filter || plain(page.properties[property?.id]?.rich_text) === body.filter.rich_text?.equals));
                    reply(200, { object: 'list', results, has_more: false, next_cursor: null }); return;
                }
                const { workspaceId: _workspace, ...safe } = source; reply(200, safe); return;
            }
            const database = /^\/v1\/databases\/([^/]+)$/.exec(path);
            if (database) { const found = databases.get(database[1]!); if (!found) send(response, 404, errorBody(404, 'object_not_found')); else reply(200, found); return; }
            if (path === '/v1/pages' && method === 'POST') {
                const source = sources.get(body.parent?.data_source_id);
                if (body.parent?.type !== 'data_source_id' || !source || source.workspaceId !== token.workspace_id) { send(response, 400, errorBody(400, 'validation_error')); return; }
                const page = { object: 'page', id: id(), url: '', parent: { type: 'data_source_id', data_source_id: source.id }, properties: properties(source, body.properties ?? {}),
                    created_by: { object: 'user', id: token.bot_id }, in_trash: false, children: [] as string[] };
                page.url = `https://app.notion.com/p/${page.id}`; pages.set(page.id, page);
                if (body.children) append(page, body.children);
                reply(200, page); return;
            }
            const pagePath = /^\/v1\/pages\/([^/]+)$/.exec(path);
            if (pagePath) {
                const page = pages.get(pagePath[1]!);
                if (!page) { send(response, 404, errorBody(404, 'object_not_found')); return; }
                if (method === 'GET') { reply(200, page); return; }
                if (method === 'PATCH') {
                    if (page.in_trash && body.in_trash !== false && (body.properties || body.erase_content)) { send(response, 400, errorBody(400, 'validation_error')); return; }
                    if (body.properties) {
                        for (const raw of Object.values(body.properties) as Obj[]) if (raw.files) for (const file of raw.files) if (file.file_upload) attach(file.file_upload.id);
                        Object.assign(page.properties, properties(sources.get(page.parent.data_source_id)!, body.properties));
                    }
                    if (body.erase_content) { page.children.forEach((blockId: string) => { const block = blocks.get(blockId); if (block) block.in_trash = true; }); page.children = []; }
                    if (body.in_trash !== undefined) page.in_trash = body.in_trash;
                    reply(200, page); return;
                }
            }
            const childPath = /^\/v1\/blocks\/([^/]+)\/children$/.exec(path);
            if (childPath) {
                const page = pages.get(childPath[1]!);
                if (!page) { send(response, 404, errorBody(404, 'object_not_found')); return; }
                if (method === 'GET') { reply(200, { object: 'list', results: page.children.map((blockId: string) => blocks.get(blockId)).filter((block: Obj) => block && !block.in_trash), has_more: false, next_cursor: null }); return; }
                if (method === 'PATCH') {
                    if ('after' in body || page.in_trash) { send(response, 400, errorBody(400, 'validation_error')); return; }
                    reply(200, { object: 'list', results: append(page, body.children ?? [], body.position), has_more: false }); return;
                }
            }
            const blockPath = /^\/v1\/blocks\/([^/]+)$/.exec(path);
            if (blockPath) {
                const block = blocks.get(blockPath[1]!);
                if (!block) { send(response, 404, errorBody(404, 'object_not_found')); return; }
                if (method === 'PATCH') { if (body[block.type]) block[block.type] = structuredClone(body[block.type]); else { send(response, 400, errorBody(400, 'validation_error')); return; } }
                if (method === 'DELETE') block.in_trash = true;
                reply(200, block); return;
            }
            if (path === '/v1/file_uploads' && method === 'POST') {
                const upload = { object: 'file_upload', id: id(), status: 'pending', expiry_time: new Date(Date.now() + 60 * 60_000).toISOString(), attached: false, sends: 0 };
                uploads.set(upload.id, upload); reply(200, upload); return;
            }
            const uploadPath = /^\/v1\/file_uploads\/([^/]+)(\/send)?$/.exec(path);
            if (uploadPath) {
                const upload = uploads.get(uploadPath[1]!);
                if (!upload) { send(response, 404, errorBody(404, 'object_not_found')); return; }
                if (uploadPath[2]) {
                    if (!multipart || upload.sends || Date.parse(upload.expiry_time) <= Date.now()) { send(response, 400, errorBody(400, 'validation_error')); return; }
                    upload.sends++; upload.status = 'uploaded';
                }
                reply(200, upload); return;
            }
            send(response, 404, errorBody(404, 'object_not_found'));
        } catch {
            send(response, 400, errorBody(400, 'validation_error'));
        }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Stub did not start');
    return { url: `http://127.0.0.1:${address.port}`, calls, pages, blocks, uploads, sources, codes, tokens,
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
        code(workspaceId: string, botId: string, options: { noRefresh?: boolean; templateId?: string } = {}) { const code = id(); codes.set(code, { workspaceId, botId, ...options }); return code; },
        expireAccess() { tokens.clear(); },
        fault(fault: Fault) { faults.push(fault); },
        dataSource };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startNotionStub(Number(process.env.PORT ?? 27404)).then(stub => { process.stdout.write(`Notion stub ready on ${stub.url}\n`); });
}
