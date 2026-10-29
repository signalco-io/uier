import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

type Obj = Record<string, unknown>;
type CodeOptions = { teamId?: string; scopes?: string; appId?: string; enterprise?: boolean; rotation?: boolean; userToken?: boolean };
type Token = { teamId: string; userId: string; refresh: string };
export type SlackStubMessage = { channel: string; ts: string; owner: string; payload: Obj; threadTs?: string };
export type SlackStubFault = 'lost' | 'rate' | 'internal' | 'auth' | 'forbidden' | 'invalid_ok' | 'missing';
const slackId = (prefix: string) => prefix + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
async function body(request: IncomingMessage) { const parts = []; for await (const part of request) parts.push(Buffer.from(part)); return Buffer.concat(parts).toString(); }
const send = (response: ServerResponse, data: Obj, status = 200, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(data));
};

/** Real loopback Web API/OAuth fixture. History methods do not exist and ownership is enforced. */
export async function startSlackStub(port = 0) {
    const teamId = slackId('T'); const botId = slackId('U'); const channelId = slackId('C'); const secondChannelId = slackId('C');
    const privateChannelId = slackId('G'); const appId = 'ATESTAPP';
    const channels = new Map<string, Obj>([
        [channelId, { id: channelId, name: 'feedback', is_channel: true, is_member: true, is_archived: false, is_shared: false, is_private: false }],
        [secondChannelId, { id: secondChannelId, name: 'website', is_channel: true, is_member: true, is_archived: false, is_shared: false, is_private: false }],
        [privateChannelId, { id: privateChannelId, name: 'private-feedback', is_channel: true, is_member: true, is_archived: false, is_shared: false, is_private: true }],
        ['CUNINVITED', { id: 'CUNINVITED', name: 'uninvited', is_channel: true, is_member: false, is_archived: false, is_shared: false }],
        ['CSHARED', { id: 'CSHARED', name: 'shared', is_channel: true, is_member: true, is_archived: false, is_shared: true }],
        ['CARCHIVED', { id: 'CARCHIVED', name: 'archived', is_channel: true, is_member: true, is_archived: true, is_shared: false }]
    ]);
    const codes = new Map<string, CodeOptions>(); const tokens = new Map<string, Token>(); const refreshes = new Map<string, Token>();
    const authorizations = new Map<string, { redirect: string; state: string; teamId: string }>();
    const messages = new Map<string, SlackStubMessage>();
    const calls: { method: string; verb: string; payload: Obj; teamId?: string; at: number }[] = [];
    const faults = new Map<string, SlackStubFault[]>(); const rateDelays = new Map<string, string[]>();
    let loseRefresh = false; let refreshCalls = 0; let oauthCalls = 0; let sequence = 0; let url = '';
    function token(team: string) {
        const access = `xoxb-test-${randomUUID()}`; const refresh = `xoxe-test-${randomUUID()}`;
        const value = { teamId: team, userId: botId, refresh }; tokens.set(access, value); refreshes.set(refresh, value);
        return { ok: true, access_token: access, refresh_token: refresh, token_type: 'bot', expires_in: 43200,
            app_id: appId, team: { id: team, name: 'Test Slack workspace' }, bot_user_id: botId, scope: 'chat:write,channels:read,groups:read', is_enterprise_install: false };
    }
    const server = createServer(async (request, response) => {
        try {
            const target = new URL(request.url!, url || 'http://127.0.0.1');
            if (target.pathname === '/') return send(response, { ready: true });
            if (target.pathname === '/oauth/authorize' && request.method === 'GET') {
                const redirect = new URL(target.searchParams.get('redirect_uri') ?? 'https://invalid.example');
                const state = target.searchParams.get('state');
                if (!['http:', 'https:'].includes(redirect.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
                    || redirect.pathname !== '/app/slack/callback' || redirect.username || redirect.password || redirect.hash
                    || target.searchParams.get('client_id') !== 'slack-test-client' || target.searchParams.get('scope') !== 'chat:write,channels:read,groups:read'
                    || target.searchParams.has('user_scope') || !state) return send(response, { ok: false, error: 'invalid_arguments' }, 400);
                const flow = randomUUID(); authorizations.set(flow, { redirect: redirect.href, state, teamId: slackId('T') });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return response.end(`<!doctype html><html lang="en"><head><title>Slack test authorization</title></head><body><main><h1>Connect Slack test workspace</h1><p>This local stand-in grants the uier bot access to a test workspace.</p><form method="post" action="/oauth/decision"><input type="hidden" name="flow" value="${flow}"><button name="decision" value="allow">Allow Slack connection</button><button name="decision" value="deny">Cancel Slack connection</button></form></main></body></html>`);
            }
            if (target.pathname === '/oauth/decision' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request)); const flowId = params.get('flow') ?? '';
                const flow = authorizations.get(flowId); authorizations.delete(flowId);
                if (!flow) return send(response, { ok: false, error: 'invalid_arguments' }, 400);
                const redirect = new URL(flow.redirect); redirect.searchParams.set('state', flow.state);
                if (params.get('decision') === 'allow') { const code = randomUUID(); codes.set(code, { teamId: flow.teamId }); redirect.searchParams.set('code', code); }
                else redirect.searchParams.set('error', 'access_denied');
                response.writeHead(303, { Location: redirect.href, 'Cache-Control': 'no-store' }); return response.end();
            }
            const method = target.pathname.replace(/^\/api\//, '');
            if (method === 'oauth.v2.access') {
                if (request.method !== 'POST' || request.headers.authorization !== `Basic ${Buffer.from('slack-test-client:slack-test-secret').toString('base64')}`
                    || request.headers['content-type'] !== 'application/x-www-form-urlencoded') return send(response, { ok: false, error: 'invalid_client' });
                const params = new URLSearchParams(await body(request));
                if (params.get('grant_type') === 'refresh_token') {
                    refreshCalls++;
                    if (faults.get('oauth.v2.access')?.shift() === 'rate') return send(response, { ok: false, error: 'ratelimited' }, 429,
                        { 'Retry-After': rateDelays.get('oauth.v2.access')?.shift() ?? '2' });
                    const value = refreshes.get(params.get('refresh_token') ?? ''); refreshes.delete(params.get('refresh_token') ?? '');
                    if (!value) return send(response, { ok: false, error: 'invalid_refresh_token' });
                    const replacement = token(value.teamId);
                    if (loseRefresh) { loseRefresh = false; response.destroy(); return; }
                    return send(response, replacement);
                }
                const code = params.get('code') ?? ''; const options = codes.get(code); codes.delete(code);
                if (!options) return send(response, { ok: false, error: 'invalid_code' });
                oauthCalls++;
                const result = token(options.teamId ?? teamId);
                return send(response, { ...result, app_id: options.appId ?? appId, scope: options.scopes ?? result.scope,
                    is_enterprise_install: options.enterprise === true,
                    ...(options.rotation === false ? { refresh_token: undefined, expires_in: undefined } : {}),
                    ...(options.userToken ? { authed_user: { access_token: 'xoxp-private-user-token' } } : {}) });
            }
            const auth = request.headers.authorization?.replace(/^Bearer /, ''); const identity = auth ? tokens.get(auth) : undefined;
            if (!identity) return send(response, { ok: false, error: 'invalid_auth' });
            const read = ['auth.test', 'conversations.list', 'conversations.info', 'chat.getPermalink'].includes(method);
            if (request.method !== (read ? 'GET' : 'POST')) return send(response, { ok: false, error: 'invalid_method' }, 405);
            const payload: Obj = read ? Object.fromEntries(target.searchParams.entries()) : JSON.parse(await body(request)) as Obj;
            calls.push({ method, verb: request.method!, payload: structuredClone(payload), teamId: identity.teamId, at: Date.now() });
            const fault = faults.get(method)?.shift();
            if (fault === 'rate') return send(response, { ok: false, error: 'ratelimited' }, 429, { 'Retry-After': rateDelays.get(method)?.shift() ?? '2' });
            if (fault === 'internal') return send(response, { ok: false, error: 'internal_error' });
            if (fault === 'auth') return send(response, { ok: false, error: 'invalid_auth' });
            if (fault === 'forbidden') return send(response, { ok: false, error: 'not_in_channel' });
            if (fault === 'invalid_ok') return send(response, { ok: true });
            if (fault === 'missing') return send(response, { ok: false, error: 'message_not_found' });
            let result: Obj;
            if (method === 'auth.test') result = { ok: true, team_id: identity.teamId, user_id: botId, bot_id: 'BTESTBOT', url: 'https://uier-test.slack.com/' };
            else if (method === 'conversations.list') {
                const offset = Number(String(payload.cursor ?? '0')); const all = [...channels.values()];
                result = { ok: true, channels: all.slice(offset, offset + 2), response_metadata: { next_cursor: offset + 2 < all.length ? String(offset + 2) : '' } };
            } else if (method === 'conversations.info') {
                const channel = channels.get(String(payload.channel));
                if (!channel) return send(response, { ok: false, error: 'channel_not_found' }); result = { ok: true, channel };
            } else if (method === 'chat.postMessage') {
                const channel = channels.get(String(payload.channel));
                if (!channel || channel.is_member !== true || channel.is_archived === true) return send(response, { ok: false, error: 'not_in_channel' });
                if (payload.parse !== 'none' || payload.mrkdwn !== false || payload.unfurl_links !== false || payload.unfurl_media !== false || payload.reply_broadcast !== false)
                    return send(response, { ok: false, error: 'invalid_arguments' });
                const ts = `${Math.floor(Date.now() / 1000)}.${String(++sequence).padStart(6, '0')}`;
                messages.set(`${payload.channel}:${ts}`, { channel: String(payload.channel), ts, owner: botId, payload: structuredClone(payload), threadTs: typeof payload.thread_ts === 'string' ? payload.thread_ts : undefined });
                result = { ok: true, channel: payload.channel, ts, message: { user: botId } };
            } else if (method === 'chat.update' || method === 'chat.delete') {
                const message = messages.get(`${payload.channel}:${payload.ts}`);
                if (!message) return send(response, { ok: false, error: 'message_not_found' });
                if (message.owner !== botId) return send(response, { ok: false, error: method === 'chat.update' ? 'cant_update_message' : 'cant_delete_message' });
                if (method === 'chat.delete') messages.delete(`${payload.channel}:${payload.ts}`);
                else message.payload = structuredClone(payload);
                result = { ok: true, channel: payload.channel, ts: payload.ts };
            } else if (method === 'chat.getPermalink') {
                if (!messages.has(`${payload.channel}:${payload.message_ts}`)) return send(response, { ok: false, error: 'message_not_found' });
                result = { ok: true, permalink: `https://uier-test.slack.com/archives/${payload.channel}/p${String(payload.message_ts).replace('.', '')}` };
            } else return send(response, { ok: false, error: 'unknown_method' }, 404);
            if (fault === 'lost') { response.destroy(); return; }
            send(response, result);
        } catch { send(response, { ok: false, error: 'stub_error' }, 500); }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No stub address');
    url = `http://127.0.0.1:${address.port}`;
    return { url, appId, teamId, botId, channelId, secondChannelId, privateChannelId, channels, messages, calls,
        get refreshCalls() { return refreshCalls; },
        get oauthCalls() { return oauthCalls; },
        code(options: CodeOptions = {}) { const code = randomUUID(); codes.set(code, options); return code; },
        fault(method: string, fault: SlackStubFault, retryAfter = '2') {
            const pending = faults.get(method) ?? []; pending.push(fault); faults.set(method, pending);
            if (fault === 'rate') { const delays = rateDelays.get(method) ?? []; delays.push(retryAfter); rateDelays.set(method, delays); }
        },
        loseNextRefresh() { loseRefresh = true; },
        human(channel: string, ts: string) { messages.set(`${channel}:${ts}`, { channel, ts, owner: 'UHUMAN', payload: { text: 'Human reply' } }); },
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
export type SlackStub = Awaited<ReturnType<typeof startSlackStub>>;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local Slack stub PORT');
    const stub = await startSlackStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
