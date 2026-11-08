import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

// Local Microsoft OIDC stand-in with real RS256 signatures and tenant-scoped JWKS.
export const microsoftTenant = '11111111-2222-3333-4444-555555555555';
/** A small blue PNG (48 × 32) the stand-in hands out as a profile picture */
export const stubPicturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8eIRrxYH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1wfNGXB53KQxUAAAAABJRU5ErkJggg==', 'base64');
/** `photo`: Microsoft Graph has a photo of this person (the stub serves `stubPicturePng` for its access token) */
export type StubMicrosoftIdentity = { sub?: string; email?: string; preferred_username?: string; name?: string; photo?: boolean };
export type MicrosoftStub = Awaited<ReturnType<typeof startMicrosoftStub>>;
type Grant = { challenge: string; nonce: string; redirectUri: string; identity: StubMicrosoftIdentity; claims?: Record<string, unknown> };

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

/** A unique pairwise subject for each test identity. */
export function microsoftSubject() { return randomUUID(); }

export async function startMicrosoftStub(port = 0, { clientId = 'microsoft-test-client', clientSecret = 'microsoft-test-secret' } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'microsoft-stub', alg: 'RS256', use: 'sig' };
    const flows = new Map<string, { redirectUri: string; state: string; challenge: string; nonce: string }>();
    const codes = new Map<string, Grant>();
    const tokenCalls: { code: string; status: number }[] = [];
    /** Access tokens the stub issued, and whether Graph has a photo for their person */
    const accessTokens = new Map<string, boolean>();
    const photoCalls: { authorized: boolean }[] = [];
    let url = '';

    async function idToken(grant: Grant) {
        const now = Math.floor(Date.now() / 1000);
        return await issueToken({
            iss: `${url}/${microsoftTenant}/v2.0`, aud: clientId, tid: microsoftTenant, ver: '2.0',
            sub: grant.identity.sub ?? microsoftSubject(), email: grant.identity.email,
            preferred_username: grant.identity.preferred_username, nonce: grant.nonce,
            iat: now, exp: now + 3600, ...grant.claims
        });
    }
    async function issueToken(claims: Record<string, unknown>) {
        return await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'microsoft-stub', typ: 'JWT' }).sign(privateKey);
    }

    function validRedirect(value: string | null) {
        try {
            const redirect = new URL(value ?? '');
            return ['http:', 'https:'].includes(redirect.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
                && redirect.pathname === '/app/sign-in/microsoft/callback' && !redirect.username && !redirect.password && !redirect.hash && !redirect.search;
        } catch { return false; }
    }

    const server = createServer(async (request, response) => {
        try {
            const target = new URL(request.url!, url || 'http://127.0.0.1');
            if (/^\/[0-9a-f-]{36}\/discovery\/v2\.0\/keys$/.test(target.pathname))
                return send(response, { keys: [{ ...jwk, issuer: `${url}/{tenantid}/v2.0` }] });
            if (target.pathname === '/') return send(response, { ready: true });
            // Microsoft Graph's `/me/photo/$value`, for the person of an access token the stub issued
            if (target.pathname === '/v1.0/me/photo/$value' && request.method === 'GET') {
                const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
                const photo = token ? accessTokens.get(token) : undefined;
                photoCalls.push({ authorized: photo !== undefined });
                if (photo === undefined) return send(response, { error: { code: 'InvalidAuthenticationToken' } }, 401);
                if (!photo) return send(response, { error: { code: 'ImageNotFound' } }, 404);
                response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(stubPicturePng.length), 'Cache-Control': 'no-store' });
                return response.end(stubPicturePng);
            }
            if (target.pathname === '/common/oauth2/v2.0/authorize' && request.method === 'GET') {
                const params = target.searchParams;
                const challenge = params.get('code_challenge') ?? '';
                if (params.get('client_id') !== clientId || !validRedirect(params.get('redirect_uri')) || params.get('response_type') !== 'code'
                    || params.get('scope') !== 'openid email profile' || params.get('code_challenge_method') !== 'S256'
                    || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !params.get('state') || !params.get('nonce'))
                    return send(response, { error: 'invalid_request' }, 400);
                const flow = randomUUID();
                flows.set(flow, { redirectUri: params.get('redirect_uri')!, state: params.get('state')!, challenge, nonce: params.get('nonce')! });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return response.end(`<!doctype html><html lang="en"><head><title>Microsoft test sign-in</title></head><body><main>
<h1>Choose a Microsoft test account</h1><p>This local stand-in signs in to uier with the account below.</p>
<form method="post" action="/decision"><input type="hidden" name="flow" value="${escape(flow)}">
<p><label>Subject <input name="sub" value="${microsoftSubject()}"></label></p>
<p><label>Email <input name="email" type="email"></label></p>
<p><label>Name <input name="name"></label></p>
<p><label><input name="photo" type="checkbox" value="true"> Has a photo</label></p>
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
                        name: params.get('name') || undefined, photo: params.get('photo') === 'true'
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
                // Codes work once, as Microsoft's do
                const grant = codes.get(code);
                codes.delete(code);
                if (!grant || params.get('redirect_uri') !== grant.redirectUri
                    || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== grant.challenge)
                    return reject(400, 'invalid_grant');
                tokenCalls.push({ code, status: 200 });
                const accessToken = `microsoft-test-access-${randomUUID()}`;
                accessTokens.set(accessToken, grant.identity.photo === true);
                return send(response, { access_token: accessToken, expires_in: 3599, token_type: 'Bearer',
                    scope: 'openid https://www.microsoftapis.com/auth/userinfo.email https://www.microsoftapis.com/auth/userinfo.profile', id_token: await idToken(grant) });
            }
            return send(response, { error: 'not_found' }, 404);
        } catch { send(response, { error: 'stub_error' }, 500); }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Stub address unavailable');
    url = `http://127.0.0.1:${address.port}`;

    return {
        url, clientId, clientSecret, tokenCalls, issueToken, photoCalls,
        /** Microsoft Graph's photo address on the stub (`MICROSOFT_GRAPH_PHOTO_URL`) */
        photoUrl: `${url}/v1.0/me/photo/$value`,
        /** Approves the authorization request at `authorizeUrl` as `identity`, like the consent screen; `claims` override ID token claims */
        approve(authorizeUrl: string, identity: StubMicrosoftIdentity, claims?: Record<string, unknown>) {
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local Microsoft stub PORT');
    const stub = await startMicrosoftStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
