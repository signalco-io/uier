import { createHash } from 'node:crypto';
import nextConfig from '../next.config';
import { expect, test } from '@playwright/test';
import { reviewSsoCookie, readReviewSsoSession } from '../src/lib/app/reviewSsoCookie';
import { signToken, verifyToken } from '../src/lib/app/tokens';

test('background credentials have a separate purpose and cannot outlive or replace the app login', () => {
    process.env.UIER_LOCAL = '1';
    const app = signToken('session', { uid: 'member' }, 1234);
    const companion = reviewSsoCookie(app)!;
    expect(companion).toMatchObject({ name: '__Secure-uier_review_sso', httpOnly: true, secure: true, sameSite: 'none', path: '/api/review' });
    expect(readReviewSsoSession(companion.value)).toMatchObject({ uid: 'member', exp: verifyToken('session', app)!.exp });
    expect(verifyToken('session', companion.value)).toBeNull();
    expect(readReviewSsoSession(app)).toBeNull();
    for (const invalid of ['invalid', signToken('session', { uid: 'member' }, -1), companion.value])
        expect(reviewSsoCookie(invalid)).toBeUndefined();
    expect(readReviewSsoSession(signToken('review-sso', { uid: 'member' }, -1))).toBeNull();
});

test('only the empty bridges are frameable and background sign-in loads no app resources', async ({ request }) => {
    for (const path of ['/review-session', '/review-verification']) {
        const response = await request.get(path);
        expect(response.headers()['content-security-policy']).toContain('frame-ancestors *');
        expect(response.headers()['x-frame-options']).toBeUndefined();
        expect(response.headers()['permissions-policy']).toBeUndefined();
        expect(response.headers()['cross-origin-opener-policy']).toBeUndefined();
        expect(response.headers()['content-security-policy']!.split(';').find(rule => rule.trim().startsWith('script-src '))).not.toContain("'unsafe-inline'");
        expect(response.headers()['cache-control']).toContain('no-store');
    }
    const bridge = await request.get('/review-session');
    expect(await bridge.text()).not.toMatch(/_next|analytics|localStorage/);
    const script = (await bridge.text()).match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(bridge.headers()['content-security-policy']).toContain(`'sha256-${createHash('sha256').update(script!).digest('base64')}'`);
    for (const path of ['/app/sign-in', '/REVIEW-SESSION', '/Review-Verification', '/review-session/extra']) {
        const response = await request.get(path);
        expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(response.headers()['x-frame-options']).toBe('deny');
        expect(response.headers()['permissions-policy']).toContain('camera=()');
    }
});


test('BotID custom headers keep a complete restrictive same-origin policy', async ({ request }) => {
    const headers = await nextConfig.headers!();
    const bot = headers.find(rule => rule.source.startsWith('/149e9513'))!;
    const csp = bot.headers.find(header => header.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    const response = await request.get('/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/iframe.html?uier-header-fixture=1');
    expect(response.headers()['content-security-policy']).toBe(csp);
    expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
    const prefix = '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3';
    const challenge = await request.get(`${prefix}/a-4-a/c.js?uier-header-fixture=1`);
    expect(challenge.headers()['content-type']).toContain('application/javascript');
    expect(await challenge.text()).toBe('window.__botIdFixture = true;');
    const submission = await request.post(`${prefix}/a-4-a/submit?uier-header-fixture=1`, { data: 'proof-fixture', headers: { 'x-forwarded-host': 'untrusted.example' } });
    expect(await submission.json()).toEqual({ method: 'POST', path: '/v1/proxy/a-4-a/submit', query: '?uier-header-fixture=1', forwardedHost: new URL(submission.url()).host, body: 'proof-fixture' });
    expect(submission.headers()['content-security-policy']).toBe(csp);
});
