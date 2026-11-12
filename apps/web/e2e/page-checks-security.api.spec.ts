import { expect, test } from '@playwright/test';
import { securityHeaderRules, securityAddress, safeHeaderAddress, headerRequestAddress } from '../../../packages/toolbar/src/checks/lazy/securityRules';

const rules = (headers: Record<string, string> = {}, protocol = 'https:') => Object.fromEntries(securityHeaderRules(new Headers(headers), protocol).map(rule => [rule.id, rule]));

test('missing policies, browser defaults and HTTP-only HSTS are distinguished from passes', () => {
    const result = rules();
    expect(result.csp).toMatchObject({ state: 'warn', reason: 'cspMissing' });
    expect(result.hsts).toMatchObject({ state: 'warn', reason: 'hstsMissing' });
    expect(result.mime).toMatchObject({ state: 'warn', reason: 'mimeMissing' });
    expect(result.frames).toMatchObject({ state: 'warn', reason: 'frameMissing' });
    expect(result.referrer).toMatchObject({ state: 'none', reason: 'referrerMissing' });
    expect(rules({ 'strict-transport-security': 'max-age=31536000' }, 'http:').hsts?.state).toBe('none');
    expect(rules({ 'content-security-policy-report-only': "default-src 'none'" }).csp?.state).toBe('warn');
});

test('HSTS and MIME headers validate values, not just presence', () => {
    for (const value of ['max-age=0', 'max-age=-1', 'max-age=hello', 'max-age=3600; max-age=0', 'max-age=3600; max-age=invalid', 'max-age=99999999999999999999'])
        expect(rules({ 'strict-transport-security': value }).hsts?.state).toBe('warn');
    for (const value of ['max-age=31536000; includeSubDomains', 'max-age="3600"'])
        expect(rules({ 'strict-transport-security': value }).hsts?.state).toBe('pass');
    expect(rules({ 'x-content-type-options': ' NOSNIFF ' }).mime?.state).toBe('pass');
    expect(rules({ 'x-content-type-options': 'yes' }).mime?.state).toBe('warn');
});

test('CSP observations keep full effectiveness undecided and detect unsafe tokens without exposing nonce values', () => {
    const values = ["script-src 'unsafe-inline'", "script-src 'unsafe-eval'; script-src-elem 'self'", "default-src 'self' 'unsafe-eval'"];
    for (const value of values) expect(rules({ 'content-security-policy': value }).csp?.reason).toBe('cspWeak');
    expect(rules({ 'content-security-policy': "script-src 'nonce-private-nonce-347' 'unsafe-inline' 'strict-dynamic'" }).csp?.reason).toBe('cspReview');
    expect(rules({ 'content-security-policy': "script-src 'self'; script-src 'unsafe-inline'" }).csp?.reason).toBe('cspReview');
    const serialized = JSON.stringify(rules({ 'content-security-policy': "script-src 'nonce-private-nonce-347' https://secret.example/?token=private" }));
    expect(serialized).not.toMatch(/private-nonce|secret.example|token/);
});

test('frame-ancestors precedence, multiple policies and oversized/unknown policies stay conservative', () => {
    expect(rules({ 'x-frame-options': 'sameorigin' }).frames?.state).toBe('pass');
    expect(rules({ 'x-frame-options': 'ALLOW-FROM https://site.example' }).frames?.state).toBe('warn');
    expect(rules({ 'content-security-policy': "frame-ancestors 'none'" }).frames?.state).toBe('pass');
    expect(rules({ 'content-security-policy': "frame-ancestors 'self' https://embed.example" }).frames?.state).toBe('pass');
    expect(rules({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }).frames).toMatchObject({ state: 'none', reason: 'frameBroad' });
    expect(rules({ 'content-security-policy': "frame-ancestors 'none' *, frame-ancestors 'self'" }).frames?.state).toBe('pass');
    expect(rules({ 'content-security-policy': "frame-ancestors 'invalid'", 'x-frame-options': 'DENY' }).frames?.state).toBe('none');
    expect(rules({ 'content-security-policy': 'x'.repeat(17000), 'x-frame-options': 'DENY' }).frames?.state).toBe('none');
});

test('referrer policy uses the last recognized token and does not assume absence is a leak', () => {
    expect(rules({ 'referrer-policy': 'unsafe-url, strict-origin-when-cross-origin' }).referrer?.state).toBe('pass');
    expect(rules({ 'referrer-policy': 'strict-origin, unsafe-url' }).referrer?.state).toBe('warn');
    expect(rules({ 'referrer-policy': 'made-up-policy' }).referrer?.reason).toBe('referrerInvalid');
    expect(rules({ 'referrer-policy': 'no-referrer-when-downgrade' }).referrer?.state).toBe('warn');
});

test('header checks never replay action or credential-bearing URLs and displayed addresses omit secrets', () => {
    for (const path of ['/logout', '/%6cogout', '/%256cogout', '/confirm', '/page?token=secret', '/page?code=secret', '/page?sig=secret', '/page?%74oken=secret'])
        expect(safeHeaderAddress(new URL(path, 'https://site.example'))).toBe(false);
    expect(safeHeaderAddress(new URL('https://user:password@site.example/page'))).toBe(false);
    expect(safeHeaderAddress(new URL('https://site.example/page?q=pricing'))).toBe(true);
    expect(headerRequestAddress(new URL('https://site.example/page?toolbar-code=public&uier-token=private&uier-comment=id&review=true&q=pricing#private'))?.href).toBe('https://site.example/page?q=pricing');
    expect(headerRequestAddress(new URL('https://site.example/page?token=private&toolbar-code=public'))).toBeUndefined();
    expect(headerRequestAddress(new URL('https://site.example/page?q=a%20b&review=true&q=a+b&path=%2f%2F'))?.href).toBe('https://site.example/page?q=a%20b&q=a+b&path=%2f%2F');
    expect(securityAddress('https://user:password@site.example/user@example.test/AbCdEfGh12345678/app.js?token=private#private')).toBe('https://site.example/…/…/app.js');
    expect(securityAddress('data:text/javascript,private-script-source')).toBe('data:');
});
