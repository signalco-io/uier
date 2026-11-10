import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
        Date: Clock, Set, Map, createHash, URL, AbortSignal, join: (...parts) => parts.join('/'),
        mkdirSync() {}, rmSync: path => files.delete(path) });
    vm.runInContext(source, context);
    Object.assign(context, {
        readJson: (path, fallback) => files.has(path) ? structuredClone(files.get(path)) : fallback,
        writeJson: (path, value) => files.set(path, structuredClone(value)),
        withLock: async (_dir, _name, action) => action(), stateDir: () => '/state',
        print: value => output.push(structuredClone(value)), watcherPid: () => null, logger: () => () => {},
        connection: () => ({}), keepLeases: async () => {}, pollUier: async () => {},
        pollDeploys() {}, pollPullRequests() {}, wakeUrl: () => 'https://wake.example/secret'
    });
    files.set('/state/state.json', { project: { id: 'project' } });
    return { context, files, output, advance: ms => { now += ms; } };
}

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
        writeFileSync(cli, `#!${process.execPath}\nimport {writeFileSync, readFileSync} from 'node:fs';\n`
            + `writeFileSync(process.env.UM_TEST_WAKE_OUTPUT, JSON.stringify({args:process.argv.slice(2),prompt:readFileSync(0,'utf8')}));\n`, { mode: 0o700 });
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
        const health = execFileSync(process.execPath, [fileURLToPath(new URL('./monitor.mjs', import.meta.url)),
            'status', '--state', dir], { env: { ...process.env, UIER_MCP_TOKEN: 'fixture-only-token' }, encoding: 'utf8' });
        assert.match(health, /persistent/);
        assert.match(health, /heartbeat 20/);
    });
