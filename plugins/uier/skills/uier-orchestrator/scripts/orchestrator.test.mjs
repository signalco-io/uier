import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'uier-orchestrator-')));
const home = join(root, 'home'), file = join(home, 'orchestrator.json');
process.env.UIER_MONITOR_HOME = home;
process.env.UIER_MCP_TOKEN = 'local-fixture-token';
const { eligible, inspect, unfinished } = await import('./orchestrator.mjs');
const helper = fileURLToPath(new URL('./orchestrator.mjs', import.meta.url));
const monitor = fileURLToPath(new URL('../../uier-monitor/scripts/monitor.mjs', import.meta.url));
const account = 'u_fixture';
const rows = new Map(), requests = [];
const http = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { id, params } = JSON.parse(body);
    requests.push(params);
    const items = rows.get(params.arguments.projectId) || [];
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { actingAs: { userId: account }, items, nextCursor: null } } }));
});
http.listen(0, '127.0.0.1');
await once(http, 'listening');
process.env.UIER_MCP_URL = 'http://127.0.0.1:' + http.address().port;
after(() => { http.close(); rmSync(root, { recursive: true, force: true }); });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data));
const cli = (cwd, ...args) => JSON.parse(execFileSync(process.execPath, [helper, ...args], { cwd, encoding: 'utf8', env: process.env }));
const config = () => read(file);
const change = fn => { const state = config(); fn(state); write(file, state); };
const project = id => config().projects[id];
const open = id => ({ id, stage: 'open', updatedAt: '2026-01-01T00:00:00Z' });

test('discovery requires the enrolled account and every page, including a complete last cursor', async () => {
    const p = { id: 'test00000001', account, scope: 'mine' };
    const page = (items, nextCursor) => ({ items, nextCursor, actingAs: { userId: account } });
    const calls = [];
    const found = await eligible(p, async args => {
        calls.push(args);
        return args.cursor === 0 ? page([open('first')], 1) : page([open('second')], null);
    });
    assert.equal(found.length, 2);
    assert.deepEqual(calls.map(c => [c.projectId, c.monitorScope, c.cursor]), [[p.id, 'mine', 0], [p.id, 'mine', 1]]);
    await assert.rejects(eligible(p, () => page([], 0)), /cursor/);
    await assert.rejects(eligible(p, () => page([], undefined)), /cursor/);
    await assert.rejects(eligible(p, () => ({ ...page([], null), actingAs: {} })), /different account/);
});

test('every unfinished delivery keeps the project alive', () => {
    for (const state of [
        { items: { c: { decision: 'asked', stage: 'open' } } }, { items: { c: { stage: 'ready' } } },
        { groups: { g: { state: 'blocked' } } }, { groups: { g: { state: 'merged', closing: {} } } },
        { groups: { g: { state: 'closed', prLinkPending: ['c'] } } }, { watch: { wakeAt: 'later' } },
        { prs: { 4: { state: 'open' } } }, { deploys: { pending: [{}] } },
        { items: { c: { stage: 'done', writePending: ['reply'] } } }
    ]) assert.equal(unfinished({ project: {}, ...state }), true);
    assert.equal(unfinished({ project: {}, items: { c: { stage: 'done' } }, groups: { g: { state: 'closed' } } }), false);
});

for (const [index, harness] of ['t3', 'codex', 'claude'].entries()) test(harness + ' reserves one session per burst, retires it, then opens a fresh session', async t => {
    const id = 'test0000000' + index;
    const repo = join(root, harness + ' checkout'), binary = join(root, harness);
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    cli(repo, 'allow', id, account, repo, 'mine', 'Fixture');
    const log = join(repo, 'calls'), settled = join(repo, 'settled');
    writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync('calls', JSON.stringify(args) + '\\n');
if (args[0] === 'thread') {
    if (args[1] === 'show') console.log(JSON.stringify({thread: {threadId: 't3-worker', activeRunId: null, settled: fs.existsSync('settled')}}));
    else { if (args[1] === 'send' && args.at(-1).includes('retirement')) fs.writeFileSync('settled', '1'); console.log(JSON.stringify({threadId: 't3-worker'})); }
} else if (args[0] === 'exec') console.log(JSON.stringify({type: 'thread.started', thread_id: 'codex-worker'}));
`);
    chmodSync(binary, 0o700);
    change(s => Object.assign(s, { enabled: true, instance: 'test-loop', harness, cli: binary }));
    const tick = () => inspect({ ...project(id), driver: harness, executable: binary, instance: 'test-loop' });
    const waitForTurn = async () => {
        for (let i = 0; i < 100 && project(id).pid; i++) await sleep(20);
        assert.equal(project(id).pid, null);
    };
    rows.set(id, [{ id: 'legacy', stage: 'open' }, open('b')]);
    await Promise.all([tick(), tick()]);
    await waitForTurn();
    const p = project(id), stateFile = join(p.dir, 'state.json');
    const starts = () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        .filter(args => args[1] === 'start' || args.includes('--session-id') || (args[0] === 'exec' && !args.includes('resume')));
    assert.equal(starts().length, 1);
    assert.ok(p.thread);
    const args = ['enter', id, p.run, 't3-worker'];
    const childEnv = { ...process.env, T3CODE_THREAD_ID: 't3-worker', CODEX_THREAD_ID: 'codex-worker' };
    const entered = JSON.parse(execFileSync(process.execPath, [helper, ...args], { cwd: repo, env: childEnv }));
    assert.equal(entered.first, true);
    const s = read(stateFile);
    Object.assign(s, { project: { id }, items: { a: { stage: 'done' }, b: { stage: 'ready' } } });
    write(stateFile, s);
    // Keep a fixture watcher alive so the real process-identity check sees a live monitor.
    const dummy = join(repo, 'monitor.mjs');
    writeFileSync(dummy, 'setInterval(() => {}, 1000);');
    const watcher = spawn(process.execPath, [dummy], { stdio: 'ignore' });
    t.after(() => { watcher.kill(); });
    write(join(p.dir, 'watch.pid'), { pid: watcher.pid, inboxOnly: true });
    rows.set(id, []);
    change(c => { c.projects[id].checkedAt = null; c.projects[id].sentAt = null; });
    write(join(p.dir, 'inbox.json'), [{ type: 'reply', commentId: 'b' }]);
    await tick(); await waitForTurn();
    const wake = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.ok(wake.includes(p.thread));
    assert.ok(wake.includes(harness === 't3' ? 'send' : harness === 'claude' ? '--resume' : 'resume'));
    write(join(p.dir, 'inbox.json'), []);
    change(c => { c.projects[id].sentAt = null; });
    await tick();
    assert.equal(project(id).phase, 'monitoring');
    s.items.b.stage = 'done'; write(stateFile, s);
    await tick();
    assert.equal(project(id).phase, 'parking');
    assert.equal(read(stateFile).watch.stoppedBy, 'orchestrator:' + p.run);
    const exited = once(watcher, 'exit'); watcher.kill(); await exited;
    if (harness === 't3') {
        // A last watch cycle can enqueue a close receipt while its stop is propagating.
        write(join(p.dir, 'inbox.json'), [{ quiet: true, type: 'closed', threads: ['fix-session'] }]);
        await tick();
        assert.equal(project(id).phase, 'monitoring');
        assert.equal(read(stateFile).stopped, false);
        write(join(p.dir, 'inbox.json'), []);
        const lastWatcher = spawn(process.execPath, [dummy], { stdio: 'ignore' });
        t.after(() => { lastWatcher.kill(); });
        write(join(p.dir, 'watch.pid'), { pid: lastWatcher.pid, inboxOnly: true });
        await tick();
        assert.equal(project(id).phase, 'parking');
        const ended = once(lastWatcher, 'exit'); lastWatcher.kill(); await ended;
    }
    await tick();
    if (harness === 't3') { assert.equal(readFileSync(settled, 'utf8'), '1'); await tick(); }
    assert.equal(project(id).phase, 'settled');
    rows.set(id, [open('c'), open('b')]);
    change(c => { c.projects[id].checkedAt = null; });
    await tick(); await waitForTurn();
    assert.equal(starts().length, 2);
    const next = project(id);
    assert.notEqual(next.run, p.run);
    const resumed = JSON.parse(execFileSync(process.execPath, [helper, 'enter', id, next.run], { cwd: repo, env: childEnv }));
    assert.equal(resumed.first, false);
    assert.deepEqual(resumed.recheck, ['b']);
    assert.equal(read(stateFile).watch.stopped, false);
    assert.ok(requests.every(r => r.name === 'list_feedback'));
    assert.equal(starts()[0].some(arg => arg.includes('managed=' + p.run)), true);
    assert.ok(!readFileSync(log, 'utf8').includes('local-fixture-token'));
});

test('a pause, independent monitor or human stop prevents discovery and launches', async () => {
    const id = 'test00000004', repo = join(root, 'external');
    mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
    cli(repo, 'allow', id, account, repo);
    const p = project(id);
    mkdirSync(p.dir, { recursive: true });
    const count = requests.length, tick = () => inspect({ ...project(id), instance: 'test-loop' });
    write(join(p.dir, 'state.json'), { project: { id } });
    await tick();
    assert.equal(project(id).phase, 'external');
    write(join(p.dir, 'state.json'), { project: { id }, stopped: true, watch: { stoppedBy: 'person' } });
    await tick();
    assert.equal(project(id).phase, 'stopped');
    cli(repo, 'remove', id);
    await tick();
    assert.equal(requests.length, count);
    const status = cli(repo, 'status');
    assert.equal(status.projects[id].allowed, false);
    assert.equal(status.running, false);
    assert.equal(JSON.parse(execFileSync(process.execPath, [monitor, 'version'])).version, '1.9.0');
});

test('the actual managed watcher exits before polling a revoked registration', async () => {
    const id = 'test00000005', repo = join(root, 'revoked');
    mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
    cli(repo, 'allow', id, account, repo);
    const { dir } = project(id);
    mkdirSync(dir, { recursive: true });
    write(join(dir, 'state.json'), { project: { id }, harness: { kind: 't3' }, orchestrator: { run: 'owned-run' } });
    change(s => { s.projects[id].run = 'owned-run'; });
    cli(repo, 'remove', id);
    const before = requests.length;
    const child = spawn(process.execPath, [monitor, 'watch', '--inbox-only', '--state', dir], { cwd: repo, stdio: 'ignore' });
    assert.deepEqual(await once(child, 'exit'), [0, null]);
    assert.equal(requests.length, before);
    assert.match(readFileSync(join(dir, 'events.jsonl'), 'utf8'), /"event":"stopped"/);
});
