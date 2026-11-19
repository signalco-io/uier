import assert from 'node:assert/strict';
import { test } from 'node:test';
import project from '../vercel-project.json' with { type: 'json' };
import { configureHtml, setMailEnvironment, verifyMailOrigin } from './vercel.mjs';

const { orgId, projectId } = project;
const preview = 'https://uier-proof-preview-signalco.vercel.app';
const production = 'https://uier-proof-production-signalco.vercel.app';
const custom = 'https://artifacts.example.net';
const build = 'https://uier-built-preview-signalco.vercel.app';
const wanted = { id: 'dpl_Wanted', url: new URL(build).hostname, readyState: 'READY', ownerId: orgId, projectId, target: null };
const old = { ...wanted, id: 'dpl_Old', url: 'uier-old-preview-signalco.vercel.app' };
const binding = (url, deployment = wanted) => ({ alias: new URL(url).hostname, deploymentId: deployment.id, projectId });
const absent = () => Response.json({ error: { code: 'not_found' } }, { status: 404 });

function fixture(t, { current, prior = old, next = wanted, domains = [], status = 404, settings = {}, resolvedHost = next.url, assignment, published } = {}) {
    const env = {
        VERCEL_TOKEN: 'fixture-api-token',
        UIER_PROOF_VERCEL_BYPASS: '',
        UIER_PROOF_DEPLOYMENT: build,
        UIER_PROOF_APP_ORIGIN: '',
        UIER_PROOF_HTML_ORIGIN_PREVIEW: preview,
        UIER_PROOF_HTML_ORIGIN_PRODUCTION: production,
        ...settings
    };
    for (const [name, value] of Object.entries(env)) {
        const previous = process.env[name];
        t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
        process.env[name] = value;
    }
    const writes = [];
    const probes = [];
    t.mock.method(globalThis, 'fetch', async (input, options) => {
        const url = new URL(input);
        const headers = new Headers(options.headers);
        if (url.hostname !== 'api.vercel.com') {
            assert.equal(headers.get('authorization'), null);
            assert.equal(options.redirect, 'manual');
            assert.equal(url.pathname, '/');
            probes.push({ host: url.origin, bypass: headers.get('x-vercel-protection-bypass') });
            return typeof status === 'function' ? status(probes.at(-1)) : new Response(null, { status });
        }
        assert.equal(url.searchParams.get('teamId'), orgId);
        assert.equal(headers.get('authorization'), 'Bearer fixture-api-token');
        assert.equal(headers.get('x-vercel-protection-bypass'), null);
        assert.equal(options.redirect, 'error');
        if (url.pathname === '/v13/deployments/' + resolvedHost || url.pathname === '/v13/deployments/' + next.id)
            return Response.json(next);
        if (url.pathname === '/v13/deployments/' + prior.id) return Response.json(prior);
        if (url.pathname === '/v9/projects/' + projectId + '/domains')
            return Response.json({ domains: domains.map(domain => typeof domain === 'string' ? { name: domain } : domain), pagination: { next: null } });
        if (url.pathname === '/v4/aliases/uier.io' && published)
            return Response.json(binding('https://uier.io', published));
        if (url.pathname.startsWith('/v4/aliases/')) {
            assert.equal(url.searchParams.has('projectId'), false);
            return current instanceof Response ? current : current ? Response.json(current) : absent();
        }
        if (url.pathname === '/v2/deployments/' + next.id + '/aliases') {
            assert.equal(options.method, 'POST');
            const { alias } = JSON.parse(options.body);
            writes.push(alias);
            if (assignment) return assignment;
            const oldDeploymentId = current?.deploymentId;
            current = { alias, deploymentId: next.id, projectId };
            return Response.json({ alias, oldDeploymentId });
        }
        assert.fail('Unexpected fetch ' + url.pathname);
    });
    return { writes, probes };
}

test('assigns the dedicated preview hostname and repeats without a write, using bypass only after 401', async t => {
    const { writes, probes } = fixture(t, {
        settings: { UIER_PROOF_VERCEL_BYPASS: 'fixture-bypass' },
        status: ({ bypass }) => new Response(null, { status: bypass ? 404 : 401 })
    });
    await configureHtml('preview');
    await configureHtml('preview');
    assert.deepEqual(writes, [new URL(preview).hostname]);
    assert.deepEqual(probes, [
        { host: preview, bypass: null }, { host: preview, bypass: 'fixture-bypass' },
        { host: preview, bypass: null }, { host: preview, bypass: 'fixture-bypass' }
    ]);
});

test('accepts an empty alias 404, then verifies the binding and repeats without writing', async t => {
    const { writes } = fixture(t, { current: new Response(null, { status: 404 }) });
    await configureHtml('preview');
    await configureHtml('preview');
    assert.deepEqual(writes, [new URL(preview).hostname]);
});

test('an empty 404 still requires provider authorization to claim the hostname', async t => {
    const { writes, probes } = fixture(t, {
        current: new Response(null, { status: 404 }),
        assignment: Response.json({ error: { code: 'alias_in_use' } }, { status: 403 })
    });
    await assert.rejects(configureHtml('preview'), /Vercel rejected.*HTTP 403/);
    assert.deepEqual(writes, [new URL(preview).hostname]);
    assert.deepEqual(probes, []);
});

test('allows the dedicated production hostname on production and a verified same-target move', async t => {
    const next = { ...wanted, target: 'production' };
    const prior = { ...old, target: 'production' };
    const { writes } = fixture(t, { next, prior, current: binding(production, prior) });
    await configureHtml('production');
    assert.deepEqual(writes, [new URL(production).hostname]);
});

test('refreshes the production proof alias only for the deployment serving uier.io', async t => {
    const next = { ...wanted, target: 'production' };
    const prior = { ...old, target: 'production' };
    for (const [name, published] of [['current release', next], ['superseded release', prior]]) {
        await t.test(name, async t => {
            const { writes } = fixture(t, { next, prior, current: binding(production, prior), published });
            if (published === next) {
                await configureHtml('production', { requirePublished: true });
                assert.deepEqual(writes, [new URL(production).hostname]);
            } else {
                await assert.rejects(configureHtml('production', { requirePublished: true }), /current uier.io production binding/);
                assert.deepEqual(writes, []);
            }
        });
    }
});

test('accepts an isolated custom domain and never sends its host the bypass secret', async t => {
    const { writes, probes } = fixture(t, {
        settings: { UIER_PROOF_HTML_ORIGIN_PREVIEW: custom, UIER_PROOF_VERCEL_BYPASS: 'fixture-bypass' },
        status: 401
    });
    const warn = t.mock.method(console, 'warn');
    await configureHtml('preview');
    assert.deepEqual(writes, [new URL(custom).hostname]);
    assert.deepEqual(probes, [{ host: custom, bypass: null }]);
    assert.match(warn.mock.calls[0].arguments[0], /Complete.*authenticated/);
});

test('rejects an ordinary app root or a Vercel platform 404', async t => {
    for (const [label, status] of [
        ['existing custom site', () => new Response(null, { status: 200 })],
        ['platform error', () => new Response(null, { status: 404, headers: { 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' } })]
    ]) {
        await t.test(label, async t => {
            const { writes } = fixture(t, { current: binding(custom, old), settings: { UIER_PROOF_HTML_ORIGIN_PREVIEW: custom }, status });
            await assert.rejects(configureHtml('preview'), /reject its root/);
            assert.deepEqual(writes, []);
        });
    }
});

test('refuses the other target hostname, ordinary app hosts, and registered wildcard domains', async t => {
    for (const host of [production, 'https://uier-signalco.vercel.app', 'https://uier.io', 'https://app.uier.io', custom]) {
        await t.test(host, async t => {
            const { writes } = fixture(t, { domains: ['*.example.net'], settings: { UIER_PROOF_HTML_ORIGIN_PREVIEW: host } });
            await assert.rejects(configureHtml('preview'), /dedicated proof hostname|app domain/);
            assert.deepEqual(writes, []);
        });
    }
});

test('refuses a custom hostname that shares an app domain apex', async t => {
    const { writes } = fixture(t, {
        domains: [{ name: 'app.example.net', apexName: 'example.net' }],
        settings: { UIER_PROOF_HTML_ORIGIN_PREVIEW: custom }
    });
    await assert.rejects(configureHtml('preview'), /shares an app domain/);
    assert.deepEqual(writes, []);
});

test('refuses foreign, redirected, ambiguous or wrong-target aliases before any write', async t => {
    for (const [label, current, prior] of [
        ['unrelated project', { ...binding(preview), projectId: 'prj_Foreign' }],
        ['unrelated team', { ...binding(preview), teamId: 'team_Foreign' }],
        ['different deployment owner', binding(preview, old), { ...old, ownerId: 'team_Foreign' }],
        ['contradictory deployment owner', binding(preview, old), { ...old, ownerId: 'team_Foreign', team: { id: orgId } }],
        ['different deployment target', binding(preview, old), { ...old, target: 'production' }],
        ['redirect', { ...binding(preview), redirect: 'uier.io' }],
        ['unknown 404', Response.json({ error: { code: 'team_not_found' } }, { status: 404 })],
        ['malformed 404', new Response('<html>error</html>', { status: 404 })],
        ['empty forbidden alias', new Response(null, { status: 403 })],
        ['empty provider failure', new Response(null, { status: 500 })],
        ['forbidden alias', Response.json({ error: { code: 'forbidden' } }, { status: 403 })]
    ]) {
        await t.test(label, async t => {
            const { writes } = fixture(t, { current, prior });
            await assert.rejects(configureHtml('preview'), /unrelated Vercel alias|requested target|Vercel rejected/);
            assert.deepEqual(writes, []);
        });
    }
});

test('proof mail accepts the exact preview deployment or the verified production binding', async t => {
    await t.test('preview', async t => {
        fixture(t, { settings: { UIER_PROOF_APP_ORIGIN: build } });
        assert.equal(await verifyMailOrigin('preview'), build);
    });
    await t.test('production', async t => {
        const next = { ...wanted, target: 'production' };
        fixture(t, { next, current: binding('https://uier.io', next), settings: { UIER_PROOF_APP_ORIGIN: 'https://uier.io' } });
        assert.equal(await verifyMailOrigin('production'), 'https://uier.io');
    });
});

test('proof mail refuses arbitrary, isolated, noncanonical and wrong-target destinations', async t => {
    for (const [name, url, next] of [
        ['arbitrary custom hostname', 'https://external.example.net', wanted],
        ['dedicated proof hostname', preview, wanted],
        ['ordinary production hostname for preview', 'https://uier.io', wanted],
        ['mutable preview alias', 'https://uier-branch-signalco.vercel.app', wanted],
        ['production build', build, { ...wanted, target: 'production' }],
        ['staging build', build, { ...wanted, target: 'staging' }],
        ['custom environment', build, { ...wanted, customEnvironment: { id: 'env_Staging' } }],
        ['foreign project', build, { ...wanted, projectId: 'prj_Foreign' }]
    ]) {
        await t.test(name, async t => {
            const { writes, probes } = fixture(t, { next, resolvedHost: new URL(url).hostname, settings: { UIER_PROOF_APP_ORIGIN: url } });
            await assert.rejects(verifyMailOrigin('preview'));
            assert.deepEqual(writes, []);
            assert.deepEqual(probes, []);
        });
    }
});

test('mail variables are scoped to the selected target and provider errors do not expose the bearer', async t => {
    fixture(t);
    const secret = 'fixture-relay-secret';
    const seen = [];
    globalThis.fetch.mock.mockImplementation(async (input, options) => {
        const url = new URL(input);
        assert.equal(url.pathname, '/v10/projects/' + projectId + '/env');
        assert.equal(url.searchParams.get('teamId'), orgId);
        assert.equal(url.searchParams.get('upsert'), 'true');
        const { key, type, target, value } = JSON.parse(options.body);
        seen.push({ key, type, target });
        if (type === 'sensitive') {
            assert.equal(value, secret);
            return Response.json({ failed: [{ error: { message: secret } }] }, { status: 201 });
        }
        return Response.json({ created: { key, type, target }, failed: [] }, { status: 201 });
    });
    await assert.rejects(setMailEnvironment('preview', 'proof@example.net', secret), error =>
        /did not confirm/.test(error.message) && !error.message.includes(secret));
    assert.deepEqual(seen, [
        { key: 'UIER_PROOF_EMAIL_ALIAS', type: 'encrypted', target: ['preview'] },
        { key: 'UIER_PROOF_EMAIL_SECRET', type: 'sensitive', target: ['preview'] }
    ]);
});
