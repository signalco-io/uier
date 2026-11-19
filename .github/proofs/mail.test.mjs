import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyOrCreateMailRoute } from './cloudflare-mail-route.mjs';
import worker from './mail-worker.mjs';

const address = 'proof-preview@uier.io';
const account = 'a'.repeat(32);
const zone = 'b'.repeat(32);
const ruleId = 'c'.repeat(32);
const match = value => [{ type: 'literal', field: 'to', value }];
const protectedRules = ['contact', 'security', 'privacy'].map((name, index) => ({
    id: String(index + 1).repeat(32), enabled: true, source: 'api', matchers: match(name + '@uier.io'),
    actions: [{ type: 'forward', value: ['operator@example.net'] }]
}));

function routingFixture(t, { rule, enabled = false, owner = account } = {}) {
    const settings = {
        UIER_PROOF_EMAIL_ALIAS: address, CLOUDFLARE_ACCOUNT_ID: account,
        UIER_PROOF_EMAIL_ZONE_ID: zone, CLOUDFLARE_API_TOKEN: 'fixture-cloudflare-token'
    };
    for (const [name, value] of Object.entries(settings)) {
        const previous = process.env[name];
        t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
        process.env[name] = value;
    }
    const writes = [];
    const root = '/client/v4/zones/' + zone;
    const routing = root + '/email/routing';
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const request = new URL(url);
        assert.equal(request.origin, 'https://api.cloudflare.com');
        assert.equal(options.headers.Authorization, 'Bearer fixture-cloudflare-token');
        assert.equal(options.redirect, 'error');
        const { pathname, searchParams } = request;
        const json = (result, extra) => Response.json({ success: true, result, ...extra });
        if (pathname === root) return json({ id: zone, name: 'uier.io', account: { id: owner } });
        if (pathname === routing) return json({ name: 'uier.io', enabled: true, status: 'ready', support_subaddress: true });
        if (pathname === routing + '/rules/catch_all') return json({ enabled, actions: [{ type: 'drop' }] });
        if (pathname === routing + '/rules/' + ruleId) return json(rule);
        assert.equal(pathname, routing + '/rules');
        if (options.method === 'POST') {
            const body = JSON.parse(options.body);
            writes.push(body);
            rule = { ...body, id: ruleId, source: 'api' };
            return json(rule);
        }
        assert.equal(options.method, 'GET');
        assert.equal(searchParams.get('per_page'), '50');
        return searchParams.get('page') === '1'
            ? json(protectedRules, { result_info: { total_pages: 2 } })
            : json(rule ? [rule] : [], { result_info: { total_pages: 2 } });
    });
    return {
        writes,
        lookupMx: async domain => {
            assert.equal(domain, 'uier.io');
            return [{ exchange: 'route1.mx.cloudflare.net' }];
        }
    };
}

test('mail route creates one literal match and repeats with no changes to protected routes', async t => {
    const { writes, lookupMx } = routingFixture(t);
    await verifyOrCreateMailRoute('preview', { lookupMx });
    assert.deepEqual(writes, []);
    await verifyOrCreateMailRoute('preview', { apply: true, lookupMx });
    await verifyOrCreateMailRoute('preview', { apply: true, lookupMx });
    assert.deepEqual(writes, [{
        name: 'uier test proof email (preview)', enabled: true, matchers: match(address),
        actions: [{ type: 'worker', value: ['uier-proof-mail-preview'] }]
    }]);
});

test('mail route refuses a conflicting alias on a later page, enabled catch-all or different account', async t => {
    for (const [name, settings, error] of [
        ['foreign route', { rule: { id: ruleId, enabled: true, source: 'api', matchers: match(address),
            actions: [{ type: 'worker', value: ['uier-proof-mail-production'] }] } }, /different Cloudflare rule/],
        ['catch-all enabled', { enabled: true }, /catch-all must be confirmed disabled/],
        ['different Worker account', { owner: 'd'.repeat(32) }, /configured Cloudflare Worker account/]
    ]) {
        await t.test(name, async t => {
            const { writes, lookupMx } = routingFixture(t, settings);
            await assert.rejects(verifyOrCreateMailRoute('preview', { apply: true, lookupMx }), error);
            assert.deepEqual(writes, []);
        });
    }
});

test('the Worker uses the literal plus envelope and only sends an opted-in bypass', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url: String(url), headers: options.headers, redirect: options.redirect });
        return new Response(null, { status: 200 });
    });
    const env = { UIER_PROOF_EMAIL_ALIAS: address, UIER_PROOF_EMAIL_SECRET: 'fixture-relay-secret',
        UIER_PROOF_APP_ORIGIN: 'https://uier-built-preview-signalco.vercel.app', UIER_PROOF_VERCEL_BYPASS: 'fixture-retained-secret' };
    const reject = t.mock.fn();
    const message = { to: 'proof-preview+' + 'e'.repeat(40) + '@uier.io', rawSize: 10, raw: 'From: test', setReject: reject };
    await worker.email({ ...message, to: address }, env);
    assert.equal(reject.mock.callCount(), 1);
    assert.equal(requests.length, 0);
    await worker.email(message, { ...env, UIER_PROOF_VERCEL_BYPASS_ENABLED: '0' });
    await worker.email(message, { ...env, UIER_PROOF_VERCEL_BYPASS_ENABLED: '1' });
    for (const request of requests) {
        assert.equal(request.url, env.UIER_PROOF_APP_ORIGIN + '/api/proof-mail');
        assert.equal(request.headers.get('authorization'), 'Bearer fixture-relay-secret');
        assert.equal(request.headers.get('x-uier-envelope-to'), message.to);
        assert.equal(request.redirect, 'error');
    }
    assert.equal(requests[0].headers.get('x-vercel-protection-bypass'), null);
    assert.equal(requests[1].headers.get('x-vercel-protection-bypass'), 'fixture-retained-secret');
});
