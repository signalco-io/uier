import { expect, test } from '@playwright/test';
import { keyedHash } from '../src/lib/comments/environment';
import { getAppStore } from '../src/lib/app/store';
import type { DbSignInRequest } from '../src/lib/app/model';
import { confirmSignIn, confirmSignInCode, getSignInRequest, safeNextPath, SIGN_IN_LINK_TTL_SECONDS } from '../src/lib/app/signIn';
import { boundSignInRequestId, signInRequestToken } from '../src/lib/app/signInCookie';
import { randomToken, sha256Hex, signToken } from '../src/lib/app/tokens';
import { signInEmail } from '../src/lib/email/templates';

const originalLocal = process.env.UIER_LOCAL;
test('sign-in return paths stay under app after URL normalization and reject encoded traversal and controls', () => {
    for (const path of ['/app', '/app/', '/app/account', '/app?tab=all', '/app/projects/a?filter=open%20now'])
        expect(safeNextPath(path)).toBe(path);
    expect(safeNextPath('/app/account?tab=profile#details')).toBe('/app/account?tab=profile');
    for (const path of [null, 123, {}, '', '/', '/application', '/app2', '//evil.example/app', 'https://evil.example/app',
        '/app/../outside', '/app/./account', '/app/%2e%2e/outside', '/app/.%2E/outside', '/app/%2E./outside', '/app/%2e/account',
        '/app/%2f../outside', '/app\\outside', '/app/%5coutside', '/app/\naccount', '/app/%0daccount', '/app?x=%09value',
        '/app/%3f/../account', '/app/%23/%2e/account', '/app/projects/.. ',
        '/app?x=\u0000', '/app/%', '/app/' + 'a'.repeat(2048)])
        expect(safeNextPath(path), String(path)).toBeUndefined();
});

test('confirmation revalidates return paths saved before the current redirect rules', async () => {
    const request = await pending();
    const stored = (await getAppStore().get<DbSignInRequest>(request.doc.pk, request.doc.id))!;
    await getAppStore().replace({ ...stored.doc, next: '/app/../outside' }, stored.etag);
    expect(await confirmSignIn(request.token)).toMatchObject({ next: undefined });
});
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = originalLocal;
});

async function pending({ createdAt = new Date().toISOString(), code = '01234567', legacy = false } = {}) {
    const token = randomToken();
    const requestId = sha256Hex(token);
    const doc: DbSignInRequest = {
        type: 'sign-in', id: requestId, pk: `sign-in:${requestId}`,
        email: `${requestId}@example.com`, createdAt, ttl: SIGN_IN_LINK_TTL_SECONDS,
        next: '/app/account',
        ...(legacy ? {} : { codeHash: keyedHash('sign-in-code', `${requestId}:${code}`) })
    };
    await getAppStore().create(doc);
    return { doc, token, code, requestId, binding: signInRequestToken(requestId, SIGN_IN_LINK_TTL_SECONDS) };
}

test('the fifth attempt may succeed after four wrong guesses, including leading zeroes', async () => {
    const request = await pending();
    for (let attempt = 0; attempt < 4; attempt++)
        expect(await confirmSignInCode(request.requestId, '99999999', request.binding)).toBeNull();
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toMatchObject({ next: '/app/account' });
    expect(await confirmSignIn(request.token)).toBeNull();
});

test('the fifth wrong guess invalidates both paths, even before a subsequent submit', async () => {
    const request = await pending();
    for (let attempt = 0; attempt < 5; attempt++)
        expect(await confirmSignInCode(request.requestId, '99999999', request.binding)).toBeNull();
    expect(await getSignInRequest(request.token)).toBeNull();
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toBeNull();
});

test('parallel wrong guesses use the shared atomic budget and invalidate the request', async () => {
    const request = await pending();
    const results = await Promise.all(Array.from({ length: 20 }, () =>
        confirmSignInCode(request.requestId, '99999999', request.binding)));
    expect(results.every(result => result === null)).toBe(true);
    expect(await getSignInRequest(request.token)).toBeNull();
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toBeNull();
});

test('a parallel burst cannot compare a correct candidate beyond the five reserved attempts', async () => {
    const request = await pending();
    // All calls begin together, before any one has consumed the request.
    const results = await Promise.all([
        ...Array.from({ length: 5 }, () => confirmSignInCode(request.requestId, '99999999', request.binding)),
        confirmSignInCode(request.requestId, request.code, request.binding)
    ]);
    expect(results.every(result => result === null)).toBe(true);
    expect(await confirmSignIn(request.token)).toBeNull();
});

test('concurrent correct codes and links have exactly one winner', async () => {
    const request = await pending();
    const results = await Promise.all([
        confirmSignIn(request.token),
        ...Array.from({ length: 4 }, () => confirmSignInCode(request.requestId, request.code, request.binding)),
        confirmSignIn(request.token)
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getSignInRequest(request.token)).toBeNull();
});

test('missing, forged, wrong-purpose and other-request bindings spend none of the original budget', async () => {
    const request = await pending();
    const other = await pending();
    for (const binding of [undefined, `${request.binding}x`, other.binding, signToken('session', { requestId: request.requestId }, 900)]) {
        for (let attempt = 0; attempt < 6; attempt++)
            expect(await confirmSignInCode(request.requestId, request.code, binding)).toBeNull();
    }
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).not.toBeNull();
});

test('the guess budget cannot reset at a wall-clock boundary within the request lifetime', async () => {
    const now = Date.now;
    const boundary = Math.ceil(now() / 900_000) * 900_000;
    try {
        Date.now = () => boundary - 1000;
        const request = await pending({ createdAt: new Date(Date.now()).toISOString() });
        for (let attempt = 0; attempt < 4; attempt++)
            expect(await confirmSignInCode(request.requestId, '99999999', request.binding)).toBeNull();
        Date.now = () => boundary + 1000;
        expect(await confirmSignInCode(request.requestId, '99999999', request.binding)).toBeNull();
        expect(await confirmSignIn(request.token)).toBeNull();
    } finally { Date.now = now; }
});

test('both paths expire after 15 minutes even if database TTL deletion has not happened', async () => {
    const request = await pending({ createdAt: new Date(Date.now() - 900_001).toISOString() });
    expect(await getAppStore().get(request.doc.pk, request.doc.id)).not.toBeNull();
    expect(await confirmSignIn(request.token)).toBeNull();
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toBeNull();
    expect(boundSignInRequestId(signInRequestToken(request.requestId, 0))).toBeNull();
});

test('older link-only requests still sign in through the link', async () => {
    const request = await pending({ legacy: true });
    expect(await confirmSignInCode(request.requestId, request.code, request.binding)).toBeNull();
    expect(await confirmSignIn(request.token)).not.toBeNull();
});

test('email contains the code and safety copy in both bodies, with credentials out of the subject and URLs', () => {
    const code = '01234567';
    const url = 'https://uier.io/app/sign-in/confirm?token=link-token';
    const message = signInEmail({ to: 'person@example.com', url, code });
    for (const body of [message.text, message.html]) {
        expect(body).toContain(code);
        expect(body).toContain('Never share this code.');
        expect(body).toContain('only in the browser where you asked');
        expect(body).toContain('15 minutes');
        expect(body).toContain(url);
    }
    expect(message.subject).toBe('Sign in to uier');
    expect(message.html.match(/href="[^"]*"/g)?.every(href => !href.includes(code))).toBe(true);
});
