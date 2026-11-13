import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// The registry of this test run, never the person's own ~/.uier-monitor.
const home = mkdtempSync(join(tmpdir(), 'uier-monitor-home-'));
process.env.UIER_MONITOR_HOME = home;
const { PAGE, agentOf, collect, createDashboardServer, discover, findSiteIcon, iconLinks, iconRequest, iconType, isPublicAddress, levels, modelName, projectIcon, publicLookup, reviewOf, sessionLink, snapshot } = await import('./dashboard.mjs');
const monitor = fileURLToPath(new URL('./monitor.mjs', import.meta.url));
const temporary = [home];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

function stateDir(state, files = {}) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uier-monitor-state-')));
    temporary.push(dir);
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
    return dir;
}
const run = (dir, ...args) => execFileSync(process.execPath, [monitor, ...args, '--state', dir], { encoding: 'utf8', env: { ...process.env } });
const events = dir => readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const now = Date.parse('2026-11-12T12:00:00Z');
const outside = { cwd: tmpdir() };

test('the helper announces its monitor and journals state changes, and the dashboard finds it', () => {
    const dir = stateDir({ project: { id: 'p1', name: 'Fixture' }, repo: { slug: 'acme/site' },
        items: { c1: { number: 7, decision: 'accepted', stage: 'open' } }, groups: { g7: { items: ['c1'], state: 'queued' } } });
    run(dir, 'patch', JSON.stringify({ groups: { g7: { state: 'building', pr: 12 } }, items: { c1: { stage: 'in-progress' } } }));
    const announced = readdirSync(join(home, 'monitors')).map(name => JSON.parse(readFileSync(join(home, 'monitors', name), 'utf8')));
    assert.deepEqual(announced.map(({ registeredAt, ...entry }) => entry), [{ stateDir: dir, project: { id: 'p1', name: 'Fixture' }, repo: 'acme/site' }]);
    assert.deepEqual(events(dir).map(({ at, ...event }) => event), [
        { type: 'group', group: 'g7', from: 'queued', to: 'building', numbers: [7], pr: 12 },
        { type: 'item', number: 7, field: 'stage', from: 'open', to: 'in-progress' }
    ]);
    // A patch that changes no state or stage adds nothing, and announcing again rewrites nothing.
    const before = readFileSync(join(home, 'monitors', readdirSync(join(home, 'monitors'))[0]), 'utf8');
    run(dir, 'patch', JSON.stringify({ watch: { wakes: 1 } }));
    assert.equal(events(dir).length, 2);
    assert.equal(readFileSync(join(home, 'monitors', readdirSync(join(home, 'monitors'))[0]), 'utf8'), before);

    writeFileSync(join(dir, 'inbox.json'), JSON.stringify([{ type: 'new', number: 8, at: '2026-11-12T10:00:00Z', foundAt: '2026-11-12T10:00:05Z' }]));
    run(dir, 'context', '--take');
    assert.deepEqual(events(dir).at(-1).type, 'taken');
    assert.equal(events(dir).at(-1).events, 1);

    assert.deepEqual(discover(outside), [dir]);
    const [shown] = collect({ ...outside, now: Date.now() }).monitors;
    assert.equal(shown.project.name, 'Fixture');
    assert.deepEqual(shown.pipeline.map(entry => [entry.id, entry.stage, entry.pr, entry.prUrl]), [['g7', 'building', 12, 'https://github.com/acme/site/pull/12']]);
    assert.ok(shown.pipeline[0].since, 'the journal says since when the group has been building');
    assert.equal(shown.activity[0].type, 'taken');
    rmSync(join(home, 'monitors'), { recursive: true, force: true });
});

test('a snapshot carries a fixed set of fields: no secrets, no unknown fields, no unsafe links', () => {
    const dir = stateDir({
        project: { id: 'p1', name: 'Fixture', site: 'javascript:alert(1)' }, repo: { slug: 'acme/site"><script>', base: 'main' },
        watcherToken: { value: 'secret-token-value' }, me: { id: 'u_private', name: 'Private Person' }, anything: 'secret-extra-field',
        max: 4, watch: { wakes: 3, note: 'Merged two pull requests; waiting for the deploy.', wakeAt: '2026-11-12T12:30:00Z' },
        limits: { claudeAgent: { until: '2026-11-12T13:00:00Z' }, codex: { until: '2026-11-12T11:00:00Z' } },
        items: {
            a: { number: 1, link: 'https://uier.io/app/review/p1?comment=a', decision: 'accepted', stage: 'in-progress', secretNote: 'secret-item-field' },
            b: { number: 2, link: 'javascript:alert(2)', decision: 'asked', stage: 'open', question: 'Which page?' },
            c: { number: 3, decision: 'accepted', stage: 'ready' },
            d: { number: 4, decision: 'accepted', stage: 'done', closedAt: '2026-11-12T09:00:00Z', writePending: [{ tool: 'reply_to_feedback' }] },
            e: { number: 5, decision: 'accepted', stage: 'done', closedAt: '2026-11-11T09:00:00Z' },
            f: { number: 6, decision: 'skipped', stage: 'done', closedAt: '2026-11-12T09:00:00Z' }
        },
        groups: {
            g1: { items: ['a'], state: 'fixing', model: 'claude-opus-5-5', effort: 'high', note: '<img src=x onerror=alert(1)>', startedAt: '2026-11-12T11:00:00Z',
                agentLease: { items: ['a'], state: 'working', sessionUrl: 't3-thread://v2/env-1/thread-9' }, closing: { items: { a: { reply: 'secret-draft-reply' } } } },
            g2: { items: ['b'], state: 'held' }, g3: { items: ['c'], state: 'pr', pr: 31 }, g4: { items: ['d'], state: 'merged', pr: 32 },
            g5: { items: ['e'], state: 'merged', pr: 33 }, g6: { items: ['e'], state: 'closed', startedAt: '2026-11-11T08:00:00Z' },
            g7: { items: [], state: 'blocked', note: 'Needs a decision' }, g8: { items: [], state: 'something-new' }, g9: { items: [], state: 'merging', pr: 34 }
        },
        prs: { 31: { state: 'open', autoMerge: true, checks: 'pending' }, 32: { state: 'merged' } },
        deploys: { pending: [{ pr: 32, sha: 'abcdef1234567', groups: ['g4'] }, { pr: 31 }] },
        harness: { kind: 't3', threadId: 'thread-1' }
    }, { 'watch.json': { agentLeases: { a: { group: 'g1', renewedAt: now - 30_000 } } } });
    const shown = snapshot(dir, now);
    const sent = JSON.stringify(shown);
    for (const secret of ['secret-', 'javascript:', 'u_private', 'Private Person']) assert.ok(!sent.includes(secret), `${secret} must not reach the page`);
    assert.equal(shown.repo.slug, undefined, 'an invalid repository slug builds no links');
    assert.equal(shown.project.site, undefined);
    assert.deepEqual(Object.fromEntries(shown.pipeline.map(entry => [entry.id, entry.stage])),
        { g1: 'building', g2: 'queued', g3: 'pr', g4: 'deploying', g7: 'blocked', g8: 'other', g9: 'pr' });
    const [building] = shown.pipeline;
    assert.equal(building.note, '<img src=x onerror=alert(1)>', 'text stays text; the page never parses it as HTML');
    assert.equal(building.session, 'https://app.t3.codes/threads/env-1/thread-9');
    assert.deepEqual(building.agent, { kind: 'claude', name: 'Claude Opus 5.5', model: 'claude-opus-5-5', reasoning: 'High' });
    assert.equal(building.comments[0].link, 'https://uier.io/app/review/p1?comment=a');
    assert.equal(shown.harness.thread, 'https://app.t3.codes/threads/env-1/thread-1');
    assert.deepEqual(shown.slots, { used: 1, max: 4 });
    assert.deepEqual(shown.attention.map(entry => [entry.kind, entry.number, entry.link]), [['asked', 2, undefined], ['verify', 3, undefined], ['write', 4, undefined], ['blocked', undefined, undefined]]);
    assert.deepEqual(shown.waiting.map(entry => entry.text), ['1 session working', '2 pull requests to merge', '1 deploy to finish', 'You, on 4 comments', 'A timer']);
    assert.deepEqual(shown.health.filter(entry => /limit/.test(entry.text)).map(entry => entry.text), ['Usage limit on claudeAgent']);
    assert.equal(shown.note, 'Merged two pull requests; waiting for the deploy.');
    assert.deepEqual([shown.metrics.closed.length, shown.metrics.closed24h, shown.metrics.done, shown.metrics.cycleMinutes], [2, 1, 2, 60]);
});

test('status tells a running watcher from a stopped, interrupted, silent or abandoned monitor', () => {
    const fresh = new Date(now - 60_000).toISOString();
    const status = (state, files) => snapshot(stateDir({ updatedAt: fresh, ...state }, files), now).status;
    assert.equal(status({}), 'down');
    assert.equal(status({ watch: { stopped: true } }), 'stopped');
    assert.equal(status({ updatedAt: new Date(now - 3 * 86_400_000).toISOString() }), 'inactive');
    assert.equal(status({}, { 'watch.pid': { pid: 2 ** 22 - 3 } }), 'down', 'a process that is gone is not a watcher');
    assert.equal(status({}, { 'watch.pid': { pid: process.pid } }), 'down', 'another process that got the number is not a watcher');
    const handling = [{ at: new Date(now - 600_000).toISOString(), type: 'watcher', event: 'started', persistent: false },
        { at: new Date(now - 120_000).toISOString(), type: 'wake', delivered: true, events: 1 }].map(event => JSON.stringify(event)).join('\n');
    assert.equal(status({}, { 'events.jsonl': `${handling}\n` }), 'handling');
    const failing = snapshot(stateDir({ updatedAt: fresh }, { 'notification.json': { failingSince: now - 300_000, failures: 4 },
        'inbox.json': [{ type: 'reply', number: 1, foundAt: fresh }, { type: 'merged', pr: 2, quiet: true }] }), now);
    assert.match(failing.health.find(entry => entry.level === 'bad').text, /Wake delivery is failing \(4 tries\)/);
    assert.deepEqual(failing.inbox, { total: 2, loud: 1 });
    assert.equal(failing.waiting[0].text, 'The orchestrator, to handle 1 event');
});

test('a watcher with nothing in progress is waiting, and a group that just finished says how it ended', () => {
    const idle = stateDir({ updatedAt: new Date(now - 60_000).toISOString(), groups: { g1: { items: [], state: 'closed' }, g2: { items: [], state: 'cancelled' }, g3: { items: [], state: 'closed' } } },
        { 'watch.json': { heartbeatAt: new Date(now - 20_000).toISOString() }, 'events.jsonl': [
            { at: new Date(now - 120_000).toISOString(), type: 'group', group: 'g1', from: 'merged', to: 'closed' },
            { at: new Date(now - 90_000).toISOString(), type: 'group', group: 'g2', from: 'building', to: 'cancelled' },
            { at: new Date(now - 3_600_000).toISOString(), type: 'group', group: 'g3', from: 'merged', to: 'closed' }
        ].map(event => JSON.stringify(event)).join('\n') });
    const shown = snapshot(idle, now);
    assert.deepEqual(shown.waiting.map(entry => entry.key), ['feedback']);
    assert.deepEqual(shown.ended, { g1: 'closed', g2: 'cancelled' });
    assert.equal(shown.status, 'down', 'only a running watcher waits');
});

test('session links open from a browser, and agents get the names uier shows', async () => {
    const thread = 'thread:delegated-task:command%3Amcp%3A7a8eb97b%3Adelegate-task%3Astart-1';
    assert.equal(sessionLink(`t3-thread://v2/env-1/${thread}`),
        'https://app.t3.codes/threads/env-1/thread%3Adelegated-task%3Acommand%253Amcp%253A7a8eb97b%253Adelegate-task%253Astart-1');
    assert.equal(sessionLink('codex://threads/3c4681ea-20e0-44ce-a499-21a3d3e00f74'), 'codex://threads/3c4681ea-20e0-44ce-a499-21a3d3e00f74');
    for (const unsafe of ['javascript:alert(1)', 't3-thread://v2/env/a b', 't3code://new?prompt=x', 'codex://new', 'file:///etc/passwd', 42]) assert.equal(sessionLink(unsafe), undefined);
    assert.deepEqual(agentOf({ provider: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' }), { kind: 'openai', name: 'GPT-6.1 Sol', model: 'gpt-6.1-sol', reasoning: 'Extra high' });
    assert.deepEqual(agentOf({ agentLease: { agent: 'cursor', reasoning: 'medium' }, model: 'claude-sonnet-4-5' }), { kind: 'cursor', name: 'Claude Sonnet 4.5', model: 'claude-sonnet-4-5', reasoning: 'Medium' });
    assert.equal(agentOf({ provider: 'claudeAgent' }).name, 'Claude');
    assert.equal(agentOf({ model: 'some-new-model' }).name, 'some-new-model');

    // In the uier repository, the names and marks must equal the ones the app and the toolbar use.
    const source = new URL('../../../../../packages/toolbar/src/agents.ts', import.meta.url);
    if (!existsSync(fileURLToPath(source))) return;
    let shared;
    try { shared = await import(source.href); } catch { return; } // a Node that cannot run TypeScript files
    for (const id of ['claude-opus-5-5', 'claude-fable-5-2', 'claude-3-5-sonnet-20241022', 'opus[1m]', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'gpt-6.1-sol', 'gpt-5.1-codex-max',
        'gpt-5-mini', 'o4-mini', 'gemini-2.5-flash-lite', 'grok-code-fast-1', 'qwen3-coder:30b', 'composer-1', 'unknown-model'])
        assert.equal(modelName(id), shared.modelName(id), id);
    const marks = Object.fromEntries([...PAGE.matchAll(/^ {4}(claude|openai|cursor): '([^']+)'/gm)].map(match => [match[1], match[2]]));
    assert.deepEqual(marks, { claude: shared.agentMarks.claude.paths[0], openai: shared.agentMarks.codex.paths[0], cursor: shared.agentMarks.cursor.paths[0] });
    assert.deepEqual(JSON.parse(/agent: (\[[^\]]+\])/.exec(PAGE)[1].replaceAll("'", '"')), shared.agentMarks.agent.paths);
});

test('without a journal the activity falls back to the watcher log, newest first, on every read', () => {
    const dir = stateDir({}, { 'watch.log': ['2026-11-12T10:00:00.000Z watch 1.3.0 started, pid 1', '2026-11-12T10:01:00.000Z lease g1 c1: working false',
        '2026-11-12T10:02:00.000Z wake delivered; waiting for inbox acknowledgement', 'not a log line', ''].join('\n') });
    for (let read = 0; read < 2; read++)
        assert.deepEqual(snapshot(dir, now).activity.map(entry => entry.text), ['wake delivered; waiting for inbox acknowledgement', 'watch 1.3.0 started, pid 1']);
    assert.equal(snapshot(dir, now).metrics.journal, false);
});

test('the server is read-only, answers loopback names only and serves a locked-down page', async () => {
    const dir = stateDir({ project: { id: 'p1', name: 'Served fixture' } });
    const server = createDashboardServer({ states: [dir], ...outside, intervalMs: 20 });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    const call = (path, options = {}) => new Promise((resolve, reject) => {
        const outgoing = request({ host: '127.0.0.1', port, path, ...options }, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; if (options.first) { resolve({ response, body }); outgoing.destroy(); } });
            response.on('end', () => resolve({ response, body }));
        });
        outgoing.on('error', error => (options.first ? undefined : reject(error)));
        outgoing.end();
    });
    try {
        const page = await call('/');
        assert.equal(page.response.statusCode, 200);
        const policy = page.response.headers['content-security-policy'];
        const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];
        assert.ok(nonce && page.body.includes(`<script nonce="${nonce}">`) && !page.body.includes('__NONCE__'));
        assert.match(policy, /default-src 'none'/);
        assert.ok(!/unsafe-inline|https?:\/\/(?!www\.w3\.org)/.test(`${policy}${page.body}`), 'the page loads nothing from elsewhere');
        assert.equal(JSON.parse((await call('/api/snapshot')).body).monitors[0].project.name, 'Served fixture');
        const first = await call('/api/stream', { first: true });
        assert.equal(first.response.headers['content-type'], 'text/event-stream');
        assert.equal(JSON.parse(/^data: (.*)$/m.exec(first.body)[1]).monitors.length, 1);
        assert.equal((await call('/', { headers: { host: `evil.example:${port}` } })).response.statusCode, 403);
        assert.equal((await call('/api/snapshot', { method: 'POST' })).response.statusCode, 405);
        assert.equal((await call('/state.json')).response.statusCode, 404);
        assert.equal((await call('/?review=true')).response.statusCode, 200, 'a review link is still the page');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('--review adds the uier toolbar and exactly the sources it needs; without it the page stays offline', async () => {
    assert.equal(reviewOf(undefined), null);
    assert.deepEqual(reviewOf('proj_abc123'), { project: 'proj_abc123', origin: 'https://uier.io' });
    assert.deepEqual(reviewOf('proj_abc123', 'http://localhost:4004/app'), { project: 'proj_abc123', origin: 'http://localhost:4004' });
    for (const bad of ['', 'a"b', 'x y z x y z', '<script>']) assert.throws(() => reviewOf(bad), /project id/);
    assert.throws(() => reviewOf('proj_abc123', 'http://example.com'), /https/);

    const server = createDashboardServer({ states: [stateDir({ project: { id: 'p1' } })], ...outside, review: reviewOf('proj_abc123') });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
        const policy = response.headers.get('content-security-policy');
        const nonce = /script-src 'nonce-([^']+)'/.exec(policy)[1];
        assert.ok((await response.text()).includes(`<script nonce="${nonce}" src="https://uier.io/toolbar.js" data-uier-project="proj_abc123" defer></script>\n</body>`));
        for (const part of [`script-src 'nonce-${nonce}' https://uier.io`, `connect-src 'self' https://uier.io wss://uier.io `, 'frame-src https://uier.io', 'font-src https://uier.io', `default-src 'none'`, `frame-ancestors 'none'`])
            assert.ok(policy.includes(part), part);
        assert.ok(!policy.includes('unsafe'));
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('--dev swaps in an edited file on the same port, tells open pages to reload, and survives a broken edit', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uier-monitor-dev-')));
    temporary.push(dir);
    const script = join(dir, 'dashboard.mjs');
    const source = readFileSync(fileURLToPath(new URL('./dashboard.mjs', import.meta.url)), 'utf8');
    writeFileSync(script, source);
    const child = spawn(process.execPath, [script, '--dev', '--port', '0', '--state', stateDir({ project: { id: 'p1', name: 'Dev fixture' } })],
        { cwd: tmpdir(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const until = async (check, what) => {
        for (let tries = 0; tries < 100; tries++) { const value = await check(); if (value) return value; await sleep(50); }
        throw new Error(`Timed out waiting for ${what}. Output: ${output}`);
    };
    try {
        const url = await until(() => /(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1], 'the address');
        const build = async () => (await (await fetch(`${url}/api/snapshot`)).json()).build;
        const first = await build();
        assert.match(first, /^[0-9a-f]{12}$/);
        assert.ok((await (await fetch(url)).text()).includes(`var BUILD = '${first}';`), 'the page knows which build it is');

        const stream = await fetch(`${url}/api/stream`);
        const reader = stream.body.getReader();
        let events = '';
        const read = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) return; events += Buffer.from(value).toString(); } })();
        await until(() => events.includes('data: '), 'the first snapshot');

        writeFileSync(script, `${source}\n// an edit\n`);
        const second = await until(async () => { const now = await build(); return now !== first && now; }, 'the edited file to take over');
        await read;
        assert.match(events, /event: reload/, 'open pages are told to reload');

        writeFileSync(script, `${source}\nthis is not JavaScript (\n`);
        await until(() => /not reloaded/.test(output), 'the broken edit to be reported');
        assert.equal(await build(), second, 'the last good code keeps serving');

        writeFileSync(script, `${source}\n// fixed\n`);
        await until(async () => { const now = await build(); return now !== second && now; }, 'the fixed file to take over');
    } finally {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
    }
});

test('the page is one self-contained script without template syntax, in the brand colours', () => {
    const script = /<script nonce="__NONCE__">([\s\S]*)<\/script>/.exec(PAGE)[1];
    assert.ok(!script.includes('`') && !script.includes('${'), 'the page lives in a template string');
    assert.doesNotThrow(() => new Function(script));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script), 'monitor data is only ever set as text');
    const tokens = fileURLToPath(new URL('../../../../../packages/brand/tokens.css', import.meta.url));
    if (!existsSync(tokens)) return; // an install outside the uier repository
    const css = readFileSync(tokens, 'utf8');
    const values = block => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
    const brand = { light: values(css.slice(css.indexOf(':root, :host {'), css.indexOf('.dark, :host(.dark) {'))), dark: values(css.slice(css.indexOf('.dark, :host(.dark) {'))) };
    const style = /<style nonce="__NONCE__">([\s\S]*?)<\/style>/.exec(PAGE)[1];
    const page = { light: values(style.slice(0, style.indexOf('@media (prefers-color-scheme: dark)'))), dark: values(/prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/.exec(style)[1]) };
    for (const mode of ['light', 'dark']) {
        assert.ok(Object.keys(page[mode]).length >= 10);
        for (const [name, value] of Object.entries(page[mode])) assert.equal(value, brand[mode][name], `${name} (${mode}) must equal packages/brand/tokens.css`);
    }
});

test('the command line prints a snapshot as JSON and explains itself', () => {
    const dir = stateDir({ project: { id: 'p1', name: 'Printed fixture' } });
    mkdirSync(join(home, 'monitors'), { recursive: true });
    const script = fileURLToPath(new URL('./dashboard.mjs', import.meta.url));
    const printed = JSON.parse(execFileSync(process.execPath, [script, '--json', '--state', dir], { encoding: 'utf8', cwd: tmpdir(), env: { ...process.env } }));
    assert.deepEqual(printed.monitors.map(entry => entry.project.name), ['Printed fixture']);
    assert.match(execFileSync(process.execPath, [script, 'help'], { encoding: 'utf8' }), /read-only/);
    assert.throws(() => execFileSync(process.execPath, [script, '--nope'], { encoding: 'utf8', stdio: 'pipe' }), /Unknown option/);
});

/** Top-level functions of the page's script, to test them on their own. */
function pageFunctions(...names) {
    const script = /<script nonce="__NONCE__">([\s\S]*)<\/script>/.exec(PAGE)[1];
    const source = names.map(name => new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm').exec(script)[0]).join('\n');
    return new Function(`${source}\nreturn { ${names.join(', ')} };`)();
}

test('relative times wake exactly when their words change, growing or shrinking', () => {
    const { span, relative, untilChange } = pageFunctions('plural', 'span', 'relative', 'untilChange');
    assert.equal(relative('ago', now - 90_000, now), '2 min ago');
    assert.equal(relative('in', now + 45_000, now), 'in 45 s');
    assert.equal(relative('for', now - 3_660_000, now), 'for 1 h 1 min');
    const samples = [0, 1, 499, 500, 501, 999, 12_345, 58_999, 59_499, 59_500, 59_501, 60_000, 89_499, 89_500, 120_000, 149_499, 3_570_000, 3_599_000, 5_432_100, 47 * 3_600_000];
    for (let index = 0; index < 200; index++) samples.push(Math.floor(Math.random() * 46 * 3_600_000));
    for (const ms of samples) {
        const up = untilChange(ms, true);
        assert.ok(up > 0 && up <= 60_000, `${ms} grows`);
        assert.notEqual(span(ms + up), span(ms), `${ms} reads differently after ${up} ms`);
        assert.equal(span(ms + up - 1), span(ms), `${ms} reads the same until then`);
        const down = untilChange(ms, false);
        if (ms < 500) { assert.equal(down, Infinity, 'a time that has come stays "in 0 s"'); continue; }
        assert.notEqual(span(ms - down), span(ms), `${ms} shrinks after ${down} ms`);
        assert.equal(span(ms - down + 1), span(ms), `${ms} reads the same until it shrinks`);
    }
    const script = /<script nonce="__NONCE__">([\s\S]*)<\/script>/.exec(PAGE)[1];
    assert.ok(!/' ago'\s*:|span\(Date\.now\(\)/.test(script.replace(/function relative[\s\S]*?\n}\n/, '')), 'every relative time goes through when()');
});

test('the queued and pull request levels of the last day walk the journal back from the current counts', () => {
    const at = minutes => new Date(now - minutes * 60_000).toISOString();
    const journal = [
        { at: at(600), type: 'watcher', event: 'started' },
        { at: at(300), type: 'group', group: 'g1', to: 'queued' },
        { at: at(290), type: 'group', group: 'g2', to: 'held' },
        { at: at(200), type: 'group', group: 'g1', from: 'queued', to: 'building' },
        { at: at(100), type: 'group', group: 'g1', from: 'building', to: 'pr' },
        { at: at(45), type: 'group', group: 'g1', from: 'pr', to: 'merged' },
        { at: at(10), type: 'group', group: 'g3', from: 'blocked', to: 'pr' },
        { at: 'not a time', type: 'group', group: 'g9', to: 'queued' }
    ];
    const shown = levels({ queued: 1, pr: 1 }, journal, now);
    assert.equal(shown.step, 30);
    assert.equal(shown.queued.length, 49);
    const value = (series, minutes) => series[47 - minutes / 30]; // now is on the half hour
    assert.deepEqual([shown.queued.at(-1), shown.pr.at(-1)], [1, 1], 'the last point is now');
    assert.equal(value(shown.queued, 630), null, 'unknown before the journal starts');
    assert.equal(value(shown.queued, 600), 0);
    assert.equal(value(shown.queued, 270), 2);
    assert.equal(value(shown.queued, 180), 1);
    assert.equal(value(shown.pr, 60), 1);
    assert.equal(value(shown.pr, 30), 0, 'g1 merged, g3 not yet a pull request');
    assert.equal(levels({ queued: 0, pr: 0 }, [], now), null, 'no journal, no levels');
    // Snapshots of every monitor share the same instants, so the page can add them up.
    const dir = stateDir({ groups: { g1: { items: [], state: 'pr', pr: 4 } } }, { 'events.jsonl': `${JSON.stringify({ at: at(20), type: 'group', group: 'g1', from: 'building', to: 'pr' })}\n` });
    assert.deepEqual(snapshot(dir, now).metrics.levels.pr.slice(-3), [null, 1, 1], 'this journal starts 20 minutes ago');
});

test('a project icon is its site\'s favicon, fetched by the server and served from the dashboard only', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    assert.equal(iconType(png), 'image/png');
    assert.equal(iconType(Buffer.from([0, 0, 1, 0, 1, 0])), 'image/x-icon');
    assert.equal(iconType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
    for (const other of ['<!doctype html><html><svg></svg>', 'not an image', '']) assert.equal(iconType(Buffer.from(other)), undefined, other);
    assert.deepEqual(iconLinks(`<link rel="apple-touch-icon" href="/touch.png"><link href='/a.svg?v=1&amp;x=2' rel="shortcut icon">
        <link rel=icon href=https://cdn.example/b.ico><link rel="stylesheet" href="/s.css"><link rel="icon" href="javascript:alert(1)">`, 'https://site.example/docs/'),
    ['https://site.example/a.svg?v=1&x=2', 'https://cdn.example/b.ico', 'https://site.example/touch.png']);

    const served = [];
    const site = createServer((incoming, outgoing) => {
        served.push(incoming.url);
        if (incoming.url === '/') { outgoing.writeHead(200, { 'content-type': 'text/html' }); outgoing.end('<head><link rel="icon" href="/missing.png"><link rel="icon" href="/fake.png"><link rel="icon" href="/real.png"></head>'); return; }
        if (incoming.url === '/fake.png') { outgoing.writeHead(200, { 'content-type': 'image/png' }); outgoing.end('<script>alert(1)</script>'); return; }
        if (incoming.url === '/real.png') { outgoing.writeHead(200, { 'content-type': 'text/plain' }); outgoing.end(png); return; }
        outgoing.writeHead(404); outgoing.end();
    });
    site.listen(0, '127.0.0.1');
    await once(site, 'listening');
    const address = `http://127.0.0.1:${site.address().port}`;
    const server = createDashboardServer({ states: [stateDir({ project: { id: 'p1', name: 'Iconic', site: address } })], ...outside, intervalMs: 20 });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const dashboard = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.deepEqual(await findSiteIcon(address), { type: 'image/png', data: png }, 'the first declared icon that is an image by its bytes');
        assert.deepEqual(served, ['/', '/missing.png', '/fake.png', '/real.png']);
        assert.equal(await findSiteIcon('http://127.0.0.1:1'), null, 'a site that does not answer has no icon');

        assert.equal(collect({ ...outside, states: [stateDir({ project: { site: address } })] }).monitors[0].project.icon, undefined, 'a snapshot alone fetches nothing');
        let icon;
        for (let tries = 0; tries < 100 && !icon; tries++) {
            icon = (await (await fetch(`${dashboard}/api/snapshot`)).json()).monitors[0].project.icon;
            if (!icon) await sleep(20);
        }
        assert.match(icon, /^\/api\/icon\/[0-9a-f]{16}$/);
        const response = await fetch(`${dashboard}${icon}`);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.match(response.headers.get('content-security-policy'), /sandbox/);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        assert.equal((await fetch(`${dashboard}/api/icon/0123456789abcdef`)).status, 404, 'only icons the server fetched itself');
        assert.match((await fetch(dashboard)).headers.get('content-security-policy'), /img-src 'self' data:/);

        let asked = 0;
        const find = async () => { asked++; return null; };
        assert.equal(projectIcon('https://none.example', find), undefined);
        await sleep(0);
        assert.equal(projectIcon('https://none.example', find), undefined);
        assert.equal(asked, 1, 'a site without an icon is not asked again right away');
    } finally {
        server.closeAllConnections();
        site.closeAllConnections();
        await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => site.close(resolve))]);
    }
});

test('icon requests reach only the project site itself or public addresses, also through redirects and DNS', async () => {
    const site = new URL('http://127.0.0.1:4780/');
    const allowed = href => iconRequest(new URL(href), site);
    assert.equal(allowed('http://127.0.0.1:4780/favicon.ico'), 'site', 'the site itself, even on this machine');
    for (const href of ['http://127.0.0.1:4781/', 'http://localhost:4780/', 'http://[::1]:4780/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/x.png',
        'http://192.168.1.1/', 'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://0.0.0.0/', 'http://intranet/', 'http://a.localhost/', 'https://user:pass@example.com/',
        'https://example.com:8443/', 'file:///etc/passwd', 'ftp://example.com/'])
        assert.equal(allowed(href), false, href);
    assert.equal(allowed('https://cdn.example.com/icon.png'), 'public');
    assert.equal(allowed('http://8.8.8.8:4780/'), 'public', 'a public address on the site\'s own port');
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '169.254.169.254', '::1', '::ffff:10.0.0.1', 'fd00::1', 'not an address']) assert.equal(isPublicAddress(address), false, address);
    for (const address of ['8.8.8.8', '2606:4700::1111', '::ffff:1.1.1.1']) assert.equal(isPublicAddress(address), true, address);
    // A public-looking name that resolves to this machine is refused on the connection's own DNS answer.
    const refused = await new Promise(done => publicLookup('localhost', { all: true }, error => done(error)));
    assert.equal(refused?.code, 'EBLOCKED');

    // Another service on this machine, which no icon lookup may reach.
    const hits = [];
    const internal = createServer((incoming, outgoing) => { hits.push(incoming.url); outgoing.writeHead(200, { 'content-type': 'image/png' }); outgoing.end(Buffer.from('89504e470d0a1a0a', 'hex')); });
    internal.listen(0, '127.0.0.1');
    await once(internal, 'listening');
    const other = internal.address().port;
    const fixture = createServer((incoming, outgoing) => {
        if (incoming.url === '/') {
            outgoing.writeHead(200, { 'content-type': 'text/html' });
            outgoing.end(['http://127.0.0.1:OTHER/admin/declared', 'http://localhost:OTHER/admin/named', 'http://[::1]:OTHER/admin/v6', 'http://169.254.169.254/latest/meta-data/',
                '/to-internal.png', '/to-metadata.png'].map(href => `<link rel="icon" href="${href.replace('OTHER', other)}">`).join(''));
            return;
        }
        if (incoming.url === '/to-internal.png') { outgoing.writeHead(302, { location: `http://127.0.0.1:${other}/admin/redirected` }); outgoing.end(); return; }
        if (incoming.url === '/to-metadata.png') { outgoing.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' }); outgoing.end(); return; }
        outgoing.writeHead(404); outgoing.end();
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    try {
        const started = Date.now();
        assert.equal(await findSiteIcon(`http://127.0.0.1:${fixture.address().port}`), null);
        assert.deepEqual(hits, [], 'nothing reached the other service');
        assert.ok(Date.now() - started < 5000, 'refused addresses are not even tried');
    } finally {
        internal.closeAllConnections();
        fixture.closeAllConnections();
        await Promise.all([new Promise(resolve => internal.close(resolve)), new Promise(resolve => fixture.close(resolve))]);
    }
});
