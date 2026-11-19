#!/usr/bin/env node
// The detached supervisor owns discovery and wake delivery. The monitor and supervisor share a local SQLite database. Run the installed copy from a stable directory.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const bundled = resolve(dirname(script), '../../uier-monitor/scripts/monitor.mjs');
const helper = existsSync(join(dirname(script), 'monitor.mjs')) ? join(dirname(script), 'monitor.mjs') : bundled;
const { connection, tool, watcherPid, withLock } = await import(pathToFileURL(helper));
const { monitorHome, readState, readInbox, readRecord, registrations, transaction, writeRecord, writeState } =
    await import(pathToFileURL(join(dirname(helper), 'store.mjs')));
const home = monitorHome();
const minute = 60_000;
const now = () => new Date().toISOString();
const load = () => readRecord(null, 'orchestrator', { enabled: false, projects: {} });
const local = p => readState(p.dir, null);
const inbox = p => readInbox(p.dir);
const alive = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
function supervisorAlive(s) {
    if (!s.instance || !alive(s.pid)) return false;
    const ps = spawnSync('ps', ['-p', String(s.pid), '-o', 'command='], { encoding: 'utf8' });
    return ps.status === 0 && ps.stdout.includes('orchestrator.mjs serve ' + s.instance);
}
const common = cwd => realpathSync(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim());
function requireValue(value, message) { if (!value) throw new Error(message); return value; }

// Only short, synchronous mutations run under this lock. Network and CLI reads are fenced
// by the supervisor instance, project registration and run ID when their results are applied.
async function change(fn) {
    return withLock(home, 'orchestrator', () => transaction(() => {
        const state = load();
        const result = fn(state);
        writeRecord(null, 'orchestrator', state);
        return result;
    }));
}
function matches(s, p) {
    const current = s.projects[p.id];
    return s.enabled && s.instance === p.instance && current?.allowed && current.registration === p.registration
        && current.run === p.run;
}
async function update(p, fields) {
    return change(s => {
        if (!matches(s, p)) return false;
        Object.assign(s.projects[p.id], fields);
        return true;
    });
}
function registryConflict(dir, id) {
    return registrations().some(entry => entry.id === id && entry.stateDir !== dir);
}

export async function eligible(project, fetchPage) {
    let cursor = 0;
    const rows = new Map();
    for (;;) {
        const result = await fetchPage({ projectId: project.id, view: 'state', status: 'open', monitorScope: project.scope, limit: 1000, cursor });
        requireValue(result.actingAs?.userId === project.account, 'Discovery token acts as a different account.');
        requireValue(Array.isArray(result.items), 'Incomplete feedback page.');
        for (const row of result.items) {
            requireValue(typeof row.id === 'string' &&
                ['open', 'in-progress', 'ready'].includes(row.stage), 'Incomplete feedback row.');
            rows.set(row.id, row);
        }
        if (result.nextCursor === null) return [...rows.values()];
        requireValue(Number.isSafeInteger(result.nextCursor) && result.nextCursor > cursor && result.nextCursor <= 1000, 'Incomplete feedback cursor.');
        cursor = result.nextCursor;
    }
}
// Older comments have no updatedAt; a stable marker still distinguishes an unseen row
// from a skipped one, and changes when a reply, stage or assignment changes.
function revision(row) {
    return row.updatedAt ?? JSON.stringify([row.stage, row.replyCount, row.assignee?.id]);
}
async function feedback(p) {
    const ctx = requireValue(connection({ project: { id: p.id } }, p.id, p.dir), 'Missing discovery token.');
    return eligible(p, args => tool(ctx, 'list_feedback', args));
}
export function unfinished(s) {
    return !s?.project || Boolean(s.orchestrator?.recheck?.length || s.watch?.wakeAt || s.deploys?.pending?.length ||
        Object.values(s.items ?? {}).some(i => i.writePending?.length || (i.decision !== 'skipped' && i.stage !== 'done')) ||
        Object.values(s.groups ?? {}).some(g => !['closed', 'cancelled', 'done', 'closed-out', 'merged'].includes(g.state)
            || g.closing || g.prLinkPending?.length || g.agentLease?.state === 'working') ||
        Object.values(s.prs ?? {}).some(pr => !['merged', 'deployed', 'closed', 'closed-out', 'done'].includes(pr.state)));
}
function automaticStop(s, p) { return s?.watch?.stoppedBy === 'orchestrator:' + p.lastRun && p.lastRun; }
function stopped(s) { return s?.stopped || s?.watch?.stopped || s?.watch?.enabled === false; }
function available(p, s) {
    if (s && s.project?.id !== p.id) return false;
    if (!s) return !watcherPid(p.dir);
    return stopped(s) && !watcherPid(p.dir) && (automaticStop(s, p) || p.takeover);
}

function projectForRun(state, id, run) {
    const p = state.projects[id];
    requireValue(state.enabled && p?.allowed && run && p.run === run, 'This project run is no longer authorized.');
    requireValue(join(common(process.cwd()), 'uier-monitor', id) === p.dir && !registryConflict(p.dir, id), 'Wrong project checkout or conflicting registration.');
    return p;
}

// Child handshake before installing/starting the project monitor. A second, delayed launch
// or a stale wake may never clear a person’s stop or take an independent monitor over.
async function enter(id, run, suppliedThread) {
    return withLock(home, 'orchestrator', async () => {
        const state = load(), p = projectForRun(state, id, run);
        requireValue(!['parking', 'settled'].includes(p.phase), 'Run already parked.');
        const thread = p.harness === 't3' ? process.env.T3CODE_THREAD_ID || suppliedThread
            : p.harness === 'codex' ? process.env.CODEX_THREAD_ID || suppliedThread : run;
        requireValue(thread && (!p.thread || p.thread === thread), 'Wrong worker session.');
        p.thread = thread;
        return transaction(() => {
            const s = local(p);
            requireValue((!s?.me?.id || s.me.id === p.account) && !s?.me?.also?.length,
                'Saved monitor uses different accounts. Reconcile its scope before handoff.');
            if (s?.orchestrator?.run === run) requireValue(!stopped(s), 'Project monitor stopped.');
            else requireValue(available(p, s), 'Project monitor already owned or stopped.');
            const next = s ?? {};
            if (stopped(next)) {
                next.stopped = false;
                next.watch = { ...next.watch, stopped: false, enabled: true, stoppedBy: null };
            }
            if (next.orchestrator?.run !== run) next.orchestrator = { run, recheck: p.recheck ?? [] };
            writeState(p.dir, next);
            Object.assign(p, { phase: 'monitoring', takeover: false, error: null });
            writeRecord(null, 'orchestrator', state);
            return { first: !next.project, scope: p.scope, account: p.account, harness: p.harness, recheck: next.orchestrator.recheck ?? [] };
        });
    });
}

// Recheck all pages immediately before retirement. In particular, an unavailable or partially
// read project is never empty. Recheck local ownership and the inbox after the network read.
async function park(p) {
    const rows = await feedback(p);
    return withLock(home, 'orchestrator', async () => {
        const state = load();
        if (!matches(state, p)) return false;
        return transaction(() => {
            const s = local(p);
            requireValue((!s?.me?.id || s.me.id === p.account) && !s?.me?.also?.length,
                'Saved monitor uses different accounts. Reconcile its scope before handoff.');
            if (s?.orchestrator?.run !== p.run || stopped(s) || unfinished(s) || inbox(p).length ||
                rows.some(row => s.items?.[row.id]?.decision !== 'skipped')) return false;
            s.stopped = true;
            s.watch = { ...s.watch, stopped: true, stoppedBy: 'orchestrator:' + p.run };
            writeState(p.dir, s);
            // The next scan waits for the stopped watcher to exit before another start.
            const current = state.projects[p.id];
            current.skipped = Object.fromEntries(rows.map(row => [row.id, revision(row)]));
            current.phase = 'parking';
            current.error = null;
            writeRecord(null, 'orchestrator', state);
            return true;
        });
    });
}

function prompt(p, action) {
    return 'Use the uier-monitor skill for project ' + p.id + ' with managed=' + p.run + '. ' +
        (action === 'settle' ? 'Complete managed retirement: unwatch, unpin and settle this T3 thread.' :
            action === 'start' ? 'Start this managed project monitor in this checkout.' :
                'Resume this managed project monitor, take its inbox and finish this turn.');
}
function t3(p, args) {
    return JSON.parse(execFileSync(p.cli, ['thread', ...args], { cwd: p.repo, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
}
function nativeCommand(p, action) {
    const message = prompt(p, action);
    if (p.harness === 'claude') return ['-p', ...(action === 'start' ? ['--session-id', p.run] : ['--resume', p.thread]), message];
    return ['exec', ...(action === 'start' ? [] : ['resume', p.thread]), '--json', message];
}
async function dispatch(p, action) {
    // Save the launch intent before the external operation. An uncertain first launch
    // stays reserved until its child binds or an operator reconciles it.
    await withLock(home, 'orchestrator', () => {
        const state = load();
        if (!matches(state, p)) return;
        const current = state.projects[p.id];
        if (current.sentAt !== p.sentAt || alive(current.pid)) return;
        current.sentAt = now();
        current.retryRequested = false;
        writeRecord(null, 'orchestrator', state);
        if (p.harness === 't3') {
            const args = action === 'start' ? ['start', '--json', '--title', '🛎 Monitor: ' + p.name.replace(/[\r\n]/g, ' ').slice(0, 45), p.repo]
                : ['send', '--json', p.thread];
            // The CLI takes the message as one argument. Project names are display text only.
            const reply = t3(p, [...args, prompt(p, action)]);
            if (action === 'settle') current.retireSent = true;
            if (action === 'start') current.thread = requireValue(reply.threadId, 'Missing T3 launch receipt.');
            writeRecord(null, 'orchestrator', state);
            return;
        }
        const child = spawn(p.cli, nativeCommand(p, action), { cwd: p.repo,
            stdio: ['ignore', p.harness === 'codex' ? 'pipe' : 'ignore', 'ignore'] });
        current.pid = child.pid ?? null;
        if (p.harness === 'claude') current.thread = p.run;
        writeRecord(null, 'orchestrator', state);
        // Child receipts still belong to this run if discovery is paused while the turn is
        // finishing; a different run can never inherit its session ID or exit status.
        const receipt = fields => change(latest => {
            const record = latest.projects[p.id];
            if (record?.run === p.run && record.pid === (child.pid ?? null)) Object.assign(record, fields);
        }).catch(() => {});
        let receipts = Promise.resolve();
        if (child.stdout) {
            const lines = createInterface({ input: child.stdout });
            lines.on('line', line => {
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'thread.started' && typeof event.thread_id === 'string') receipts = receipts.then(() => receipt({ thread: event.thread_id }));
                } catch { /* Only capture the session identifier. Never persist transcripts. */ }
            });
        }
        child.on('error', () => {});
        child.once('close', code => {
            const result = { pid: null };
            if (code !== 0) Object.assign(result, { error: 'Worker command failed. Check the harness permissions and session.', needsRetry: true });
            void receipts.then(() => receipt(result));
        });
    });
}
function active(p) { return p.phase === 'starting' || p.phase === 'monitoring' || p.phase === 'parking'; }
async function discover(p, s) {
    if (!available(p, s)) { await update(p, { phase: stopped(s) ? 'stopped' : 'external', error: null }); return; }
    if (Date.now() - Date.parse(p.checkedAt) < 5 * minute) return;
    const rows = await feedback(p);
    const candidates = rows.filter(row => row.stage === 'open' && p.skipped?.[row.id] !== revision(row));
    const open = candidates.length;
    const fields = { checkedAt: now(), open, error: null, phase: p.phase === 'settled' ? 'settled' : 'waiting' };
    if (!open) { await update(p, fields); return; }
    const recheck = candidates.filter(row => s?.items?.[row.id]).map(row => row.id);
    const next = { ...fields, recheck, run: randomUUID(), harness: p.driver, cli: p.executable, phase: 'starting', retireSent: false, thread: null, pid: null, sentAt: null };
    const reserved = await change(state => {
        if (!matches(state, p) || !available(p, local(p)) || registryConflict(p.dir, p.id)) return false;
        Object.assign(state.projects[p.id], next);
        return true;
    });
    if (reserved) await dispatch({ ...p, ...next }, 'start');
}

async function finishParking(p, s, thread) {
    if (s?.watch?.stoppedBy !== 'orchestrator:' + p.run || !stopped(s)) {
        await update(p, { phase: 'stopped', run: null, error: 'Project monitor ownership changed.' }); return;
    }
    if (watcherPid(p.dir)) return;
    if (!p.retireSent && !thread?.archived && inbox(p).length) {
        // A watch cycle already in flight when park() set the stop flags can still
        // enqueue a closing receipt or a reply. Let this same worker drain it.
        await withLock(home, 'orchestrator', async () => {
            const state = load();
            if (!matches(state, p)) return;
            await transaction(() => {
                const latest = local(p);
                if (latest?.orchestrator?.run !== p.run || latest.watch?.stoppedBy !== 'orchestrator:' + p.run) return;
                latest.stopped = false;
                Object.assign(latest.watch, { stopped: false, stoppedBy: null });
                writeState(p.dir, latest);
                Object.assign(state.projects[p.id], { phase: 'monitoring', sentAt: null });
                writeRecord(null, 'orchestrator', state);
            });
        });
        return;
    }
    if (thread?.archived && !thread.settled) {
        await update(p, { phase: 'stopped', run: null, error: 'Worker thread was archived.' }); return;
    }
    if (thread && !thread.archived && (!p.retireSent || !thread.settled || thread.pinned)) {
        if (!(Date.now() - Date.parse(p.sentAt) < minute)) await dispatch(p, 'settle');
        return;
    }
    await update(p, { phase: 'settled', lastRun: p.run, run: null, settledAt: now(), error: null, open: 0 });
}

export async function inspect(p) {
    requireValue(join(common(p.repo), 'uier-monitor', p.id) === p.dir && !registryConflict(p.dir, p.id), 'Project checkout or monitor registration changed.');
    if (!matches(load(), p)) return;
    const s = local(p);
    if (p.needsRetry) return;
    if (!active(p)) return discover(p, s);
    if (alive(p.pid)) return;
    if (p.phase === 'starting' && !p.thread) {
        if (!p.sentAt && available(p, s)) { await dispatch(p, 'start'); return; }
        await update(p, { error: 'Awaiting launch receipt. Check the original session before retrying.' }); return;
    }
    let thread;
    if (p.harness === 't3') {
        thread = t3(p, ['show', '--json', '--messages', '0', p.thread]).thread;
        requireValue(thread?.threadId === p.thread && typeof thread.settled === 'boolean'
            && 'activeRunId' in thread, 'Incomplete T3 thread receipt.');
    }
    if (thread?.activeRunId || thread?.pendingRequestCount) return;
    if (p.phase === 'monitoring' && s?.watch?.stoppedBy === 'orchestrator:' + p.run && stopped(s)) {
        await update(p, { phase: 'parking' }); return;
    }
    if (p.phase === 'parking') return finishParking(p, s, thread);
    if (s?.orchestrator?.run !== p.run || stopped(s) || thread?.archived) {
        if (p.phase === 'starting') {
            if (p.retryRequested && p.thread) await dispatch(p, 'tick');
            else await update(p, { error: 'Awaiting the managed monitor handshake.' });
            return;
        }
        await update(p, { phase: 'stopped', run: null, error: 'Worker stopped or ownership changed.' }); return;
    }
    if (!p.thread) { await update(p, { error: 'Session ID missing. Reconcile the original worker.' }); return; }
    if (p.retryRequested || p.pid) {
        // A restarted supervisor may have missed the native turn's exit receipt.
        await dispatch(p, 'tick'); return;
    }
    if (!s.project || inbox(p).length || !watcherPid(p.dir)) {
        if (!(Date.now() - Date.parse(p.sentAt) < minute)) await dispatch(p, 'tick');
        return;
    }
    if (unfinished(s) || Date.now() - Date.parse(p.checkedAt) < minute) return;
    if (!(await park(p))) await update(p, { checkedAt: now(), error: null });
}

async function serve(instance) {
    for (;;) {
        const config = load();
        if (!config.enabled || config.instance !== instance) return;
        await change(s => { if (s.instance === instance) s.heartbeatAt = now(); });
        for (const entry of Object.values(config.projects)) {
            if (!entry.allowed) continue;
            const p = { ...entry, instance, driver: config.harness, executable: config.cli };
            try { await inspect(p); }
            catch (error) {
                // CLI error messages can contain full argv/output, including peer messages.
                const message = error?.cmd || error?.spawnargs ? 'Harness or checkout command failed.' : String(error.message).slice(0, 200);
                await update(p, { error: message });
            }
        }
        await sleep(minute);
    }
}

async function main([command, ...args]) {
    if (command === 'status') { const s = load(); return { ...s, running: Boolean(s.enabled && supervisorAlive(s)) }; }
    if (command === 'serve') { await serve(args[0]); return; }
    if (command === 'enter') return enter(args[0], args[1], args[2]);
    if (command === 'allow') {
        const [id, account, repo, scope = 'mine', name = id, handoff] = args;
        requireValue(/^[a-z0-9]{12}$/.test(id) && /^u_[\w-]+$/.test(account) && isAbsolute(repo) && ['mine', 'assigned'].includes(scope), 'Expected: allow PROJECT_ID ACCOUNT_ID ABSOLUTE_CHECKOUT [mine|assigned] [NAME] [takeover-stopped]');
        const path = realpathSync(repo), dir = join(common(path), 'uier-monitor', id);
        requireValue(!registryConflict(dir, id), 'Another checkout already hosts this project.');
        return change(s => {
            const old = s.projects[id];
            if (old?.run) requireValue(old.dir === dir && old.scope === scope && old.account === account, 'Finish the existing run before changing its scope or repository.');
            s.projects[id] = { ...old, id, name, account, repo: path, dir, scope, allowed: true, registration: randomUUID(),
                takeover: handoff === 'takeover-stopped', phase: old?.phase ?? 'waiting', checkedAt: null };
            return { allowed: id };
        });
    }
    if (command === 'remove' || command === 'retry') return change(s => {
        const p = requireValue(s.projects[args[0]], 'Unknown project.');
        if (command === 'remove') { p.allowed = false; p.registration = randomUUID(); }
        else {
            requireValue(!alive(p.pid), 'Worker still running.');
            if (p.phase === 'starting' && local(p)?.orchestrator?.run !== p.run && args[1] === 'confirmed-no-worker') {
                p.run = null; p.phase = 'waiting'; p.thread = null;
            }
            p.needsRetry = false; p.retryRequested = true; p.error = null; p.sentAt = null; p.checkedAt = null;
        }
        return { project: p.id, allowed: p.allowed };
    });
    if (command === 'stop') return change(s => { s.enabled = false; s.instance = null; return { stopped: true }; });
    if (command === 'start') return change(s => {
        const [harness, cli = harness] = args;
        requireValue(['t3', 'codex', 'claude'].includes(harness) && (cli === harness || isAbsolute(cli)), 'Expected: start t3|codex|claude [ABSOLUTE_CLI]');
        requireValue(Object.values(s.projects).some(p => p.allowed), 'Allow at least one project first.');
        if (s.enabled && supervisorAlive(s)) { requireValue(s.harness === harness, 'Another harness already owns the supervisor.'); return { pid: s.pid }; }
        mkdirSync(home, { recursive: true });
        const instance = randomUUID();
        const child = spawn(process.execPath, [script, 'serve', instance], { detached: true, stdio: 'ignore' });
        child.unref();
        Object.assign(s, { instance, enabled: true, harness, cli, pid: child.pid, startedAt: now(), heartbeatAt: null });
        return { pid: child.pid };
    });
    throw new Error('Use allow, remove, start, status, stop, retry or enter.');
}
if (process.argv[1] && realpathSync(process.argv[1]) === script) {
    try { const result = await main(process.argv.slice(2)); if (result !== undefined) console.log(JSON.stringify(result)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
