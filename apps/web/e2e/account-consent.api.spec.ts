import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { uniqueEmail } from './support/app';

const manifest = JSON.parse(readFileSync(new URL('../.next/server/server-reference-manifest.json', import.meta.url), 'utf8')) as {
    node: Record<string, { exportedName?: string }>;
};
function actionId(name: string) {
    const id = Object.entries(manifest.node).find(([, entry]) => entry.exportedName === name)?.[0];
    expect(id, name).toBeTruthy();
    return id!;
}
function actionData<T>(body: string) {
    for (const line of body.split('\n')) {
        let value: { ok?: boolean; data?: T } | null;
        try { value = JSON.parse(line.slice(line.indexOf(':') + 1)) as typeof value; } catch { continue; }
        if (value?.ok === true) return value.data as T;
    }
    throw new Error('The server action did not return a successful result.');
}
async function call(request: APIRequestContext, baseURL: string, path: string, name: string, args: unknown[]) {
    return request.post(path, {
        headers: { 'Next-Action': actionId(name), Origin: baseURL, 'Content-Type': 'text/plain;charset=UTF-8' },
        data: JSON.stringify(args), maxRedirects: 0
    });
}
function formArgs(fields: Record<string, string>) {
    const form = new FormData();
    // Flight's streamed FormData entries must precede the argument that references them.
    for (const [key, value] of Object.entries(fields)) form.append(`_1_${key}`, value);
    form.append('0', '[null,"$K1"]');
    return form;
}
async function signIn(request: APIRequestContext, baseURL: string, label: string) {
    const email = uniqueEmail(label);
    const sent = await request.post('/app/sign-in?add=1', {
        headers: { 'Next-Action': actionId('requestSignInAction'), Origin: baseURL },
        multipart: formArgs({ email }), maxRedirects: 0
    });
    const { requestId, devCode } = actionData<{ requestId: string; devCode: string }>(await sent.text());
    const confirmed = await request.post('/app/sign-in?add=1', {
        headers: { 'Next-Action': actionId('confirmSignInCodeAction'), Origin: baseURL },
        multipart: formArgs({ requestId, code: devCode }), maxRedirects: 0
    });
    expect(confirmed.headers()['x-action-redirect']).toBeTruthy();
    const { userId } = await (await request.get('/api/account/sessions')).json() as { userId: string };
    expect(userId).toMatch(/^u_/);
    return { userId, email };
}
async function switchTo(request: APIRequestContext, baseURL: string, userId: string) {
    const response = await request.post('/api/account/sessions', {
        headers: { Origin: baseURL, 'Sec-Fetch-Site': 'same-origin' }, data: { action: 'switch', userId }
    });
    expect(response.status()).toBe(200);
}
function pkce() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
const changedAccount = 'Your active account changed. Reload this page and try again.';

test('a stale MCP consent tab refuses approval after an account switch without consuming the request', async ({ request, baseURL }) => {
    const a = await signIn(request, baseURL!, 'consent-a');
    const b = await signIn(request, baseURL!, 'consent-b');
    await switchTo(request, baseURL!, a.userId);
    const redirectUri = 'http://127.0.0.1:43123/callback';
    const registration = await request.post('/api/oauth/register', { data: { client_name: 'Stale consent test', redirect_uris: [redirectUri] } });
    expect(registration.status()).toBe(201);
    const { client_id: clientId } = await registration.json();
    const { verifier, challenge } = pkce();
    const authorization = await request.get(`/api/oauth/authorize?${new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
        code_challenge_method: 'S256', scope: 'feedback:read', resource: `${baseURL}/api/mcp`
    })}`, { maxRedirects: 0 });
    const path = new URL(authorization.headers().location!).pathname;
    expect(path).toMatch(/^\/app\/connect\/[A-Za-z0-9_-]{43}$/);
    const requestId = path.split('/').at(-1)!;
    expect(await (await request.get(path)).text()).toContain(a.email);
    await switchTo(request, baseURL!, b.userId);
    const approval = { access: { kind: 'all' }, scopes: ['feedback:read'], name: 'Stale consent test' };
    const stale = await call(request, baseURL!, path, 'approveConnectionAction', [requestId, a.userId, approval]);
    expect(await stale.text()).toContain(changedAccount);
    expect(stale.headers()['x-action-redirect']).toBeUndefined();
    for (const expectedUserId of [undefined, {}, 'invalid']) {
        const malformed = await call(request, baseURL!, path, 'approveConnectionAction', [requestId, expectedUserId, approval]);
        expect(await malformed.text()).toContain('Check the request and try again.');
    }
    // The original request is still available, and can only be approved for the now-visible B.
    expect(await (await request.get(path)).text()).toContain(b.email);
    const fresh = await call(request, baseURL!, path, 'approveConnectionAction', [requestId, b.userId, approval]);
    const { url } = actionData<{ url: string }>(await fresh.text());
    const code = new URL(url).searchParams.get('code');
    expect(code).toBeTruthy();
    const tokens = await request.post('/api/oauth/token', { form: {
        grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: redirectUri,
        code_verifier: verifier, resource: `${baseURL}/api/mcp`
    } });
    expect(tokens.status()).toBe(200);
});

test('a stale extension sign-in page refuses a renewable handoff after an account switch', async ({ request, baseURL }) => {
    const a = await signIn(request, baseURL!, 'extension-a');
    const b = await signIn(request, baseURL!, 'extension-b');
    await switchTo(request, baseURL!, a.userId);
    const clientId = 'abcdefghijklmnopabcdefghijklmnop';
    const { verifier, challenge } = pkce();
    const authorization = { clientId, redirectUri: `https://${clientId}.chromiumapp.org/uier`,
        state: randomBytes(32).toString('base64url'), challenge, renewable: 'true' };
    const path = `/app/extension?${new URLSearchParams(authorization)}`;
    expect(await (await request.get(path)).text()).toContain(a.email.split('@')[0]);
    await switchTo(request, baseURL!, b.userId);
    const stale = await call(request, baseURL!, path, 'approveExtensionAction', [a.userId, authorization]);
    expect(await stale.text()).toContain(changedAccount);
    expect(stale.headers()['x-action-redirect']).toBeUndefined();
    for (const expectedUserId of [undefined, {}, 'invalid']) {
        const malformed = await call(request, baseURL!, path, 'approveExtensionAction', [expectedUserId, authorization]);
        expect(await malformed.text()).toContain('Check the request and try again.');
    }
    expect(await (await request.get(path)).text()).toContain(b.email.split('@')[0]);
    const fresh = await call(request, baseURL!, path, 'approveExtensionAction', [b.userId, authorization]);
    const callback = new URL(fresh.headers()['x-action-redirect']!.split(';')[0]!);
    expect(callback.origin).toBe(new URL(authorization.redirectUri).origin);
    expect(callback.searchParams.get('state')).toBe(authorization.state);
    const exchanged = await request.post('/api/extension/token', { data: {
        clientId, redirectUri: authorization.redirectUri, code: callback.searchParams.get('code'), verifier, renewable: true
    } });
    expect(exchanged.status()).toBe(200);
    const credentials = await exchanged.json();
    // Inspect this local test token's payload to check provenance, without depending on the test worker's signing key.
    const payload = JSON.parse(Buffer.from(credentials.token.split('.')[0], 'base64url').toString()) as { userId: string };
    expect(payload.userId).toBe(b.userId);
    expect(credentials.refreshToken).toBeTruthy();
});
