import { expect, test } from '@playwright/test';
import { reviewSsoCookie, readReviewSsoSession } from '../src/lib/app/reviewSsoCookie';
import { signToken, verifyToken } from '../src/lib/app/tokens';

test('background credentials have a separate purpose and cannot outlive or replace the app login', () => {
    process.env.UIER_LOCAL = '1';
    const app = signToken('session', { uid: 'member' }, 1234);
    const companion = reviewSsoCookie(app)!;
    expect(companion).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', path: '/api/review' });
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
        expect(response.headers()['cache-control']).toContain('no-store');
    }
    const bridge = await request.get('/review-session');
    expect(await bridge.text()).not.toMatch(/_next|analytics|localStorage/);
    const app = await request.get('/app/sign-in');
    expect(app.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(app.headers()['x-frame-options']).toBe('deny');
});
