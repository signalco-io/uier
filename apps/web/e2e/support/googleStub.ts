import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

// A local stand-in for Google's OpenID Connect endpoints (authorization code with PKCE). Its ID tokens
// carry a placeholder signature: uier takes them straight from the token endpoint and does not check
// signatures (docs/google-sign-in.md), so the stub needs no key.

export type StubGoogleIdentity = { sub?: string; email?: string; email_verified?: boolean | string; hd?: string; name?: string };
export type GoogleStub = Awaited<ReturnType<typeof startGoogleStub>>;
type Grant = { challenge: string; nonce: string; redirectUri: string; identity: StubGoogleIdentity; claims?: Record<string, unknown> };

async function body(request: IncomingMessage) {
    const parts = [];
    for await (const part of request) parts.push(Buffer.from(part));
    return Buffer.concat(parts).toString('utf8');
}
const send = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A Google-like numeric subject, unique per call */
export function googleSubject() {
    return `1${randomInt(10 ** 9, 10 ** 10 - 1)}${randomInt(10 ** 9, 10 ** 10 - 1)}`;
}

export async function startGoogleStub(port = 0, { clientId = 'google-test-client', clientSecret = 'google-test-secret' } = {}) {
    const flows = new Map<string, { redirectUri: string; state: string; challenge: string; nonce: string }>();
    const codes = new Map<string, Grant>();
    const tokenCalls: { code: string; status: number }[] = [];
    let url = '';

    function idToken(grant: Grant) {
        const now = Math.floor(Date.now() / 1000);
        const { identity } = grant;
        return [base64url({ alg: 'RS256', kid: 'google-stub', typ: 'JWT' }), base64url({
            iss: url, azp: clientId, aud: clientId, sub: identity.sub ?? googleSubject(), email: identity.email,
            email_verified: identity.email_verified ?? true, ...(identity.hd ? { hd: identity.hd } : {}),
            ...(identity.name ? { name: identity.name } : {}), nonce: grant.nonce, iat: now, exp: now + 3600, ...grant.claims
        }), Buffer.from('google-stub-signature').toString('base64url')].join('.');
    }

    function validRedirect(value: string | null) {
        try {
            const redirect = new URL(value ?? '');
            return ['http:', 'https:'].includes(redirect.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
                && redirect.pathname === '/app/sign-in/google/callback' && !redirect.username && !redirect.password && !redirect.hash && !redirect.search;
        } catch { return false; }
    }

    const server = createServer(async (request, response) => {
        try {
            const target = new URL(request.url!, url || 'http://127.0.0.1');
            if (target.pathname === '/') return send(response, { ready: true });
            if (target.pathname === '/o/oauth2/v2/auth' && request.method === 'GET') {
                const params = target.searchParams;
                const challenge = params.get('code_challenge') ?? '';
                if (params.get('client_id') !== clientId || !validRedirect(params.get('redirect_uri')) || params.get('response_type') !== 'code'
                    || params.get('scope') !== 'openid email profile' || params.get('code_challenge_method') !== 'S256'
                    || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !params.get('state') || !params.get('nonce'))
                    return send(response, { error: 'invalid_request' }, 400);
                const flow = randomUUID();
                flows.set(flow, { redirectUri: params.get('redirect_uri')!, state: params.get('state')!, challenge, nonce: params.get('nonce')! });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return response.end(`<!doctype html><html lang="en"><head><title>Google test sign-in</title></head><body><main>
<h1>Choose a Google test account</h1><p>This local stand-in signs in to uier with the account below.</p>
<form method="post" action="/decision"><input type="hidden" name="flow" value="${escape(flow)}">
<p><label>Subject <input name="sub" value="${googleSubject()}"></label></p>
<p><label>Email <input name="email" type="email"></label></p>
<p><label><input name="email_verified" type="checkbox" value="true" checked> Email verified</label></p>
<p><label>Hosted domain <input name="hd"></label></p>
<p><label>Name <input name="name"></label></p>
<button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Cancel</button>
</form></main></body></html>`);
            }
            if (target.pathname === '/decision' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request));
                const flowId = params.get('flow') ?? '';
                const flow = flows.get(flowId);
                flows.delete(flowId);
                if (!flow) return send(response, { error: 'invalid_request' }, 400);
                const redirect = new URL(flow.redirectUri);
                redirect.searchParams.set('state', flow.state);
                if (params.get('decision') === 'allow') {
                    const code = randomUUID();
                    codes.set(code, { challenge: flow.challenge, nonce: flow.nonce, redirectUri: flow.redirectUri, identity: {
                        sub: params.get('sub') || undefined, email: params.get('email') || undefined,
                        email_verified: params.get('email_verified') === 'true', hd: params.get('hd') || undefined, name: params.get('name') || undefined
                    } });
                    redirect.searchParams.set('code', code);
                    redirect.searchParams.set('scope', 'openid email profile');
                } else redirect.searchParams.set('error', 'access_denied');
                response.writeHead(303, { Location: redirect.href, 'Cache-Control': 'no-store' });
                return response.end();
            }
            if (target.pathname === '/token' && request.method === 'POST') {
                const params = new URLSearchParams(await body(request));
                const code = params.get('code') ?? '';
                const reject = (status: number, error: string) => { tokenCalls.push({ code, status }); return send(response, { error }, status); };
                if (params.get('client_id') !== clientId || params.get('client_secret') !== clientSecret) return reject(401, 'invalid_client');
                if (params.get('grant_type') !== 'authorization_code') return reject(400, 'unsupported_grant_type');
                // Codes work once, as Google's do
                const grant = codes.get(code);
                codes.delete(code);
                if (!grant || params.get('redirect_uri') !== grant.redirectUri
                    || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== grant.challenge)
                    return reject(400, 'invalid_grant');
                tokenCalls.push({ code, status: 200 });
                return send(response, { access_token: `google-test-access-${randomUUID()}`, expires_in: 3599, token_type: 'Bearer',
                    scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', id_token: idToken(grant) });
            }
            return send(response, { error: 'not_found' }, 404);
        } catch { send(response, { error: 'stub_error' }, 500); }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Stub address unavailable');
    url = `http://127.0.0.1:${address.port}`;

    return {
        url, clientId, clientSecret, tokenCalls,
        /** Approves the authorization request at `authorizeUrl` as `identity`, like the consent screen; `claims` override ID token claims */
        approve(authorizeUrl: string, identity: StubGoogleIdentity, claims?: Record<string, unknown>) {
            const params = new URL(authorizeUrl).searchParams;
            const code = randomUUID();
            codes.set(code, { challenge: params.get('code_challenge') ?? '', nonce: params.get('nonce') ?? '',
                redirectUri: params.get('redirect_uri') ?? '', identity, claims });
            return { code, state: params.get('state') ?? '' };
        },
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local Google stub PORT');
    const stub = await startGoogleStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
