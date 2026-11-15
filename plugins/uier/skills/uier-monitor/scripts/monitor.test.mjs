import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The scripts announce themselves to the dashboard; keep that out of the person's own ~/.uier-monitor.
process.env.UIER_MONITOR_HOME = mkdtempSync(join(tmpdir(), 'uier-monitor-home-'));
process.on('exit', () => rmSync(process.env.UIER_MONITOR_HOME, { recursive: true, force: true }));

// Exercise the actual standalone script without invoking its CLI or network.
const source = readFileSync(new URL('./monitor.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('import.meta.url', '"file:///monitor.mjs"')
    .split('// Last, so every module-level constant')[0];
function fixture(items, entries) {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map });
    vm.runInContext(source, context);
    context.entries = entries;
    vm.runInContext('allPages = async () => ({ items: entries });', context);
    return { reconcile: context.reconcile, state: { project: { id: 'project' }, items }, seen: {}, found: [] };
}

test('reconcile recovers replies for asked, rejected and ready items, including resolved threads', async () => {
    for (const item of [{ decision: 'asked' }, { decision: 'rejected' }, { decision: 'accepted', stage: 'ready' }]) {
        const entry = { id: 'thread', replyCount: 2, stage: 'open' };
        const f = fixture({ thread: item }, [entry]);
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 0); // migration seeds a baseline
        f.found.length = 0;
        entry.replyCount++;
        entry.resolved = true;
        entry.stage = 'done';
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 1);
        f.found.length = 0;
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 0);
    }
});

test('feed replies deduplicate reconcile and still advance the reply baseline', async () => {
    const entry = { id: 'thread', replyCount: 1 };
    const f = fixture({ thread: { decision: 'asked' } }, [entry]);
    await f.reconcile(null, f.state, f.seen, f.found);
    entry.replyCount++;
    f.found.push({ type: 'reply', commentId: 'thread' });
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.length, 1);
    f.found.length = 0;
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.length, 0);
});

test('skipped, active and untracked resolved threads do not produce reply wakes', async () => {
    const entries = ['skipped', 'active', 'closed'].map(id => ({ id, replyCount: 1, resolved: id === 'closed' }));
    const f = fixture({ skipped: { decision: 'skipped', stage: 'ready' }, active: { decision: 'accepted', stage: 'progress' } }, entries);
    await f.reconcile(null, f.state, f.seen, f.found);
    f.found.length = 0;
    entries.forEach(entry => entry.replyCount++);
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.filter(hit => hit.type === 'reply' || hit.type === 'untracked').length, 0);
});

test('leases forward supplied desktop links, reattach on URL edits/removal, and keep heartbeat identity', async () => {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map });
    vm.runInContext(source, context);
    const calls = [];
    context.tool = async (_ctx, name, args) => { calls.push({ name, args }); return {}; };
    const lease = { items: ['thread'], agent: 'claude', sessionId: 'thread-id', sessionUrl: 't3-thread://v2/local-env/thread-id', state: 'working' };
    const state = { project: { id: 'project' }, groups: { g190: { agentLease: lease } } };
    const seen = {}, found = [];
    const tick = () => context.keepLeases(null, state, seen, found, () => {});
    await tick();
    assert.equal(calls[0].name, 'set_feedback_agent');
    assert.equal(calls[0].args.sessionUrl, lease.sessionUrl);
    assert.equal(calls[1].name, 'set_feedback_agent_working');
    assert.equal(calls[1].args.sessionId, 'thread-id');
    assert.equal('sessionUrl' in calls[1].args, false);
    await tick();
    assert.equal(calls.length, 2);
    lease.sessionUrl = 't3-thread://v2/remote-env/thread-id';
    await tick();
    assert.equal(calls[2].args.sessionUrl, lease.sessionUrl);
    delete lease.sessionUrl;
    await tick();
    assert.equal(calls[4].name, 'set_feedback_agent');
    assert.equal('sessionUrl' in calls[4].args, false);
    lease.state = 'done';
    await tick();
    assert.equal(calls[6].name, 'set_feedback_agent_working');
    assert.equal(calls[6].args.working, false);
    assert.equal(calls[6].args.sessionId, 'thread-id');
    assert.equal(found.length, 0);
});

test('check probes each operation without writing: forbidden means missing, not_found means granted', async () => {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map, RegExp });
    vm.runInContext(source, context);
    const calls = [];
    context.missing = new Set(['feedback:status']);
    context.record = (name, args) => calls.push({ name, args });
    vm.runInContext(`tool = async (ctx, name, args) => {
        record(name, args);
        const scope = { list_assignees: 'feedback:assign', set_feedback_status: 'feedback:status', reply_to_feedback: 'feedback:reply' }[name];
        const error = new Error(missing.has(scope) ? 'This connection needs ' + scope + '.' : 'Not found');
        error.code = missing.has(scope) ? 'forbidden' : name === 'set_feedback_status' ? 'invalid_request' : 'not_found';
        throw error;
    };`, context);
    const scopes = await context.probeScopes(null, 'project');
    assert.deepEqual({ ...scopes }, { assign: true, status: false, reply: true });
    for (const { args } of calls) assert.equal(args.commentId, 'uier-monitor-scope-probe');
    assert.equal('status' in calls.find(entry => entry.name === 'set_feedback_status').args, false);
});

function runtime() {
    let now = Date.parse('2026-11-10T12:00:00Z');
    const files = new Map();
    const output = [];
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const context = vm.createContext({ process: { argv: [], pid: 42, platform: 'linux', on() {} },
        Date: Clock, Set, Map, createHash, URL, AbortSignal, dirname, join: (...parts) => parts.join('/'),
        mkdirSync() {}, rmSync: path => files.delete(path) });
    vm.runInContext(source, context);
    Object.assign(context, {
        readJson: (path, fallback) => files.has(path) ? structuredClone(files.get(path)) : fallback,
        writeJson: (path, value) => files.set(path, structuredClone(value)),
        withLock: async (_dir, _name, action) => action(), stateDir: () => '/state',
        print: value => output.push(structuredClone(value)), watcherPid: () => null, logger: () => () => {},
        connection: () => ({}), keepLeases: async () => {}, pollUier: async () => {},
        pollDeploys() {}, pollPullRequests() {}, wakeUrl: () => 'https://wake.example/secret',
        diskFree: () => null, repoCwd: () => '/repo'
    });
    files.set('/state/state.json', { project: { id: 'project' } });
    return { context, files, output, advance: ms => { now += ms; } };
}

test('reply quotas defer the same key until the full server cooldown, shared across helper connections', async () => {
    const { context, files, advance } = runtime();
    const calls = [];
    context.rpc = async (_ctx, method, params) => {
        calls.push({ method, params: structuredClone(params) });
        return calls.length === 1 ? { isError: true, structuredContent: {
            error: 'rate_limited', reason: 'too_fast', retryAfterSeconds: 900, message: 'Try again later.'
        } } : { structuredContent: { ok: true } };
    };
    const args = { commentId: 'thread', idempotencyKey: 'same-reply', text: 'One reply.' };
    const first = { replyCooldownFile: '/cooldowns/connection.json' };
    await assert.rejects(context.tool(first, 'reply_to_feedback', args), error => error.code === 'rate_limited' && error.retryAfterSeconds === 900);
    assert.deepEqual(Object.keys(files.get(first.replyCooldownFile)), ['replyRetryAt']);
    const resumed = { replyCooldownFile: first.replyCooldownFile };
    advance(899_000);
    await assert.rejects(context.tool(resumed, 'reply_to_feedback', args), error => error.code === 'rate_limited' && error.retryAfterSeconds === 1);
    assert.equal(calls.length, 1);
    // Current reads and status completion do not spend the reply quota.
    await context.tool(resumed, 'get_feedback', { commentId: 'thread' });
    await context.tool(resumed, 'set_feedback_status', { commentId: 'thread', status: 'done' });
    advance(1000);
    await context.tool(resumed, 'reply_to_feedback', args);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[3].params.arguments, calls[0].params.arguments);
});

test('one-off call output preserves the reply deadline for the orchestrator', async () => {
    const { context, output } = runtime();
    context.rpc = async () => ({ isError: true, structuredContent: {
        error: 'rate_limited', retryAfterSeconds: 900, message: 'Try again later.'
    } });
    await context.call({ _: ['reply_to_feedback', JSON.stringify({ commentId: 'thread', text: 'One reply.', idempotencyKey: 'same-reply' })] });
    assert.deepEqual(output, [{ ok: false, tool: 'reply_to_feedback', code: 'rate_limited',
        message: 'Try again later.', retryAfterSeconds: 900 }]);
    assert.equal(context.process.exitCode, 1);
});

test('HTTP 429 propagates its complete Retry-After without sleeping or retrying the write', async () => {
    for (const header of ['1200', 'Tue, 10 Nov 2026 12:20:00 GMT']) {
        const { context } = runtime();
        let requests = 0;
        context.fetch = async () => {
            requests++;
            return { status: 429, headers: { get: () => header } };
        };
        context.sleep = async () => assert.fail('A long quota wait must not block the watcher.');
        await assert.rejects(context.tool({ endpoint: 'https://uier.example/api/mcp', token: 'test-token', id: 0 }, 'reply_to_feedback',
            { idempotencyKey: 'one-reply' }), error => error.code === 'rate_limited' && error.retryAfterSeconds === 1200);
        assert.equal(requests, 1);
    }
});

test('reconciliation follows compact state pages and falls back only for an older schema', async () => {
    for (const schemaError of [null, { code: 'invalid_arguments' }, { rpcCode: -32602 }]) {
        const { context, advance } = runtime();
        const calls = [];
        context.tool = async (_ctx, name, args) => {
            calls.push({ name, args: structuredClone(args) });
            if (schemaError && args.view === 'state') throw Object.assign(new Error('Unsupported arguments'), schemaError);
            return args.cursor === 0 ? { items: [{ id: 'one', replyCount: 0, resolved: true }], nextCursor: 1 }
                : { items: [{ id: 'two', replyCount: 0, resolved: true }], nextCursor: null };
        };
        const state = { project: { id: 'project' }, items: {} }, seen = {};
        await context.reconcile({}, state, seen, []);
        assert.equal(calls[0].args.view, 'state');
        assert.equal(calls[0].args.limit, 1000);
        const pages = calls.filter(call => call.args.cursor === 1);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].args.limit, schemaError ? 25 : 1000);
        calls.length = 0;
        await context.reconcile({}, state, seen, []);
        assert.equal(calls[0].args.view, schemaError ? undefined : 'state');
        if (schemaError) {
            advance(24 * 60 * 60_000);
            calls.length = 0;
            await context.reconcile({}, state, seen, []);
            assert.equal(calls[0].args.view, 'state');
        }
    }
    const { context } = runtime();
    let calls = 0;
    context.tool = async () => { calls++; throw Object.assign(new Error('Token refused'), { code: 'forbidden' }); };
    await assert.rejects(context.reconcile({}, { project: { id: 'project' } }, {}, []), /Token refused/);
    assert.equal(calls, 1);
});

test('legacy SDK text-only validation errors fall back from compact reconciliation', async () => {
    for (const text of [
        'Input validation error: Invalid arguments for tool list_feedback: Unrecognized key: view',
        'Invalid arguments for tool list_feedback: limit must be at most 25'
    ]) {
        const { context } = runtime();
        const calls = [];
        context.rpc = async (_ctx, method, params) => {
            assert.equal(method, 'tools/call');
            calls.push(structuredClone(params.arguments));
            return params.arguments.view === 'state' ? { isError: true, content: [{ type: 'text', text }] }
                : { structuredContent: { items: [], nextCursor: null } };
        };
        const seen = {};
        await context.reconcile({}, { project: { id: 'project' } }, seen, []);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].view, 'state');
        assert.equal(calls[1].view, undefined);
        assert.equal(calls[1].limit, 25);
        assert.ok(seen.stateViewUnsupportedAt);
    }
});

test('event cursors avoid reconciliation between safety checks but truncated events force recovery', async () => {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map });
    vm.runInContext(source, context);
    let reconciliations = 0, truncated = false;
    context.tool = async () => ({ cursor: 'next', items: [], hasMore: false, truncated });
    context.reconcile = async () => { reconciliations++; };
    const seen = { cursor: 'existing', reconciledAt: new Date().toISOString() };
    const state = { project: { id: 'project' } };
    await context.pollUier({}, state, seen, [], 15 * 60_000);
    assert.equal(reconciliations, 0);
    assert.equal(seen.cursor, 'next');
    truncated = true;
    await context.pollUier({}, state, seen, [], 15 * 60_000);
    assert.equal(reconciliations, 1);
    assert.equal(seen.forceReconcile, false);
});

test('packet downloads original and reply images, maps them to messages and keeps failures visible', async () => {
    for (const screenshots of [false, true]) {
        const { context, files, output } = runtime();
        Object.assign(context, { Buffer, resolve: value => value, writeFileSync: (path, content) => files.set(path, content) });
        const original = 'uier://original', denied = 'uier://denied-reply', variant = 'uier://variant';
        context.tool = async () => ({ items: [{ commentId: 'comment_one', context: { identity: { number: 152 } }, markdown: 'Redesign variant',
            screenshotResource: { uri: original }, replyScreenshotResources: [{ itemId: 'item_denied', uri: denied }, { itemId: 'item_variant', uri: variant }] }], remainingIds: [] });
        const reads = [];
        context.rpc = async (_ctx, method, { uri }) => {
            reads.push(uri);
            assert.equal(method, 'resources/read');
            if (uri === denied) throw new Error('Image access denied');
            return { contents: [{ mimeType: uri === original ? 'image/png' : 'image/webp', blob: Buffer.from(uri).toString('base64') }] };
        };
        await context.packet({ _: ['comment_one'], out: '/briefs', screenshots });
        assert.ok(files.get('/briefs/152.md').includes('Redesign variant'));
        if (screenshots) {
            assert.deepEqual(reads, [original, denied, variant]);
            assert.equal(files.get('/briefs/152.png').toString(), original);
            assert.equal(files.get('/briefs/152-reply-2.webp').toString(), variant);
            assert.deepEqual(output[0].written[0].replyScreenshots, [
                { itemId: 'item_denied', screenshotError: 'Image access denied' },
                { itemId: 'item_variant', screenshot: '/briefs/152-reply-2.webp' }
            ]);
            assert.match(files.get('/briefs/152.md'), /Reply item_variant: \/briefs\/152-reply-2.webp/);
            assert.match(files.get('/briefs/152.md'), /Reply item_denied: image unavailable: Image access denied/);
        } else {
            assert.deepEqual(reads, []);
            assert.equal(output[0].written[0].replyScreenshots, undefined);
        }
    }
});

test('compact context excludes closed history, retains constraints and pending writes, and emits deltas', () => {
    const { context } = runtime();
    const state = { restrictions: { production: 'Do not promote' }, harness: { routing: { ui: { model: 'chosen-model' } } },
        items: { old: { stage: 'done', reason: 'a long historical transcript' },
            blockedWrite: { stage: 'done', writePending: [{ tool: 'reply_to_feedback', args: { body: 'pending' } }] },
            active: { number: 12, stage: 'in-progress', group: 'g12' } },
        groups: { closed: { state: 'closed', items: ['old'] }, g12: { state: 'building', items: ['active'], transcript: 'long history' } },
        prs: { 1: { state: 'merged' }, 2: { state: 'open', group: 'g12', held: true },
            3: { state: 'closed-out' }, 4: { state: 'deployed' }, 5: { state: 'done' } },
        lastRuntimeCheck: { sha: 'full evidence lives on disk' } };
    const first = context.contextPacket(state, []);
    assert.deepEqual(Object.keys(first.packet.items), ['blockedWrite', 'active']);
    assert.deepEqual(Object.keys(first.packet.groups), ['g12']);
    assert.equal('transcript' in first.packet.groups.g12, false);
    assert.deepEqual(Object.keys(first.packet.prs), ['2']);
    assert.equal(first.packet.prs['2'].held, true);
    assert.equal(first.packet.config.restrictions.production, 'Do not promote');
    assert.equal(first.packet.config.harness.routing.ui.model, 'chosen-model');
    assert.ok(first.packet.extraFields.includes('lastRuntimeCheck'));
    const delta = context.contextPacket(state, [], first.baseline);
    assert.equal(Object.keys(delta.packet.items).length, 0);
    assert.equal(Object.keys(delta.packet.groups).length, 0);
    state.items.active.stage = 'done';
    const next = context.contextPacket(state, [], delta.baseline);
    assert.ok(next.packet.removed.items.includes('active'));
    assert.ok(next.packet.removed.groups.includes('g12'));
});

test('context pagination leaves unprinted changes due and detail retrieves exact state', async () => {
    const { context, files, output } = runtime();
    const items = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`id${i}`, { stage: 'open', number: i, custom: 'exact' }]));
    files.set('/state/state.json', { items });
    await context.contextCommand({ take: true });
    assert.equal(Object.keys(output[0].items).length, 25);
    assert.equal(output[0].more.items.length, 5);
    await context.contextCommand({ take: true });
    assert.equal(Object.keys(output[1].items).length, 5);
    assert.equal(output[1].more.items.length, 0);
    context.detail({ _: ['items', 'id29'] });
    assert.equal(output[2].id29.custom, 'exact');
});

test('context writes a recovery receipt before consuming events, and a failed receipt keeps the inbox', async () => {
    const { context, files, output } = runtime();
    const events = [{ type: 'reply', commentId: 'thread', at: 'one' }];
    files.set('/state/inbox.json', events);
    const write = context.writeJson;
    context.writeJson = (path, value) => {
        if (path.endsWith('/inbox.json')) assert.equal(files.get('/state/context.json').packet.events.length, 1);
        write(path, value);
    };
    await context.contextCommand({ take: true });
    assert.equal(output[0].events.length, 1);
    assert.equal(files.get('/state/inbox.json').length, 0);
    await context.contextCommand({});
    assert.equal(output[1].recoverFrom, '/state/context.json');
    assert.equal(files.get('/state/context.json').recovery.events.length, 1);
    files.set('/state/inbox.json', events);
    context.writeJson = () => { throw new Error('disk full'); };
    await assert.rejects(context.contextCommand({ take: true }), /disk full/);
    assert.equal(files.get('/state/inbox.json').length, 1);
});

test('event coalescing preserves distinct replies, transitions and separate deployed PRs', () => {
    const { context } = runtime();
    const reply = { type: 'reply', commentId: 'thread', at: 'one', foundAt: 'first' };
    const events = [reply, { ...reply, foundAt: 'again' }, { ...reply, at: 'two' },
        { type: 'status', commentId: 'thread', change: 'resolved' },
        { type: 'status', commentId: 'thread', change: 'reopened' },
        { type: 'deployed', sha: 'same', pr: 1 }, { type: 'deployed', sha: 'same', pr: 2 }];
    assert.equal(context.coalesceEvents(events).length, 6);
    assert.equal(context.urgentEvents([{ type: 'assignment', commentId: 'thread' }]), true);
    assert.equal(context.urgentEvents([{ type: 'status', change: 'progress_stopped' }]), true);
    assert.equal(context.urgentEvents([reply]), false);
});

test('watch batches adjacent events while renewing leases, and urgent controls bypass the batch', async () => {
    for (const urgent of [false, true]) {
        const { context, files, output, advance } = runtime();
        let polls = 0, renewals = 0;
        context.keepLeases = async () => { renewals++; };
        context.pollUier = async (_ctx, _state, _seen, found) => {
            polls++;
            found.push(urgent ? { type: 'assignment', commentId: 'thread' }
                : { type: 'reply', commentId: 'thread', at: String(polls) });
        };
        context.sleep = async ms => { assert.ok(ms <= 10_000); advance(ms); };
        await context.watch({});
        assert.equal(polls, urgent ? 1 : 2);
        assert.equal(renewals, polls);
        assert.equal(files.get('/state/inbox.json').length, polls);
        assert.equal(output[0].wake.length, polls);
    }
});

test('persistent watching suppresses idle model wakes and keeps a heartbeat', async () => {
    const { context, files, output, advance } = runtime();
    let cycles = 0;
    context.sleep = async ms => {
        advance(ms);
        if (++cycles === 3) files.get('/state/state.json').stopped = true;
    };
    context.fetch = () => { throw new Error('An idle watcher must not notify'); };
    await context.watch({ persistent: true, 'notify-file': '/private/url', 'max-minutes': .001 });
    assert.equal(output.length, 0);
    assert.ok(files.get('/state/watch.json').heartbeatAt);
    assert.equal(files.has('/state/watch.pid'), false);
});

test('webhook delivery retains work, retries one replay key, gates pending wakes and recovers stalled acknowledgement', async () => {
    const { context, files } = runtime();
    const events = [{ type: 'reply', commentId: 'private', foundAt: 'one', body: 'private feedback' }];
    files.set('/state/inbox.json', events);
    const payloads = [];
    let ok = false;
    context.fetch = async (_url, options) => {
        assert.equal(options.redirect, 'error');
        payloads.push(JSON.parse(options.body));
        return { ok, status: ok ? 200 : 503 };
    };
    const deliver = now => context.notifyInbox('/state', { project: { id: 'project' } }, events, '/private/url', now);
    await deliver(1000);
    ok = true;
    await deliver(60_999);
    assert.equal(payloads.length, 1);
    await deliver(61_000);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].batch, payloads[1].batch);
    assert.deepEqual(Object.keys(payloads[0]).sort(), ['batch', 'projectId']);
    assert.equal(JSON.stringify(payloads).includes('private'), false);
    await deliver(122_000);
    assert.equal(payloads.length, 2);
    await deliver(61_000 + 30 * 60_000);
    assert.equal(payloads.length, 3);
    assert.notEqual(payloads[1].batch, payloads[2].batch);
    assert.equal(files.get('/state/inbox.json').length, 1);
    // A drain followed by new work between watcher polls must not wait for the old timeout.
    await context.notifyInbox('/state', { project: { id: 'project' } }, [{ type: 'reply', foundAt: 'new' }], '/private/url', 2_000_000);
    assert.equal(payloads.length, 4);
});

test('wake URL validation rejects insecure or public files without exposing credentials', () => {
    const { context } = runtime();
    vm.runInContext(source.slice(source.indexOf('function wakeUrl('), source.indexOf('// The inbox is acknowledged')), context);
    context.statSync = () => ({ mode: 0o100600, size: 100 });
    context.readFileSync = () => 'https://wake.example/private-bearer-token';
    assert.equal(context.wakeUrl('/private/url'), 'https://wake.example/private-bearer-token');
    for (const value of ['http://wake.example/private-bearer-token', 'https://user:private-bearer-token@wake.example', 'invalid-private-bearer-token']) {
        context.readFileSync = () => value;
        assert.throws(() => context.wakeUrl('/private/url'), error => !error.message.includes('private-bearer-token'));
    }
    context.statSync = () => ({ mode: 0o100644, size: 100 });
    assert.throws(() => context.wakeUrl('/private/url'), /private/);
});

test('local T3 notification queues a bounded constant prompt through stdin without changing provider or model', async () => {
    const { context } = runtime();
    let invocation;
    context.spawnSync = (command, args, options) => { invocation = { command, args, options }; return { status: 0 }; };
    const state = { project: { id: 'project' }, harness: { routing: { model: 'saved-model' } } };
    const target = { thread: 'thread:local%3A1', 't3-cli': '/custom/t3' };
    context.validateWakeTarget(target);
    assert.equal(await context.sendWake('/state', state, 'batch-id', target), true);
    assert.equal(invocation.command, '/custom/t3');
    assert.deepEqual(Array.from(invocation.args), ['thread', 'send', '--json', 'thread:local%3A1', '-']);
    assert.match(invocation.options.input, /context --take/);
    assert.equal(invocation.options.shell, undefined);
    assert.equal(invocation.options.input.includes('saved-model'), false);
    assert.throws(() => context.validateWakeTarget({ thread: '--wait' }), /thread id/);
    assert.throws(() => context.validateWakeTarget({ ...target, 'notify-file': '/private/url' }), /one T3/);
    context.spawnSync = () => ({ status: 1 });
    assert.equal(await context.sendWake('/state', state, 'batch-id', target), false);
});

test('new urgent controls bypass an already delivered but unconsumed notification only once', async () => {
    const { context } = runtime();
    const calls = [];
    context.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; };
    const events = [{ type: 'reply', commentId: 'thread', foundAt: 'one' }];
    const deliver = now => context.notifyInbox('/state', {}, events, '/private/url', now);
    await deliver(1000);
    events.push({ type: 'assignment', commentId: 'thread', foundAt: 'two' });
    await deliver(2000);
    await deliver(3000);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].batch, calls[1].batch);
});

test('repeated unchanged poll failures notify once until the service recovers', async () => {
    const { context, files, advance } = runtime();
    let cycles = 0, wakes = 0;
    context.pollUier = async () => { if (cycles !== 12) throw new Error('service unavailable'); };
    context.fetch = async () => { wakes++; return { ok: true }; };
    context.sleep = async ms => {
        advance(ms); cycles++;
        // Consume each notification so duplicate suppression is tested independently of delivery gating.
        files.set('/state/inbox.json', []);
        if (cycles === 25) files.get('/state/state.json').stopped = true;
    };
    await context.watch({ persistent: true, 'notify-file': '/private/url', 'batch-seconds': 0 });
    assert.equal(wakes, 2);
});

test('options may come before the command, so a shell function can append --state', () => {
    const { context } = runtime();
    const parsed = context.parseArgs(['--state', '/state', 'context', '--take']);
    assert.equal(parsed.command, 'context');
    assert.equal(parsed.opts.state, '/state');
    assert.equal(parsed.opts.take, true);
    const patch = context.parseArgs(['patch', '-', '--state', '/state']);
    assert.deepEqual([patch.command, [...patch.opts._], patch.opts.state], ['patch', ['-'], '/state']);
    const call = context.parseArgs(['--project', 'p1', 'call', 'set_feedback_status', '{"a":1}']);
    assert.deepEqual([call.command, [...call.opts._], call.opts.project], ['call', ['set_feedback_status', '{"a":1}'], 'p1']);
    assert.equal(context.parseArgs([]).command, 'help');
});

// runtime() stubs host polls; put the real ones back where a test exercises them.
function restore(context, ...names) {
    for (const name of names) {
        const start = source.indexOf(`function ${name}(`);
        vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 3), context);
    }
}

function gitlabFixture() {
    const f = runtime();
    restore(f.context, 'pollPullRequests', 'pollDeploys');
    const state = { repo: { provider: 'gitlab', host: 'git.podravka.io', slug: 'team/subgroup/project', base: 'development' },
        harness: { prWatch: true }, workflow: { strict: false, requiredChecks: [], deploy: { kind: 'deployments', environment: 'production/eu' } },
        prs: { 4: { state: 'open', group: 'g4' } }, groups: { g4: { state: 'pr', pr: 4 } }, deploys: { pending: [] } };
    const calls = [], ancestors = new Set();
    const api = { mr: { iid: 4, state: 'opened', sha: 'current-head', detailed_merge_status: 'mergeable',
        head_pipeline: { id: 20, sha: 'current-head', status: 'success' } }, jobs: [], releases: [], parents: [], pipeline: { updated_at: 'first-attempt' } };
    f.context.spawnSync = (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd });
        if (command === 'git') {
            if (args[0] === 'merge-base') return { status: ancestors.has(`${args[2]}..${args[3]}`) ? 0 : 1 };
            if (args[0] === 'branch') return { status: 0, stdout: '' };
            assert.equal(args[0], 'fetch');
            assert.equal(args.at(-1), 'development');
            return { status: 0 };
        }
        assert.equal(command, 'glab', 'GitLab operations must never invoke gh');
        assert.equal(args[0], 'api');
        assert.equal(args[1], '--hostname');
        assert.equal(args[2], 'git.podravka.io');
        const endpoint = args[3];
        assert.ok(endpoint.startsWith('projects/team%2Fsubgroup%2Fproject/'));
        let body;
        if (endpoint.endsWith('/merge_requests/4')) body = api.mr;
        else if (endpoint.includes('/jobs?')) body = api.jobs;
        else if (endpoint.includes('/repository/commits/')) body = { parent_ids: api.parents };
        else if (endpoint.includes('/deployments?') || endpoint.includes('/pipelines?')) body = api.releases;
        else if (/\/pipelines\/\d+$/.test(endpoint)) body = api.pipeline;
        else assert.fail(`Unexpected GitLab endpoint: ${endpoint}`);
        return { status: 0, stdout: args.includes('--paginate') ? body.map(item => JSON.stringify(item)).join('\n') : JSON.stringify(body) };
    };
    return { ...f, state, calls, api, ancestors, seen: {}, found: [], updates: [] };
}

test('GitLab polls ready MRs itself in T3 and trusts remote auto-merge instead of optimistic saved flags', () => {
    const f = gitlabFixture();
    f.state.prs[4].autoMerge = true;
    f.context.pollPullRequests(f.state, f.seen, f.found);
    assert.equal(f.found[0].type, 'pr');
    assert.equal(f.found[0].pr, 4);
    assert.equal(f.found[0].checks, 'success');
    f.context.pollPullRequests(f.state, f.seen, f.found);
    assert.equal(f.found.length, 1);
    for (const flag of ['merge_when_pipeline_succeeds', 'auto_merge_enabled']) {
        f.api.mr[flag] = true;
        const found = [], seen = {};
        f.context.pollPullRequests(f.state, seen, found);
        assert.equal(found.length, 0);
        delete f.api.mr[flag];
        f.context.pollPullRequests(f.state, seen, found);
        assert.equal(found[0].checks, 'success', 'canceling remote auto-merge needs a decision even when the head is unchanged');
    }
});

test('GitLab wakes for CI failures, conflicts, reviews, discussions, required rebases and closed MRs', () => {
    const f = gitlabFixture();
    f.api.mr.merge_when_pipeline_succeeds = true;
    for (const status of ['failed', 'canceled']) {
        f.api.mr.head_pipeline.status = status;
        const found = [];
        f.context.pollPullRequests(f.state, {}, found);
        assert.equal(found[0].checks, 'failure');
    }
    f.api.mr.head_pipeline.status = 'success';
    for (const status of ['conflict', 'requested_changes', 'not_approved', 'discussions_not_resolved', 'need_rebase']) {
        f.api.mr.detailed_merge_status = status;
        const found = [];
        f.context.pollPullRequests(f.state, {}, found);
        assert.equal(found[0].type, 'pr', status);
        if (status === 'conflict') assert.equal(found[0].mergeable, 'CONFLICTING');
        if (status === 'need_rebase') {
            f.state.workflow.strict = true;
            const strictFound = [];
            f.context.pollPullRequests(f.state, {}, strictFound);
            assert.equal(strictFound[0].behind, true);
        }
    }
    f.api.mr.state = 'closed';
    const found = [];
    f.context.pollPullRequests(f.state, {}, found);
    assert.equal(found[0].state, 'closed');
});

test('GitLab never treats absent, stale, manual or skipped head pipelines as passing checks', () => {
    const f = gitlabFixture();
    for (const pipeline of [null, { status: 'success' }, { sha: 'old-head', status: 'success' },
        ...['running', 'manual', 'skipped'].map(status => ({ sha: 'current-head', status }))]) {
        f.api.mr.head_pipeline = pipeline;
        assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    }
    f.api.mr.head_pipeline = { id: 20, sha: 'synthetic-merge', source: 'merge_request_event', status: 'success' };
    f.api.parents = ['target-head', 'old-head'];
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    f.api.parents = ['target-head', 'current-head'];
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'success');
});

test('GitLab reads all required jobs, preserves aggregate pipeline gates and keeps missing jobs pending', () => {
    const f = gitlabFixture();
    f.state.workflow.requiredChecks = ['typecheck', 'browser'];
    f.api.jobs = [{ name: 'typecheck', status: 'success' }, { name: 'browser', status: 'success' }];
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'success');
    assert.ok(f.calls.some(call => call.args.includes('--paginate') && call.args.includes('ndjson')));
    for (const status of ['manual', 'skipped', 'running']) {
        f.api.jobs[1].status = status;
        assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    }
    f.api.jobs.pop();
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    f.api.jobs.push({ name: 'browser', status: 'failed' });
    f.api.mr.head_pipeline.status = 'running';
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'failure');
    f.api.jobs[1].status = 'success';
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    f.api.mr.head_pipeline.status = 'failed';
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'failure');
});

test('GitLab permits a missing pipeline only when explicitly optional and the MR is mergeable', () => {
    const f = gitlabFixture();
    f.api.mr.head_pipeline = null;
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    f.state.workflow.pipelineRequired = false;
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'success');
    f.state.workflow.requiredChecks = ['required-job'];
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
    f.state.workflow.requiredChecks = [];
    f.api.mr.detailed_merge_status = 'checking';
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').checks, 'pending');
});

test('GitLab records merge commits, squash merges and fast-forward merges with their groups', async () => {
    for (const [fields, expected] of [[{ merge_commit_sha: 'merge-sha', squash_commit_sha: 'squash-sha' }, 'merge-sha'],
        [{ squash_commit_sha: 'squash-sha' }, 'squash-sha'], [{}, 'current-head']]) {
        const f = gitlabFixture();
        Object.assign(f.api.mr, fields, { state: 'merged' });
        f.files.set('/state/state.json', structuredClone(f.state));
        f.context.pollPullRequests(f.state, f.seen, f.found, f.updates);
        assert.equal(f.found[0].sha, expected);
        assert.equal(f.found[0].quiet, true);
        await f.context.updateState('/state', f.updates);
        const next = f.files.get('/state/state.json');
        assert.equal(next.prs[4].state, 'merged');
        assert.equal(next.groups.g4.state, 'merged');
        assert.deepEqual(next.deploys.pending.map(entry => [entry.pr, entry.sha, [...entry.groups]]), [[4, expected, ['g4']]]);
    }
});

test('GitLab pending deploys learn their merge SHA or report a closed MR without deploying', () => {
    for (const state of ['merged', 'closed']) {
        const f = gitlabFixture();
        f.state.deploys.pending.push({ pr: 4, groups: ['g4'] });
        Object.assign(f.api.mr, { state, merge_commit_sha: 'merge-sha' });
        assert.equal(f.context.pollDeploys(f.state, f.seen, f.found, f.updates).length, 0);
        assert.equal(f.found[0].type, state === 'merged' ? 'merged' : 'pr-closed');
        for (const update of f.updates) update(f.state);
        assert.equal(f.state.deploys.pending[0].sha, state === 'merged' ? 'merge-sha' : undefined);
    }
});

test('GitLab deployments close only for the configured environment/branch and ancestry containing the merge', () => {
    const f = gitlabFixture();
    f.state.deploys.pending.push({ pr: 4, sha: 'merge-sha', groups: ['g4'] });
    f.api.releases = [{ id: 30, ref: 'development', sha: 'unrelated-sha', status: 'success' },
        { id: 29, ref: 'other', sha: 'merge-sha', status: 'success' },
        { id: 28, ref: 'development', tag: true, sha: 'merge-sha', status: 'success' }];
    assert.equal(f.context.pollDeploys(f.state, f.seen, f.found).length, 0);
    assert.ok(f.calls.some(call => call.args[3]?.includes('environment=production%2Feu')));
    f.api.releases.push({ id: 27, ref: 'development', sha: 'later-sha', status: 'success', deployable: { web_url: 'https://git.podravka.io/job/27' } });
    f.ancestors.add('merge-sha..later-sha');
    // Failed ancestry is cached; this pair was not checked until this new release appeared.
    const deployed = f.context.pollDeploys(f.state, f.seen, f.found);
    assert.equal(deployed.length, 1);
    assert.equal(deployed[0].run.id, 27);
    assert.equal(deployed[0].run.url, 'https://git.podravka.io/job/27');
});

test('GitLab deployment failures deduplicate per attempt and report missing deployments after twenty minutes', () => {
    const f = gitlabFixture();
    f.state.deploys.pending.push({ pr: 4, sha: 'merge-sha' });
    const release = { id: 30, ref: 'development', sha: 'merge-sha', status: 'running', updated_at: 'first' };
    f.api.releases = [release];
    const poll = () => f.context.pollDeploys(f.state, f.seen, f.found);
    poll();
    f.advance(21 * 60_000);
    poll();
    assert.equal(f.found.length, 0);
    release.status = 'failed';
    poll(); poll();
    assert.equal(f.found.length, 1);
    assert.equal(f.found[0].type, 'deploy-failed');
    release.status = 'canceled'; release.updated_at = 'retry';
    poll();
    assert.equal(f.found.length, 2);
    f.api.releases = [];
    poll(); poll();
    assert.equal(f.found.length, 3);
    assert.equal(f.found.at(-1).type, 'deploy-missing');
});

test('GitLab deployment pipelines exclude MR pipelines and only finish after branch deployment success', () => {
    const f = gitlabFixture();
    f.state.workflow.deploy = { kind: 'pipelines' };
    f.state.deploys.pending.push({ pr: 4, sha: 'merge-sha' });
    f.api.releases = [{ id: 20, ref: 'development', sha: 'merge-sha', source: 'merge_request_event', status: 'success' },
        { id: 19, ref: 'other', sha: 'merge-sha', source: 'push', status: 'success' }];
    assert.equal(f.context.pollDeploys(f.state, f.seen, f.found).length, 0);
    const run = { id: 21, ref: 'development', sha: 'merge-sha', source: 'push', status: 'manual', updated_at: 'first' };
    f.api.releases.push(run);
    assert.equal(f.context.pollDeploys(f.state, f.seen, f.found).length, 0);
    run.status = 'failed';
    f.context.pollDeploys(f.state, f.seen, f.found);
    assert.equal(f.found[0].type, 'deploy-failed');
    f.context.pollDeploys(f.state, f.seen, f.found);
    assert.equal(f.found.length, 1);
    f.api.pipeline.updated_at = 'second-attempt';
    f.context.pollDeploys(f.state, f.seen, f.found);
    assert.equal(f.found.length, 2, 'a failed retry of the same pipeline ID must wake again');
    run.status = 'success';
    assert.equal(f.context.pollDeploys(f.state, f.seen, f.found)[0].run.id, 21);
    delete f.state.workflow.deploy;
    assert.throws(() => f.context.pollDeploys(f.state, f.seen, []), /needs workflow.deploy/);
    f.state.workflow.deploy = { kind: 'actions' };
    assert.throws(() => f.context.pollDeploys(f.state, f.seen, []), /Unsupported GitLab deploy kind/);
    f.state.workflow.deploy = { kind: 'none' };
    assert.equal(f.context.pollDeploys(f.state, f.seen, [])[0].run, null);
});

test('GitLab host defaults, authentication and malformed responses never fall back to GitHub', () => {
    const f = gitlabFixture();
    delete f.state.repo.host;
    f.state.repo.url = 'https://git.podravka.io/team/subgroup/project';
    assert.equal(f.context.pullRequest(f.state, 4, '/repo').state, 'OPEN');
    f.context.spawnSync = () => ({ error: { code: 'ENOENT' } });
    assert.throws(() => f.context.pullRequest(f.state, 4, '/repo'), /GitLab CLI/);
    f.context.spawnSync = () => ({ status: 1, stderr: 'HTTP 401: unauthorized' });
    assert.throws(() => f.context.pullRequest(f.state, 4, '/repo'), /HTTP 401/);
    f.context.spawnSync = () => ({ status: 0, stdout: '<html>sign in</html>' });
    assert.throws(() => f.context.pullRequest(f.state, 4, '/repo'), /invalid JSON/);
});

test('GitLab cleanup recognizes published closed/merged MR heads after source branch deletion', () => {
    const f = gitlabFixture();
    for (const state of ['merged', 'closed', 'opened']) {
        f.api.mr.state = state;
        assert.equal(f.context.published(f.state, '/repo', 'current-head', 4), state !== 'opened');
        assert.equal(f.context.published(f.state, '/repo', 'unpushed-head', 4), false);
    }
});

function closingFixture({ writes = 'available', verify = false, fail = null } = {}) {
    const { context, files } = runtime();
    const calls = [];
    context.tool = async (_ctx, name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (fail?.name === name) { const error = new Error(fail.message ?? 'refused'); error.fromTool = true; error.code = fail.code; throw error; }
        return {};
    };
    const sha = 'abcdef1234567890';
    const state = {
        project: { id: 'project0001' }, repo: { slug: 'org/repo' }, watch: { writes },
        items: { c1: { number: 61, stage: 'in-progress' }, c2: { number: 62, stage: 'in-progress', round: 2 } },
        groups: { g61: { state: 'merged', pr: 7, threadId: 'thread-fix', reviewThreadId: 'thread-review', closing: {
            agent: 'claude', model: 'claude-opus-5-5', reasoning: 'medium',
            items: { c1: { reply: 'Fixed in [`{sha7}`]({commitUrl}). Done.' },
                c2: verify ? { reply: 'Check it: {sha}', verify: { reviewerId: 'u_reviewer', expectedRevision: null, fixUrl: 'https://site/page' } }
                    : { reply: 'Part one shipped.', status: 'keep' } } } } },
        prs: { 7: { group: 'g61', state: 'merged' } },
        deploys: { pending: [{ pr: 7, sha, groups: ['g61'] }, { pr: 8, sha: 'other' }] }
    };
    files.set('/state/state.json', structuredClone(state));
    return { context, files, calls, state, sha, seen: {}, found: [], updates: [] };
}

test('the watcher closes drafted comments after their deploy and reports one quiet event', async () => {
    const f = closingFixture();
    await f.context.closeDeployed({}, f.state, f.seen, f.found, f.updates, { entry: f.state.deploys.pending[0], run: { id: 1 } });
    assert.deepEqual(f.calls.map(call => call.name), ['reply_to_feedback', 'set_feedback_status', 'reply_to_feedback']);
    assert.equal(f.calls[0].args.text, 'Fixed in [`abcdef1`](https://github.com/org/repo/commit/abcdef1234567890). Done.');
    assert.equal(f.calls[0].args.idempotencyKey, 'um-project0001-61-reply-1');
    assert.equal(f.calls[0].args.model, 'claude-opus-5-5');
    assert.equal(f.calls[1].args.status, 'done');
    assert.equal(f.calls[2].args.idempotencyKey, 'um-project0001-62-reply-2');
    // The event comes with the bookkeeping, under the state lock.
    assert.equal(f.found.length, 0);
    await f.context.updateState('/state', f.updates);
    assert.equal(f.found.length, 1);
    assert.equal(f.found[0].type, 'closed');
    assert.equal(f.found[0].quiet, true);
    assert.deepEqual([...f.found[0].threads].sort(), ['thread-fix', 'thread-review']);
    const next = f.files.get('/state/state.json');
    assert.equal(next.items.c1.stage, 'done');
    assert.equal(next.items.c2.stage, 'in-progress'); // status "keep" leaves it
    assert.equal(next.groups.g61.state, 'closed');
    assert.equal('closing' in next.groups.g61, false);
    assert.equal(next.prs[7].state, 'deployed');
    assert.deepEqual(next.deploys.pending.map(entry => entry.pr), [8]);
    assert.ok(next.watcherUpdatedAt);
    assert.equal(next.updatedAt, undefined);
});

test('GitLab closing replies link the merge commit on the self-managed host', async () => {
    const f = closingFixture();
    f.state.repo = { provider: 'gitlab', host: 'git.podravka.io', slug: 'team/subgroup/project' };
    f.files.set('/state/state.json', structuredClone(f.state));
    await f.context.closeDeployed({}, f.state, f.seen, f.found, f.updates, { entry: f.state.deploys.pending[0] });
    assert.equal(f.calls[0].args.text, `Fixed in [\`abcdef1\`](https://git.podravka.io/team/subgroup/project/-/commit/${f.sha}). Done.`);
});

async function applyUpdates(f) {
    await f.context.updateState('/state', f.updates);
    return f.files.get('/state/state.json');
}

test('closing requests verification, and reports refused writes and conflicts once without recording them', async () => {
    const verified = closingFixture({ verify: true });
    await verified.context.closeDeployed({}, verified.state, verified.seen, verified.found, verified.updates, { entry: verified.state.deploys.pending[0] });
    const request = verified.calls.find(call => call.name === 'request_feedback_verification');
    assert.equal(request.args.reviewerId, 'u_reviewer');
    assert.equal(request.args.expectedRevision, null);
    assert.equal((await applyUpdates(verified)).items.c2.stage, 'ready');
    assert.equal(verified.found[0].type, 'closed');
    for (const fail of [{ name: 'reply_to_feedback', code: 'forbidden', message: 'needs feedback:reply' },
        { name: 'set_feedback_status', code: 'conflict', message: 'That key was used with other input.' }]) {
        const refused = closingFixture({ fail });
        for (let cycle = 0; cycle < 2; cycle++)
            await refused.context.closeDeployed({}, refused.state, refused.seen, refused.found, refused.updates, { entry: refused.state.deploys.pending[0] });
        assert.deepEqual(refused.found.map(event => [event.type, event.number, event.code, event.quiet]), [['close-failed', 61, fail.code, undefined]]);
        assert.equal(refused.updates.length, 0);
    }
});

test('closing checks the state before writing and under the lock, and records nothing stale', async () => {
    // Patched before the writes: nothing is written; the next cycle plans again from the new state.
    const before = closingFixture();
    const patched = structuredClone(before.state);
    patched.items.c1.round = 2;
    await before.context.closeDeployed({}, before.state, before.seen, before.found, before.updates, { entry: before.state.deploys.pending[0] }, () => {}, () => patched);
    assert.equal(before.calls.length, 0);
    assert.equal(before.updates.length, 0);
    // Patched during the writes: the replies went out, but the bookkeeping refuses and wakes the orchestrator.
    const during = closingFixture();
    await during.context.closeDeployed({}, during.state, during.seen, during.found, during.updates, { entry: during.state.deploys.pending[0] });
    const file = during.files.get('/state/state.json');
    file.items.c1.round = 2;
    file.groups.g61.closing.items.c1.reply = 'A newer draft';
    const next = await applyUpdates(during);
    assert.equal(next.items.c1.stage, 'in-progress');
    assert.equal(next.groups.g61.closing.items.c1.reply, 'A newer draft');
    assert.equal(next.deploys.pending.length, 2);
    assert.deepEqual(during.found.map(event => [event.type, event.code]), [['close-failed', 'state-changed']]);
    // A new round while the reply is in flight: the old status write never goes out.
    const inFlight = closingFixture();
    const reply = inFlight.context.tool;
    inFlight.context.tool = async (ctx, name, args) => {
        const result = await reply(ctx, name, args);
        if (name === 'reply_to_feedback') inFlight.files.get('/state/state.json').items.c1.round = 2;
        return result;
    };
    await inFlight.context.closeDeployed({}, inFlight.state, inFlight.seen, inFlight.found, inFlight.updates,
        { entry: inFlight.state.deploys.pending[0] }, () => {}, () => inFlight.files.get('/state/state.json'));
    assert.deepEqual(inFlight.calls.map(call => call.name), ['reply_to_feedback']);
    assert.equal(inFlight.updates.length, 0);
});

test('closing follows the deploy entry it planned for and removes only that one', async () => {
    // The entry keeps its merge commit but now closes another group: no writes, nothing removed.
    const replaced = closingFixture();
    const file = replaced.files.get('/state/state.json');
    file.groups.g62 = { state: 'merged', closing: { items: { c2: { reply: 'Other' } } } };
    file.deploys.pending[0] = { pr: 7, sha: replaced.sha, groups: ['g62'] };
    await replaced.context.closeDeployed({}, replaced.state, replaced.seen, replaced.found, replaced.updates,
        { entry: replaced.state.deploys.pending[0] }, () => {}, () => replaced.files.get('/state/state.json'));
    assert.equal(replaced.calls.length, 0);
    assert.equal(replaced.updates.length, 0);
    // Replaced after the writes: nothing is recorded and the replacement entry stays.
    const late = closingFixture();
    await late.context.closeDeployed({}, late.state, late.seen, late.found, late.updates, { entry: late.state.deploys.pending[0] });
    late.files.get('/state/state.json').deploys.pending[0].groups = ['g62'];
    const next = await applyUpdates(late);
    assert.equal(next.groups.g61.state, 'merged');
    assert.deepEqual(next.deploys.pending.map(entry => entry.groups ?? null), [['g62'], null]);
    assert.deepEqual(late.found.map(event => [event.type, event.code]), [['close-failed', 'state-changed']]);
    // Another entry with the same merge commit (a push) stays when this one closes.
    const shared = closingFixture();
    shared.files.get('/state/state.json').deploys.pending.push({ sha: shared.sha, groups: ['g99'] });
    await shared.context.closeDeployed({}, shared.state, shared.seen, shared.found, shared.updates, { entry: shared.state.deploys.pending[0] });
    assert.deepEqual((await applyUpdates(shared)).deploys.pending.map(entry => entry.groups ?? entry.pr), [8, ['g99']]);
});

test('a deploy entry with explicit groups closes only those, and entries without a PR infer none', () => {
    const { context } = runtime();
    const state = { groups: { a: { pr: undefined, closing: {} }, b: { closing: {} }, c: { pr: 9 } }, prs: { 9: { group: 'c' } } };
    assert.deepEqual([...context.groupsOf(state, undefined, { sha: 's', groups: ['a'] })], ['a']);
    assert.deepEqual([...context.groupsOf(state, undefined, { sha: 's' })], []);
    assert.deepEqual([...context.groupsOf(state, 9, { sha: 's' })], ['c']);
});

test('without a draft or write access the deploy wakes the orchestrator as before', async () => {
    for (const fixture of [closingFixture({ writes: 'missing' }), (() => { const f = closingFixture(); delete f.state.groups.g61.closing; return f; })()]) {
        await fixture.context.closeDeployed({}, fixture.state, fixture.seen, fixture.found, fixture.updates, { entry: fixture.state.deploys.pending[0], run: { id: 9, url: 'u' } });
        assert.equal(fixture.calls.length, 0);
        assert.deepEqual(fixture.found.map(event => [event.type, event.quiet]), [['deployed', undefined]]);
    }
});

test('merges are recorded by the watcher and stay quiet unless branches must be up to date', async () => {
    for (const strict of [false, true, undefined]) {
        const { context, files } = runtime();
        restore(context, 'pollPullRequests');
        context.githubJson = args => args[0] === 'pr' ? { state: 'MERGED', mergeCommit: { oid: 'merge-sha' } } : [];
        context.repoCwd = () => '/repo';
        const state = { workflow: { strict }, repo: { slug: 'org/repo' }, harness: { prWatch: true },
            groups: { g1: { state: 'pr', pr: 5 } }, prs: { 5: { group: 'g1', state: 'open', autoMerge: true } }, deploys: { pending: [] } };
        files.set('/state/state.json', structuredClone(state));
        const seen = {}, found = [], updates = [];
        context.pollPullRequests(state, seen, found, updates);
        assert.equal(found[0].type, 'merged');
        assert.equal(found[0].quiet, strict === false ? true : undefined);
        await context.updateState('/state', updates);
        const next = files.get('/state/state.json');
        assert.deepEqual(next.deploys.pending.map(entry => [entry.pr, entry.sha, [...entry.groups]]), [[5, 'merge-sha', ['g1']]]);
        assert.equal(next.prs[5].state, 'merged');
        assert.equal(next.groups.g1.state, 'merged');
        context.pollPullRequests(state, seen, found, updates);
        assert.equal(found.length, 1);
    }
});

test('PR polling wakes only for decisions and leaves T3-watched PRs to T3 until auto-merge is on', () => {
    const { context } = runtime();
    restore(context, 'pollPullRequests');
    let answer;
    const viewed = [];
    context.githubJson = args => { viewed.push(args[2]); return answer; };
    context.repoCwd = () => '/repo';
    const passing = [{ __typename: 'CheckRun', name: 'CI OK', status: 'COMPLETED', conclusion: 'SUCCESS' }];
    const state = { workflow: { requiredChecks: ['CI OK'], strict: false }, harness: { prWatch: true }, prs: { 1: { state: 'open', autoMerge: true }, 2: { state: 'open' } } };
    const seen = {}, found = [];
    answer = { state: 'OPEN', mergeable: 'MERGEABLE', headRefOid: 'h1', statusCheckRollup: passing, autoMergeRequest: { enabledAt: 'x' } };
    context.pollPullRequests(state, seen, found);
    assert.deepEqual(viewed, ['1']);
    assert.equal(found.length, 0); // auto-merge takes it from here
    answer = { ...answer, headRefOid: 'h2', mergeable: 'CONFLICTING' };
    context.pollPullRequests(state, seen, found);
    assert.equal(found[0].mergeable, 'CONFLICTING');
    state.harness.prWatch = false;
    state.prs[1].state = 'merged';
    answer = { state: 'OPEN', mergeable: 'MERGEABLE', headRefOid: 'h3', statusCheckRollup: passing };
    context.pollPullRequests(state, seen, found);
    assert.equal(found.at(-1).pr, 2); // passing without auto-merge needs the orchestrator
    // A branch behind its base matters only when the base requires up-to-date branches.
    state.prs[1].state = 'open';
    state.prs[2].state = 'merged';
    answer = { state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', headRefOid: 'h4', statusCheckRollup: passing, autoMergeRequest: {} };
    const count = found.length;
    context.pollPullRequests(state, seen, found);
    assert.equal(found.length, count);
    state.workflow.strict = true;
    answer = { ...answer, headRefOid: 'h5' };
    context.pollPullRequests(state, seen, found);
    assert.equal(found.at(-1).behind, true);
});

test('quiet events ride along without waking the orchestrator', async () => {
    const { context, files, advance } = runtime();
    let cycles = 0, wakes = 0;
    context.pollDeploys = (_state, _seen, found) => { if (cycles === 0) found.push({ type: 'merged', pr: 1, sha: 's', quiet: true }); return []; };
    context.fetch = async () => { wakes++; return { ok: true }; };
    context.sleep = async ms => {
        advance(Math.max(ms, 60_000)); cycles++;
        if (cycles === 3) context.pollUier = async (_ctx, _state, _seen, found) => { found.push({ type: 'reply', commentId: 'c', at: 'x' }); };
        if (cycles === 6) files.get('/state/state.json').stopped = true;
    };
    await context.watch({ persistent: true, 'notify-file': '/private/url', 'batch-seconds': 0 });
    // Three quiet cycles sent nothing; the first person's reply woke it once, with the merge attached.
    assert.equal(wakes, 1);
    const inbox = files.get('/state/inbox.json');
    assert.equal(inbox[0].type, 'merged');
    assert.ok(inbox.slice(1).every(event => event.type === 'reply'));
});

test('the watcher records its own Open to In progress change instead of reporting drift', async () => {
    const f = fixture({ mine: { stage: 'open', decision: 'accepted' }, theirs: { stage: 'open', decision: 'accepted' } },
        [{ id: 'mine', stage: 'in-progress' }, { id: 'theirs', stage: 'in-progress' }]);
    f.seen.attached = { mine: Date.now() };
    const updates = [];
    await f.reconcile(null, f.state, f.seen, f.found, updates);
    assert.deepEqual(f.found.map(event => [event.type, event.commentId]), [['drift', 'theirs']]);
    assert.equal(updates.length, 1);
    updates[0](f.state);
    assert.equal(f.state.items.mine.stage, 'in-progress');
});

test('a wake outage is tracked while delivery fails and reported once after it recovers', async () => {
    const { context, files, output } = runtime();
    let ok = false;
    context.fetch = async () => ({ ok });
    const events = [{ type: 'reply', commentId: 'thread', foundAt: 'one' }];
    files.set('/state/inbox.json', events);
    await context.notifyInbox('/state', {}, events, '/private/url', 1_000);
    await context.notifyInbox('/state', {}, events, '/private/url', 70_000);
    assert.equal(files.get('/state/notification.json').failures, 2);
    ok = true;
    await context.notifyInbox('/state', {}, events, '/private/url', 140_000);
    const saved = files.get('/state/notification.json');
    assert.equal(saved.failingSince, undefined);
    assert.equal(saved.lastOutage.failures, 2);
    await context.contextCommand({ take: true });
    await context.contextCommand({ take: true });
    assert.equal(output[0].wakeOutage.failures, 2);
    assert.equal(output[1].wakeOutage, undefined);
});

test('cleanup offers only clean worktrees of finished groups whose commits are published', () => {
    const { context } = runtime();
    context.resolve = path => path;
    // h1 is on a remote branch; h6 is only in its merged PR's head on GitHub; 'local' is nowhere.
    context.spawnSync = (_command, args, options) => args[0] === 'branch'
        ? { status: 0, stdout: args[3] === 'h1' ? '  origin/uier/1-done\n' : '' }
        : { status: 0, stdout: options.cwd === '/wt/dirty' ? ' M file\n' : '' };
    context.githubJson = args => ({ 6: { state: 'MERGED', headRefOid: 'h6' }, 3: { state: 'MERGED', headRefOid: 'h3' } })[args[2]] ?? null;
    context.contains = (_cwd, sha, head) => sha === head;
    context.worktreeList = () => [{ worktree: '/repo' }, { worktree: '/wt/done', branch: 'refs/heads/uier/1-done', HEAD: 'h1' },
        { worktree: '/wt/dirty', branch: 'refs/heads/uier/2-dirty', HEAD: 'h2' }, { worktree: '/wt/ahead', branch: 'refs/heads/uier/3-ahead', HEAD: 'local' },
        { worktree: '/wt/open', branch: 'refs/heads/uier/4-open', HEAD: 'h4' }, { worktree: '/wt/here', branch: 'refs/heads/uier/5-here', HEAD: 'h5' },
        { worktree: '/wt/merged', branch: 'refs/heads/uier/6-merged', HEAD: 'h6' }, { worktree: '/wt/cancelled', branch: 'refs/heads/uier/7-cancelled', HEAD: 'h7' }];
    const state = { repo: { slug: 'org/repo' }, groups: {
        g1: { state: 'closed', branch: 'uier/1-done', head: 'h1' }, g2: { state: 'closed', branch: 'uier/2-dirty', head: 'h2' },
        g3: { state: 'merged', branch: 'uier/3-ahead', head: 'h3', pr: 3 }, g4: { state: 'pr', branch: 'uier/4-open', head: 'h4', pr: 4 },
        g5: { state: 'closed', branch: 'uier/5-here', head: 'h5' }, g6: { state: 'closed', branch: 'uier/6-merged', pr: 6 },
        g7: { state: 'cancelled', branch: 'uier/7-cancelled', head: 'h7' } }, prs: { 4: { state: 'open' } } };
    const result = context.removableWorktrees(state, '/repo', '/wt/here/sub');
    assert.deepEqual(result.map(entry => [entry.path, entry.removable, entry.reason ?? null]), [
        ['/wt/done', true, null], ['/wt/dirty', false, 'uncommitted or untracked files'], ['/wt/ahead', false, 'commits not published'],
        ['/wt/merged', true, null], ['/wt/cancelled', false, 'commits not published']]);
});

for (const detached of [false, true]) test(`standalone persistent watcher delivers through a local CLI${detached ? ' after detaching' : ''} and retains its inbox`,
    { timeout: 15_000, skip: process.platform === 'win32' }, async t => {
        const dir = mkdtempSync(join(tmpdir(), 'uier-monitor-'));
        let child;
        const server = createServer(async (req, res) => {
            let body = '';
            for await (const chunk of req) body += chunk;
            const rpc = JSON.parse(body);
            assert.equal(req.headers.authorization, 'Bearer fixture-only-token');
            const params = rpc.params;
            const result = params.name === 'list_feedback_events'
                ? { cursor: 'cursor', items: params.arguments.cursor ? [{ name: 'feedback.created',
                    timestamp: '2026-11-10T12:00:00Z', data: { commentId: 'fixture', number: 1,
                        actor: { kind: 'member', name: 'person' } } }] : [] }
                : { items: [] };
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
        });
        t.after(async () => {
            const pidFile = join(dir, 'watch.pid');
            if (detached && existsSync(pidFile)) {
                const { pid } = JSON.parse(readFileSync(pidFile, 'utf8'));
                assert.notEqual(pid, child.pid);
                try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
                for (let tries = 0; tries < 100 && existsSync(pidFile); tries++) await sleep(20);
                assert.equal(existsSync(pidFile), false, 'The detached fixture watcher should stop cleanly');
            }
            if (child && child.exitCode === null) {
                const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
            }
            server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
            rmSync(dir, { recursive: true, force: true });
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const cli = join(dir, 'fake-t3.mjs'), delivered = join(dir, 'delivered.json');
        // Written whole, then renamed: the test reads the file as soon as it exists.
        writeFileSync(cli, `#!${process.execPath}\nimport {writeFileSync, readFileSync, renameSync} from 'node:fs';\n`
            + `const out = process.env.UM_TEST_WAKE_OUTPUT;\n`
            + `writeFileSync(out + '.tmp', JSON.stringify({args:process.argv.slice(2),prompt:readFileSync(0,'utf8')}));\nrenameSync(out + '.tmp', out);\n`, { mode: 0o700 });
        writeFileSync(join(dir, 'state.json'), JSON.stringify({ project: { id: 'fixture' }, me: { name: 'person' } }));
        child = spawn(process.execPath, [fileURLToPath(new URL('./monitor.mjs', import.meta.url)), 'watch', '--state', dir,
            '--persistent', '--thread', 'fixture-thread', '--t3-cli', cli, '--batch-seconds', '0', ...(detached ? ['--detach'] : [])], {
            env: { ...process.env, UIER_MCP_TOKEN: 'fixture-only-token',
                UIER_MCP_URL: `http://127.0.0.1:${server.address().port}`, UM_TEST_WAKE_OUTPUT: delivered }, stdio: 'ignore'
        });
        await once(child, 'spawn');
        for (let tries = 0; tries < 200 && !existsSync(delivered) && (detached || child.exitCode === null); tries++) await sleep(20);
        assert.equal(existsSync(delivered), true, 'The actual script should deliver its pending batch');
        const wake = JSON.parse(readFileSync(delivered, 'utf8'));
        assert.deepEqual(wake.args, ['thread', 'send', '--json', 'fixture-thread', '-']);
        assert.match(wake.prompt, /context --take/);
        assert.equal(JSON.parse(readFileSync(join(dir, 'inbox.json'), 'utf8'))[0].type, 'new');
        assert.equal(JSON.parse(readFileSync(join(dir, 'watch.pid'), 'utf8')).persistent, true);
        assert.ok(JSON.parse(readFileSync(join(dir, 'watch.json'), 'utf8')).heartbeatAt);
        // The dashboard's feed: the watcher announced the state folder and journaled what it did.
        // The wake is journaled once its delivery returned, a moment after the CLI wrote its output.
        const readJournal = () => readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(line => line.endsWith('}')).map(line => JSON.parse(line));
        for (let tries = 0; tries < 200 && !readJournal().some(event => event.type === 'wake'); tries++) await sleep(20);
        const journal = readJournal();
        assert.deepEqual(journal.slice(0, 3).map(event => event.type), ['watcher', 'new', 'wake']);
        assert.ok(journal.every(event => !Number.isNaN(Date.parse(event.at))) && journal[2].delivered === true);
        assert.ok(readdirSync(join(process.env.UIER_MONITOR_HOME, 'monitors')).filter(name => name.endsWith('.json')).some(name =>
            JSON.parse(readFileSync(join(process.env.UIER_MONITOR_HOME, 'monitors', name), 'utf8')).stateDir === dir));
        const health = execFileSync(process.execPath, [fileURLToPath(new URL('./monitor.mjs', import.meta.url)),
            'status', '--state', dir], { env: { ...process.env, UIER_MCP_TOKEN: 'fixture-only-token' }, encoding: 'utf8' });
        assert.match(health, /persistent/);
        assert.match(health, /heartbeat 20/);
    });
