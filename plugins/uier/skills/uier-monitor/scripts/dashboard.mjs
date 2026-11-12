#!/usr/bin/env node
// uier monitor dashboard: a local, read-only page that shows what every uier monitor on this
// machine is doing, working on and waiting on. No dependencies; Node 18.15 or later.
//
//   node dashboard.mjs                 serve http://127.0.0.1:4780
//   node dashboard.mjs --json          print one snapshot of every monitor and exit
//   node dashboard.mjs help            every option
//
// It only reads. Monitors announce themselves in ~/.uier-monitor/monitors (monitor.mjs writes one
// small file per state folder); the dashboard reads each monitor's state.json, watch.json,
// watch.pid, inbox.json, notification.json and events.jsonl and sends the browser a fixed set of
// fields, never the files themselves. Feedback text is untrusted: the page renders it as text.
//
// Source of truth: plugins/uier/skills/uier-monitor/scripts/dashboard.mjs in the uier repository.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, statfsSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
/** Changes with every edit of this file, so an open page knows when the code behind it changed. */
export const BUILD = (() => {
    try { return createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12); }
    catch { return VERSION; }
})();
const DEFAULT_PORT = 4780;
const APP = 'uier-monitor-dashboard';
const SLOT_STATES = new Set(['building', 'fixing', 'reviewing']);
const FINISHED = new Set(['closed', 'cancelled', 'done', 'closed-out']);
const MINUTE = 60_000;
const DAY = 86_400_000;

const HELP = `uier monitor dashboard ${VERSION}

Usage: node dashboard.mjs [serve] [options]
       node dashboard.mjs stop

  --port N        Port to serve on (default ${DEFAULT_PORT}; the next free one is used when it is taken).
  --host HOST     Address to bind (default 127.0.0.1, this machine only).
  --state DIR     Also show the monitor in this state folder. Repeat for more.
  --open          Open the page in the browser.
  --detach        Keep serving after this command returns. Stop it with: node dashboard.mjs stop
  --json          Print one snapshot of every monitor as JSON and exit.
  --dev           For work on the dashboard itself: when this file changes, the new code takes over
                  on the same port and open pages reload, keeping their open cards and scroll position.

Monitors are found in ~/.uier-monitor/monitors (UIER_MONITOR_HOME overrides the folder), where the
watcher announces itself, and in <git common dir>/uier-monitor of the checkout you run this in.
The dashboard is read-only: it never changes a monitor, uier or the repository.
`;

// ---------------------------------------------------------------- reading files

export function monitorHome() {
    return process.env.UIER_MONITOR_HOME || join(homedir(), '.uier-monitor');
}

const cache = new Map();
/** A file's parsed content, read again only when its size or modification time changed. */
function cached(file, parse, fallback) {
    let info;
    try { info = statSync(file); } catch { cache.delete(file); return fallback; }
    const key = `${info.mtimeMs}:${info.size}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.value;
    let value = fallback;
    try { value = parse(file, info); } catch { /* a half-written or foreign file: show what we have */ }
    cache.set(file, { key, value });
    return value;
}

const json = (file, fallback) => cached(file, path => JSON.parse(readFileSync(path, 'utf8')), fallback);

/** The last `bytes` of a text file as whole lines. */
function tail(file, info, bytes) {
    const start = Math.max(0, info.size - bytes);
    const buffer = Buffer.alloc(info.size - start);
    const handle = openSync(file, 'r');
    try { readSync(handle, buffer, 0, buffer.length, start); } finally { closeSync(handle); }
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
}

function journal(dir) {
    const parse = (file, info) => tail(file, info, 512_000).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const current = cached(join(dir, 'events.jsonl'), parse, []);
    // Right after a rotation the current file is short; the previous one fills the history in.
    return current.length < 400 ? [...cached(join(dir, 'events.jsonl.1'), parse, []), ...current] : current;
}

function logLines(dir) {
    // Lease renewals fill the log; they say nothing about what the monitor is doing.
    return cached(join(dir, 'watch.log'), (file, info) => tail(file, info, 64_000).flatMap(line => {
        const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(line);
        return match && !/^lease \S+ \S+: (attached|working|agent cleared)/.test(match[2]) ? [{ at: match[1], type: 'log', text: match[2].slice(0, 240) }] : [];
    }).slice(-60), []);
}

const diskCache = new Map();
function diskFreeGiB(path) {
    if (!path) return null;
    const hit = diskCache.get(path);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    let value = null;
    try { const stats = statfsSync(path); value = Math.round(stats.bavail * stats.bsize / 2 ** 30); } catch { /* unknown */ }
    diskCache.set(path, { at: Date.now(), value });
    return value;
}

function alive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

const watcherCache = new Map();
/** Whether `pid` is a running watcher, not another process that got the number after a restart. */
function watcherAlive(pid) {
    if (!alive(pid)) return false;
    if (process.platform === 'win32') return true;
    const hit = watcherCache.get(pid);
    if (hit && Date.now() - hit.at < 15_000) return hit.value;
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    const value = ps.status === 0 && /monitor\.mjs/.test(ps.stdout);
    watcherCache.set(pid, { at: Date.now(), value });
    return value;
}

// ---------------------------------------------------------------- discovery

const commonDirs = new Map();
function gitCommonDir(cwd) {
    if (!commonDirs.has(cwd)) {
        const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
        commonDirs.set(cwd, git.status === 0 ? git.stdout.trim() : null);
    }
    return commonDirs.get(cwd);
}

/** Every state folder to show: announced ones, the current checkout's, and the ones passed in. */
export function discover({ states = [], cwd = process.cwd() } = {}) {
    const found = new Map();
    const add = dir => {
        if (typeof dir !== 'string' || !existsSync(join(dir, 'state.json'))) return;
        try { found.set(realpathSync(dir), true); } catch { /* removed meanwhile */ }
    };
    const registry = join(monitorHome(), 'monitors');
    let entries = [];
    try { entries = readdirSync(registry).filter(name => name.endsWith('.json')); } catch { /* nothing announced yet */ }
    for (const name of entries) add(json(join(registry, name), null)?.stateDir);
    const common = gitCommonDir(cwd);
    if (common) {
        const root = join(common, 'uier-monitor');
        try { for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) add(join(root, entry.name)); }
        catch { /* no monitor in this checkout */ }
    }
    for (const dir of states) add(resolve(dir));
    return [...found.keys()];
}

// ---------------------------------------------------------------- snapshot

const text = (value, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
const link = value => (typeof value === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(value) ? value : undefined);

const T3_THREAD = /^t3-thread:\/\/v2\/([A-Za-z0-9][A-Za-z0-9_-]{0,199})\/([A-Za-z0-9](?:[A-Za-z0-9_:-]|%3A){0,199})$/;
const hostedSegment = id => encodeURIComponent(id).replace(/[.!~*'()]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
/**
 * A session link a browser can open. T3 Code draws `t3-thread://` links as chips in its own chat
 * and registers no such scheme with the system, so the page gets the hosted link T3 Code's
 * "Copy thread" copies: it opens the thread in the desktop app, the mobile app or the browser.
 * Codex and Claude desktop sessions keep their own schemes. Only existing sessions, never commands.
 */
export function sessionLink(value) {
    if (typeof value !== 'string' || value.length > 512) return undefined;
    const t3 = T3_THREAD.exec(value);
    if (t3) return `https://app.t3.codes/threads/${hostedSegment(t3[1])}/${hostedSegment(t3[2])}`;
    const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    return new RegExp(`^(codex://threads/|claude://claude\\.ai/chat/)${uuid}$`).test(value) ? value : link(value);
}

// ---------------------------------------------------------------- agents
// The same names uier shows (packages/toolbar/src/agents.ts in the uier repository; dashboard.test.mjs
// keeps the two equal): "claude-opus-5-5" is Claude Opus 5.5, "xhigh" is Extra high.

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);
const version = (major, minor) => (minor ? `${major}.${minor}` : major);
const OTHER_FAMILIES = { grok: 'Grok', deepseek: 'DeepSeek', mistral: 'Mistral', codestral: 'Codestral', devstral: 'Devstral', magistral: 'Magistral',
    ministral: 'Ministral', pixtral: 'Pixtral', qwen: 'Qwen', kimi: 'Kimi', llama: 'Llama', composer: 'Composer', glm: 'GLM' };
function modelWord(word) {
    if (/^\d+(\.\d+)*$/.test(word)) return word;
    if (/^\d+(\.\d+)?[bkm]$/.test(word) || /^[a-z]\d+(\.\d+)*[a-z]?$/.test(word)) return word.toUpperCase();
    return capitalize(word);
}

/** A model's name as its maker writes it, or undefined for an id it does not know. */
export function modelName(model) {
    let id = model.trim().toLowerCase();
    const longContext = /\[1m\]$/.test(id);
    id = id.replace(/\[1m\]$/, '').replace(/^.*\//, '').replace(/@[\w.-]+$/, '')
        .replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '').replace(/-v\d+:\d+$/, '')
        .replace(/-(?:latest|\d{4}-\d{2}-\d{2}|\d{8})$/, '');
    const context = longContext ? ' (1M context)' : '';
    let match;
    if ((match = id.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d{1,2}))?$/))) return `Claude ${capitalize(match[1])} ${version(match[2], match[3])}${context}`;
    if ((match = id.match(/^claude-(\d+)(?:[-.](\d{1,2}))?-([a-z]+)$/))) return `Claude ${version(match[1], match[2])} ${capitalize(match[3])}${context}`;
    if ((match = id.match(/^claude-(\d+)(?:\.(\d+))?$/))) return `Claude ${version(match[1], match[2])}`;
    if ((match = id.match(/^(opus|sonnet|haiku|fable)$/))) return `Claude ${capitalize(match[1])}${context}`;
    if ((match = id.match(/^gpt-(\d+(?:\.\d+)?o?)((?:-[a-z0-9]+)*)$/))) {
        const words = match[2].split('-').filter(Boolean);
        if (words.includes('codex')) return [`GPT-${match[1]}`, ...words.map(capitalize)].join('-');
        return [`GPT-${match[1]}`, ...words.map(word => (['mini', 'nano', 'pro'].includes(word) ? word : capitalize(word)))].join(' ');
    }
    if (/^o\d(?:-[a-z]+)*$/.test(id)) return id;
    if ((match = id.match(/^gemini-(\d+(?:\.\d+)?)((?:-[a-z0-9]+)*)$/))) {
        const words = match[2].replace(/flash-lite/, 'flash_lite').split('-').filter(word => word && !/^\d+$/.test(word));
        return ['Gemini', match[1], ...words.map(word => (word === 'flash_lite' ? 'Flash-Lite' : capitalize(word)))].join(' ');
    }
    const [first, ...rest] = id.replace(/:/g, '-').split('-');
    const family = first?.match(/^([a-z]+)(\d[\d.]*)?$/);
    const familyName = family && OTHER_FAMILIES[family[1]];
    if (!familyName) return undefined;
    return [familyName + (family[2] ?? ''), ...rest.filter(word => word && !/^\d{4,}$/.test(word) && word !== 'latest').map(modelWord)].join(' ');
}

const REASONING = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const AGENT_NAMES = { claude: 'Claude', openai: 'Codex', cursor: 'Cursor', agent: 'AI agent' };

/** Who builds a group: whose mark to draw, the model's name and the reasoning level in words. */
export function agentOf(group) {
    const said = String(group.agentLease?.agent ?? '').toLowerCase();
    const hint = `${group.provider ?? ''} ${group.model ?? ''}`.toLowerCase();
    const kind = said === 'claude' ? 'claude' : said === 'codex' || said === 'chatgpt' ? 'openai' : said === 'cursor' ? 'cursor'
        : /claude|anthropic/.test(hint) ? 'claude' : /codex|chatgpt|openai|\bgpt-|\bo\d\b/.test(hint) ? 'openai' : /cursor|composer/.test(hint) ? 'cursor' : 'agent';
    const model = text(group.model, 100);
    const effort = text(group.effort ?? group.agentLease?.reasoning, 32)?.toLowerCase();
    return { kind, name: model ? modelName(model) ?? model : AGENT_NAMES[kind], model, reasoning: effort ? REASONING[effort] ?? capitalize(effort) : undefined };
}
const time = value => { const at = typeof value === 'number' ? value : Date.parse(value ?? ''); return Number.isFinite(at) ? new Date(at).toISOString() : undefined; };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const list = value => (Array.isArray(value) ? value : []);

function stageOf(id, group, deploying) {
    if (FINISHED.has(group.state)) return null;
    if (group.state === 'merged') return deploying.has(id) ? 'deploying' : null;
    if (group.state === 'queued' || group.state === 'held') return 'queued';
    if (group.state === 'building' || group.state === 'fixing') return 'building';
    if (group.state === 'reviewing') return 'reviewing';
    if (group.state === 'pr') return 'pr';
    if (group.state === 'blocked') return 'blocked';
    // A state this page does not know (orchestrators add their own, such as "merging"): with a pull
    // request it belongs with the pull requests, and the card says the state in words.
    return group.pr ? 'pr' : 'other';
}

function activityEntry(event) {
    const entry = { at: time(event.at), type: text(event.type, 40) };
    for (const key of ['event', 'group', 'from', 'to', 'field', 'change', 'by', 'state', 'checks', 'code', 'step', 'expected', 'actual', 'version'])
        if (typeof event[key] === 'string') entry[key] = event[key].slice(0, 60);
    for (const key of ['number', 'pr', 'events', 'replyCount']) if (Number.isFinite(event[key])) entry[key] = event[key];
    for (const key of ['quiet', 'delivered', 'persistent']) if (typeof event[key] === 'boolean') entry[key] = event[key];
    if (typeof event.sha === 'string') entry.sha = event.sha.slice(0, 7);
    if (Array.isArray(event.numbers)) entry.numbers = event.numbers.filter(Number.isFinite).slice(0, 12);
    if (text(event.message)) entry.message = text(event.message);
    return entry;
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One monitor, as the fixed set of fields the page shows. */
export function snapshot(dir, now = Date.now()) {
    const state = json(join(dir, 'state.json'), null);
    if (!state || typeof state !== 'object') return null;
    const seen = json(join(dir, 'watch.json'), {}) ?? {};
    const pidFile = json(join(dir, 'watch.pid'), null);
    const inbox = list(json(join(dir, 'inbox.json'), []));
    const notification = json(join(dir, 'notification.json'), {}) ?? {};
    const events = journal(dir);
    const items = state.items && typeof state.items === 'object' ? state.items : {};
    const groups = Object.entries(state.groups && typeof state.groups === 'object' ? state.groups : {}).filter(([, group]) => group && typeof group === 'object');
    const prs = state.prs && typeof state.prs === 'object' ? state.prs : {};
    const settings = state.watch && typeof state.watch === 'object' ? state.watch : {};
    const slug = /^[\w.-]+\/[\w.-]+$/.test(state.repo?.slug ?? '') ? state.repo.slug : undefined;
    const prUrl = number => (slug && Number.isInteger(Number(number)) ? `https://github.com/${slug}/pull/${Number(number)}` : undefined);

    // Watcher
    const pid = Number(pidFile?.pid) || null;
    const running = watcherAlive(pid);
    const heartbeat = Date.parse(seen.heartbeatAt ?? '');
    const stopped = Boolean(state.stopped || settings.stopped || settings.enabled === false);
    const lastStart = events.findLast(event => event.type === 'watcher' && event.event === 'started');
    const lastWake = events.findLast(event => event.type === 'wake' || event.type === 'taken');
    const loud = inbox.filter(event => !event?.quiet);
    let status = 'down';
    if (running) status = now - heartbeat > 5 * MINUTE ? 'stale' : 'running';
    else if (stopped) status = 'stopped';
    // A one-shot watcher exits to wake its orchestrator and is started again when the wake is handled.
    else if (lastStart && lastStart.persistent === false && now - Date.parse(lastWake?.at ?? '') < 15 * MINUTE) status = 'handling';
    // Nothing has touched this monitor for a day: it was left behind, not interrupted.
    let touched = Math.max(Date.parse(state.updatedAt ?? '') || 0, Date.parse(state.watcherUpdatedAt ?? '') || 0, heartbeat || 0);
    if (!touched) try { touched = statSync(join(dir, 'state.json')).mtimeMs; } catch { /* removed meanwhile */ }
    if (status === 'down' && now - touched > DAY) status = 'inactive';

    // Pipeline
    const pending = list(state.deploys?.pending).filter(entry => entry && typeof entry === 'object');
    const deploying = new Set(pending.filter(entry => entry.sha).flatMap(entry => [...list(entry.groups),
        ...groups.filter(([, group]) => entry.pr && group.pr === entry.pr).map(([id]) => id)]));
    const since = {};
    for (const event of events) if (event.type === 'group' && typeof event.group === 'string') since[event.group] = { to: event.to, at: event.at };
    const leases = seen.agentLeases && typeof seen.agentLeases === 'object' ? seen.agentLeases : {};
    const pipeline = [];
    for (const [id, group] of groups) {
        const stage = stageOf(id, group, deploying);
        if (!stage) continue;
        const pr = prs[group.pr] && typeof prs[group.pr] === 'object' ? prs[group.pr] : null;
        const live = list(group.agentLease?.items).map(item => leases[item]).filter(record => record?.group === id);
        const checks = pr?.checks;
        pipeline.push({
            id: text(id, 40), stage, state: text(group.state, 24),
            comments: list(group.items).slice(0, 12).map(item => ({ number: Number(items[item]?.number) || undefined, link: link(items[item]?.link) })),
            size: text(group.size, 4), class: text(group.class, 24), areas: list(group.areas).map(area => text(area, 32)).filter(Boolean).slice(0, 4),
            agent: group.model || group.provider || group.agentLease ? agentOf(group) : undefined, branch: text(group.branch, 80),
            since: time(since[id]?.to === group.state ? since[id].at : undefined), startedAt: time(group.startedAt),
            pr: Number(group.pr) || undefined, prUrl: prUrl(group.pr), prState: text(String(pr?.state ?? ''), 16),
            autoMerge: pr ? pr.autoMerge === true : undefined, checks: text(typeof checks === 'string' ? checks : checks?.state, 24),
            session: sessionLink(group.agentLease?.sessionUrl) ?? sessionLink(group.sessionLink),
            working: group.agentLease?.state === 'working' && live.length ? time(Math.max(0, ...live.map(record => record.renewedAt ?? 0)) || undefined) : undefined,
            note: text(group.note, 280)
        });
    }

    // What needs the person
    const attention = [];
    const comment = item => ({ number: Number(item.number) || undefined, link: link(item.link) });
    for (const item of Object.values(items)) {
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item.writePending) && item.writePending.length) attention.push({ kind: 'write', label: 'uier write failed', ...comment(item) });
        if (item.stage === 'done') continue;
        if (item.decision === 'asked') attention.push({ kind: 'asked', label: 'Question waiting for an answer', ...comment(item), note: text(item.question ?? item.reason, 200) });
        else if (item.stage === 'ready') attention.push({ kind: 'verify', label: 'Ready to verify', ...comment(item), note: text(item.reason, 200) });
    }
    for (const entry of pipeline) if (entry.stage === 'blocked') attention.push({ kind: 'blocked', label: 'Blocked', number: entry.comments[0]?.number, link: entry.comments[0]?.link, note: entry.note });

    // Health
    const health = [];
    const free = diskFreeGiB(text(state.repo?.root, 1024));
    if (status === 'down') health.push({ level: 'warn', text: 'The watcher is not running, so nothing wakes the orchestrator', since: time(touched || undefined) });
    if (status === 'stale') health.push({ level: 'bad', text: 'The watcher has not checked in', since: time(heartbeat) });
    if (notification.failingSince) health.push({ level: 'bad', text: `Wake delivery is failing (${Number(notification.failures) > 1 ? `${Number(notification.failures)} tries` : '1 try'}); events are kept`, since: time(notification.failingSince) });
    else if (notification.deliveredAt && loud.length && now - notification.deliveredAt > 10 * MINUTE)
        health.push({ level: 'warn', text: 'A wake was delivered but not taken yet (a busy or stopped thread, or a usage limit)', since: time(notification.deliveredAt) });
    if (text(seen.pollError)) health.push({ level: 'warn', text: `Polling fails: ${text(seen.pollError, 160)}` });
    if (seen.leases === 'unsupported') health.push({ level: 'warn', text: 'The watcher token cannot show the working spinner (it lacks Assign feedback).' });
    // Monitors on one disk share this warning; the page shows it once.
    if (free !== null && free < 15) health.push({ level: 'warn', machine: true, text: `Low disk space: ${free} GiB free. Sessions need room for their worktrees.` });
    const limits = Object.entries(state.limits && typeof state.limits === 'object' ? state.limits : {})
        .filter(([, limit]) => Date.parse(limit?.until ?? '') > now).map(([provider, limit]) => ({ provider: text(provider, 40), until: time(limit.until) }));
    for (const limit of limits) health.push({ level: 'warn', text: `Usage limit on ${limit.provider}`, until: limit.until });

    // What it is waiting on
    const used = groups.filter(([, group]) => SLOT_STATES.has(group.state)).length;
    const count = stage => pipeline.filter(entry => entry.stage === stage).length;
    const waiting = [];
    if (status === 'stopped') waiting.push({ key: 'stopped', text: `Nothing: stopped${text(settings.stoppedBy, 60) ? ` (${text(settings.stoppedBy, 60)})` : ''}` });
    else if (status === 'inactive') waiting.push({ key: 'inactive', text: 'Nothing: no watcher has run', since: time(touched || undefined) });
    else {
        if (loud.length) waiting.push({ key: 'orchestrator', text: `The orchestrator, to handle ${plural(loud.length, 'event')}`, since: time(Math.min(...loud.map(event => Date.parse(event.foundAt ?? '') || now))) });
        if (used) waiting.push({ key: 'sessions', text: `${plural(used, 'session')} working` });
        if (count('pr')) waiting.push({ key: 'prs', text: `${plural(count('pr'), 'pull request')} to merge` });
        if (count('deploying')) waiting.push({ key: 'deploys', text: `${plural(count('deploying'), 'deploy')} to finish` });
        if (attention.length) waiting.push({ key: 'you', text: `You, on ${plural(attention.length, 'comment')}` });
        if (Date.parse(settings.wakeAt ?? '') > now) waiting.push({ key: 'timer', text: 'A timer', until: time(settings.wakeAt) });
        if (!waiting.length) waiting.push({ key: 'feedback', text: 'New feedback' });
    }
    // A watcher with nothing in progress is waiting, not working.
    if (status === 'running' && waiting[0].key === 'feedback') status = 'waiting';

    // Groups that left the pipeline in the last minutes, so the page can show how they ended.
    const ended = {};
    for (const event of events) {
        if (event.type !== 'group' || typeof event.group !== 'string' || now - Date.parse(event.at ?? '') > 10 * MINUTE) continue;
        const group = state.groups?.[event.group];
        if (group && !pipeline.some(entry => entry.id === event.group)) ended[text(event.group, 40)] = text(group.state, 24);
    }

    // Metrics
    const closed = Object.values(items).filter(item => item?.stage === 'done' && item.decision !== 'skipped')
        .map(item => Date.parse(item.closedAt ?? '')).filter(at => now - at < 14 * DAY && at <= now);
    const cycles = groups.flatMap(([, group]) => {
        const start = Date.parse(group.startedAt ?? '');
        const end = Math.max(...list(group.items).map(item => Date.parse(items[item]?.closedAt ?? '') || 0), 0);
        return FINISHED.has(group.state) && start && end > start && now - end < 7 * DAY ? [(end - start) / MINUTE] : [];
    });
    const recent = events.filter(event => now - Date.parse(event.at ?? '') < DAY);
    const cycle = median(cycles);

    // The orchestrator's T3 thread, when a session link shows which T3 environment this is.
    const environment = /^t3-thread:\/\/v2\/([\w-]+)\//.exec(groups.map(([, group]) => group.agentLease?.sessionUrl).find(url => typeof url === 'string') ?? '')?.[1];
    const thread = text(state.harness?.threadId, 200);

    return {
        id: createHash('sha256').update(dir).digest('hex').slice(0, 12), dir,
        project: { id: text(state.project?.id, 64), name: text(state.project?.name, 120), site: link(state.project?.site) },
        repo: { slug, base: text(state.repo?.base, 80) },
        workflow: { mode: text(state.workflow?.mode, 12), autoMerge: state.workflow?.autoMerge === true },
        harness: { kind: text(state.harness?.kind, 24), thread: environment && thread ? sessionLink(`t3-thread://v2/${environment}/${thread}`) : undefined },
        status,
        watcher: { pid: running ? pid : undefined, version: text(running ? pidFile?.version : undefined, 16), persistent: running ? pidFile?.persistent === true : undefined,
            startedAt: running ? time(pidFile?.startedAt) : undefined, heartbeatAt: time(heartbeat), reconciledAt: time(seen.reconciledAt) },
        note: text(settings.note, 320), updatedAt: time(state.updatedAt), wakes: Number(settings.wakes) || 0,
        slots: { used, max: Number(state.max) || 6 }, inbox: { total: inbox.length, loud: loud.length }, diskFreeGiB: free,
        health, waiting, pipeline, attention, ended,
        deploys: pending.slice(0, 20).map(entry => ({ pr: Number(entry.pr) || undefined, prUrl: prUrl(entry.pr), sha: text(entry.sha, 7) })),
        metrics: {
            closed: closed.map(at => new Date(at).toISOString()),
            closed24h: closed.filter(at => now - at < DAY).length,
            cycleMinutes: cycle === null ? null : Math.round(cycle), cycleGroups: cycles.length,
            journal: events.length > 0,
            wakes24h: recent.filter(event => event.type === 'wake' && event.delivered !== false).length,
            quiet24h: recent.filter(event => event.quiet === true).length,
            done: Object.values(items).filter(item => item?.stage === 'done' && item.decision !== 'skipped').length,
            open: Object.values(items).filter(item => item?.decision === 'accepted' && item.stage !== 'done').length
        },
        activity: (events.length ? events.slice(-80).map(activityEntry) : [...logLines(dir)]).reverse()
    };
}

const ORDER = { running: 0, handling: 0, waiting: 1, stale: 2, down: 3, stopped: 4, inactive: 5 };

/** Every monitor on this machine, most active first. */
export function collect(options = {}) {
    const now = options.now ?? Date.now();
    const monitors = discover(options).map(dir => { try { return snapshot(dir, now); } catch { return null; } }).filter(Boolean)
        .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return { app: APP, version: VERSION, build: BUILD, monitors };
}

// ---------------------------------------------------------------- server

/**
 * Answers the dashboard's requests. Loopback binds answer only to loopback host names (no DNS
 * rebinding). `close(true)` tells open pages to reload before it lets them go.
 */
export function createHandler(options = {}) {
    const host = options.host ?? '127.0.0.1';
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
    const clients = new Set();
    let last = '';
    const current = () => JSON.stringify(collect(options));
    const timer = setInterval(() => {
        if (!clients.size) return;
        const next = current();
        for (const response of clients) response.write(next === last ? ': ping\n\n' : `data: ${next}\n\n`);
        last = next;
    }, options.intervalMs ?? 2000);
    timer.unref();
    const handle = (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const send = (status, type, body, extra = {}) => {
            response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
            response.end(body);
        };
        const name = String(request.headers.host ?? '').replace(/:\d+$/, '');
        if (loopback && !['127.0.0.1', 'localhost', '[::1]'].includes(name)) return send(403, 'text/plain', 'Forbidden\n');
        if (request.method !== 'GET') return send(405, 'text/plain', 'Read-only\n', { allow: 'GET' });
        if (url.pathname === '/') {
            const nonce = randomBytes(16).toString('base64');
            return send(200, 'text/html; charset=utf-8', PAGE.replaceAll('__NONCE__', nonce).replace('__BUILD__', BUILD), { 'content-security-policy':
                `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
        }
        if (url.pathname === '/api/ping') return send(200, 'application/json', JSON.stringify({ app: APP, version: VERSION, build: BUILD }));
        if (url.pathname === '/api/snapshot') return send(200, 'application/json', current());
        if (url.pathname === '/api/stream') {
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'keep-alive' });
            response.write(`retry: 1000\n\ndata: ${current()}\n\n`);
            clients.add(response);
            request.on('close', () => clients.delete(response));
            return undefined;
        }
        return send(404, 'text/plain', 'Not found\n');
    };
    const close = (reload = false) => {
        clearInterval(timer);
        for (const response of clients) response.end(reload ? 'event: reload\ndata: now\n\n' : undefined);
        clients.clear();
    };
    return { handle, close };
}

/** The dashboard's HTTP server. */
export function createDashboardServer(options = {}) {
    const handler = createHandler(options);
    const server = createServer(handler.handle);
    server.on('close', () => handler.close());
    return server;
}

/**
 * The server for work on the dashboard itself (`--dev`): it answers with whatever this file says
 * now. When the file changes it is imported again, the new code takes over on the same port and
 * open pages reload themselves. An edit that does not load leaves the previous code serving.
 */
export function createDevServer(options = {}, log = console.log) {
    const file = fileURLToPath(import.meta.url);
    let active = createHandler(options);
    let loads = 0;
    const reload = async () => {
        try {
            const fresh = await import(`${pathToFileURL(file).href}?dev=${++loads}-${Date.now()}`);
            const previous = active;
            active = fresh.createHandler(options);
            previous.close(true);
            log(`${new Date().toLocaleTimeString()} reloaded (build ${fresh.BUILD})`);
        } catch (error) {
            log(`${new Date().toLocaleTimeString()} not reloaded, still serving the last good code: ${error?.message ?? error}`);
        }
    };
    watchFile(file, { interval: 200 }, reload);
    const server = createServer((request, response) => {
        try { active.handle(request, response); }
        catch (error) {
            log(`${new Date().toLocaleTimeString()} request failed: ${error?.stack ?? error}`);
            if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
            response.end(`${error?.stack ?? error}\n`);
        }
    });
    server.on('close', () => { unwatchFile(file, reload); active.close(); });
    return server;
}

// ---------------------------------------------------------------- command line

function parseArgs(argv) {
    const options = { states: [], command: 'serve' };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const value = () => { if (argv[index + 1] === undefined) throw new Error(`${arg} needs a value.`); return argv[++index]; };
        if (arg === '--state') options.states.push(value());
        else if (arg === '--port') options.port = Number(value());
        else if (arg === '--host') options.host = value();
        else if (['--open', '--detach', '--json', '--dev'].includes(arg)) options[arg.slice(2)] = true;
        else if (arg === '--help' || arg === '-h' || arg === 'help') options.command = 'help';
        else if (arg === 'stop' || arg === 'serve') options.command = arg;
        else throw new Error(`Unknown option "${arg}". Run: node dashboard.mjs help`);
    }
    if (options.port !== undefined && !(Number.isInteger(options.port) && options.port >= 0 && options.port < 65536)) throw new Error('--port needs a port number.');
    return options;
}

async function ping(url) {
    try {
        const response = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1500) });
        return (await response.json()).app === APP;
    } catch { return false; }
}

const recordFile = () => join(monitorHome(), 'dashboard.json');
const readRecord = () => { try { return JSON.parse(readFileSync(recordFile(), 'utf8')); } catch { return null; } };

function openBrowser(url) {
    const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    try { spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* no browser to open */ }
}

async function serve(options) {
    const host = options.host ?? '127.0.0.1';
    const shown = host.includes(':') ? `[${host}]` : host;
    const first = options.port ?? DEFAULT_PORT;
    const record = readRecord();
    // One dashboard shows every monitor, so a second one would only take another port.
    if (options.port === undefined && record?.url && alive(record.pid) && await ping(record.url)) {
        console.log(`The dashboard is already running: ${record.url}`);
        if (options.open) openBrowser(record.url);
        return;
    }
    if (options.detach) {
        const args = [fileURLToPath(import.meta.url), 'serve', '--host', host, ...(options.port === undefined ? [] : ['--port', String(options.port)]),
            ...(options.dev ? ['--dev'] : []), ...options.states.flatMap(dir => ['--state', resolve(dir)])];
        const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
        child.unref();
        for (let wait = 0; wait < 40; wait++) {
            await sleep(100);
            const started = readRecord();
            if (started?.pid === child.pid) {
                console.log(`uier monitor dashboard: ${started.url} (pid ${child.pid}). Stop it with: node dashboard.mjs stop`);
                if (options.open) openBrowser(started.url);
                return;
            }
        }
        throw new Error('The dashboard did not start.');
    }
    const server = (options.dev ? createDevServer : createDashboardServer)({ ...options, host });
    let port = first;
    for (;;) {
        const error = await new Promise(done => { server.once('error', done); server.listen(port, host, () => { server.removeListener('error', done); done(null); }); });
        if (!error) break;
        // An explicit port is a request for that port; the default moves on to the next free one.
        if (error.code !== 'EADDRINUSE' || options.port !== undefined || port - first >= 20) throw error;
        port++;
    }
    const url = `http://${shown}:${server.address().port}`;
    mkdirSync(monitorHome(), { recursive: true });
    const temporary = `${recordFile()}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ pid: process.pid, url, startedAt: new Date().toISOString() })}\n`);
    renameSync(temporary, recordFile());
    const release = () => { if (readRecord()?.pid === process.pid) rmSync(recordFile(), { force: true }); };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { release(); process.exit(0); });
    process.on('exit', release);
    const total = collect(options).monitors.length;
    console.log(`uier monitor dashboard: ${url} (${plural(total, 'monitor')}). Read-only; press Ctrl+C to stop.`);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.log(`Bound to ${host}: everyone who can reach this address can read the page.`);
    if (options.dev) console.log('Watching dashboard.mjs: an edit swaps in the new code and reloads open pages.');
    if (options.open) openBrowser(url);
}

function stop() {
    const record = readRecord();
    if (!record?.pid || !alive(record.pid)) { rmSync(recordFile(), { force: true }); console.log('not running'); return; }
    process.kill(record.pid, 'SIGTERM');
    console.log(`stopped ${record.pid}`);
}

async function main(argv) {
    const options = parseArgs(argv);
    if (options.command === 'help') console.log(HELP);
    else if (options.command === 'stop') stop();
    else if (options.json) console.log(JSON.stringify(collect(options), null, 1));
    else await serve(options);
}

// ---------------------------------------------------------------- the page
// One self-contained document: no external requests, no framework. The colours are the uier brand
// tokens (packages/brand/tokens.css in the uier repository; dashboard.test.mjs keeps them equal).
// The script builds the DOM with textContent only, so nothing from a monitor is parsed as HTML.

export const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>uier monitor</title>
<link rel="icon" href="data:,">
<style nonce="__NONCE__">
:root {
    --background: 0 0% 100%;
    --foreground: 0 0% 4%;
    --card: 0 0% 100%;
    --secondary-foreground: 0 0% 25%;
    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 44%;
    --border: 0 0% 90%;
    --ring: 227 100% 59%;
    --destructive: 0 72% 51%;
    --brand-accent-text: 227 100% 59%;
    --brand-success: 142 72% 29%;
    --brand-warning: 26 90% 37%;
    --brand-in-progress: 200 98% 39%;
    --brand-ready: 262 83% 58%;
}
@media (prefers-color-scheme: dark) {
    :root {
        --background: 0 0% 0%;
        --foreground: 0 0% 93%;
        --card: 0 0% 4%;
        --secondary-foreground: 0 0% 83%;
        --muted: 0 0% 9%;
        --muted-foreground: 0 0% 64%;
        --border: 0 0% 15%;
        --ring: 227 100% 59%;
        --destructive: 0 72% 51%;
        --brand-accent-text: 225 100% 74%;
        --brand-success: 142 71% 45%;
        --brand-warning: 38 92% 50%;
        --brand-in-progress: 198 93% 60%;
        --brand-ready: 255 92% 76%;
    }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: hsl(var(--background)); color: hsl(var(--foreground)); font: 14px/1.45 Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: inherit; text-decoration: underline; text-decoration-color: hsl(var(--border)); text-underline-offset: 3px; }
a:hover { text-decoration-color: currentColor; }
:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; border-radius: 4px; }
h1, h2, h3, p { margin: 0; }
[data-list] { position: relative; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 20px 16px 48px; }
.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 16px; }
.top h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
.muted { color: hsl(var(--muted-foreground)); }
.right { margin-left: auto; }
.num { font-variant-numeric: tabular-nums; }
.ico { flex: none; width: 14px; height: 14px; vertical-align: -2px; }
.link, .who, .agent { display: inline-flex; align-items: center; gap: 4px; }
.who a + a { margin-left: 2px; }
.dot { --dot: var(--muted-foreground); display: inline-block; flex: none; width: 6px; height: 6px; border-radius: 50%; background: hsl(var(--dot)); vertical-align: middle; transition: background-color 0.4s, box-shadow 0.4s; }
.dot.ring { background: none; box-shadow: inset 0 0 0 1px hsl(var(--foreground)); }
.dot.idle { background: none; box-shadow: inset 0 0 0 1.5px hsl(var(--brand-success)); }
.dot.good { --dot: var(--brand-success); }
.dot.work { --dot: var(--brand-in-progress); }
.dot.merged { --dot: var(--brand-ready); }
.dot.warn { --dot: var(--brand-warning); }
.dot.bad { --dot: var(--destructive); }
.dot.live { animation: pulse 1.8s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 hsl(var(--dot) / 0.55); } 70%, 100% { box-shadow: 0 0 0 6px hsl(var(--dot) / 0); } }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 1px 8px; border: 1px solid hsl(var(--border)); border-radius: 999px; font-size: 12px; white-space: nowrap; }
.machine { display: grid; gap: 6px; margin-bottom: 12px; }
.machine:empty { display: none; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 12px; }
.tile { padding: 10px 12px; border: 1px solid hsl(var(--border)); border-radius: 12px; background: hsl(var(--card)); }
.tile .label { font-size: 12px; color: hsl(var(--muted-foreground)); }
.tile .value { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
.tile .sub { font-size: 12px; color: hsl(var(--muted-foreground)); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr)); gap: 12px; align-items: start; }
.monitor { display: grid; gap: 10px; align-content: start; min-width: 0; padding: 14px 16px; border: 1px solid hsl(var(--border)); border-radius: 16px; background: hsl(var(--card)); transition: opacity 0.4s; }
.monitor.expanded { grid-column: 1 / -1; }
.monitor.resting { opacity: 0.55; }
.monitor.resting:hover, .monitor.resting:focus-within, .monitor.resting.expanded { opacity: 1; }
.mhead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mhead h2 { flex: 1; min-width: 0; overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.where { margin-top: -8px; font-size: 12px; }
.slots { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap; }
.pips { display: inline-flex; gap: 3px; }
.pip { width: 8px; height: 8px; border: 1px solid hsl(var(--border)); border-radius: 2px; transition: background-color 0.4s, border-color 0.4s; }
.pip.on { border-color: transparent; background: hsl(var(--brand-in-progress)); }
.alert { display: flex; align-items: baseline; gap: 8px; padding: 5px 10px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); font-size: 13px; }
.alert .dot { position: relative; top: -2px; }
.line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.eyebrow { flex: none; min-width: 76px; font-size: 12px; color: hsl(var(--muted-foreground)); }
.chips { display: flex; flex: 1; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: hsl(var(--muted)); color: hsl(var(--secondary-foreground)); font-size: 13px; }
.work { display: grid; gap: 3px; }
.work .row { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: baseline; gap: 8px; padding: 5px 10px; border-radius: 8px; background: hsl(var(--muted)); font-size: 13px; overflow-wrap: anywhere; }
.stage { display: inline-flex; align-items: center; gap: 6px; border-radius: 4px; font-size: 12px; font-weight: 500; }
.what { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1px 10px; min-width: 0; }
.who { font-weight: 500; }
.agent .level { color: hsl(var(--muted-foreground)); }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.more { justify-self: start; padding: 2px 0; border: 0; background: none; color: hsl(var(--muted-foreground)); font: inherit; font-size: 12px; text-decoration: underline; text-decoration-color: hsl(var(--border)); text-underline-offset: 3px; cursor: pointer; }
.more:hover { color: hsl(var(--foreground)); text-decoration-color: currentColor; }
.details { display: grid; gap: 14px; padding-top: 12px; border-top: 1px solid hsl(var(--border)); }
.pipeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; align-items: start; }
.column { display: grid; gap: 6px; min-width: 0; padding: 8px; border-radius: 12px; background: hsl(var(--muted)); }
.column h3 { display: flex; align-items: center; gap: 6px; padding: 0 4px; font-size: 12px; font-weight: 500; }
.column .empty { padding: 0 4px 2px; font-size: 12px; color: hsl(var(--muted-foreground)); }
.card { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--card)); overflow-wrap: anywhere; }
.card .head { display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; font-weight: 500; }
.card .meta { display: flex; flex-wrap: wrap; gap: 0 8px; font-size: 12px; color: hsl(var(--muted-foreground)); }
.card .agent { color: hsl(var(--foreground)); }
.card .note { font-size: 12px; color: hsl(var(--secondary-foreground)); }
.needs { display: grid; gap: 4px; }
.needs .row { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; }
.split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; }
@media (max-width: 800px) { .split { grid-template-columns: minmax(0, 1fr); } }
.panel h3 { margin-bottom: 6px; font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.panel .chart + h3 { margin-top: 14px; }
.feed { max-height: 280px; overflow: auto; border: 1px solid hsl(var(--border)); border-radius: 12px; }
.feed .row { display: flex; gap: 10px; padding: 5px 10px; border-top: 1px solid hsl(var(--border)); background: hsl(var(--card)); font-size: 13px; overflow-wrap: anywhere; }
.feed .row:first-child { border-top: 0; }
.feed time { flex: none; width: 44px; color: hsl(var(--muted-foreground)); font-variant-numeric: tabular-nums; }
.feed .quiet { color: hsl(var(--muted-foreground)); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart .bar { fill: hsl(var(--muted-foreground)); }
.chart .bar.today { fill: hsl(var(--foreground)); }
.chart .hit { fill: transparent; cursor: default; }
.chart .hit:hover + .bar, .chart .hit:focus-visible + .bar { fill: hsl(var(--brand-accent-text)); }
.chart .axis { stroke: hsl(var(--border)); stroke-width: 1; }
.chart text { fill: hsl(var(--muted-foreground)); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart text.value { fill: hsl(var(--foreground)); }
.tip { position: absolute; z-index: 1; padding: 3px 8px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); font-size: 12px; white-space: nowrap; pointer-events: none; transform: translate(-50%, -100%); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.blank { grid-column: 1 / -1; padding: 40px 16px; border: 1px dashed hsl(var(--border)); border-radius: 16px; text-align: center; color: hsl(var(--muted-foreground)); }
code { font: 12px/1.4 "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } .dot, .pip, .monitor { transition: none; } }
</style>
</head>
<body>
<div class="wrap">
    <header class="top">
        <h1>uier monitor</h1>
        <span class="muted" id="summary">Loading</span>
        <span class="badge right" id="live"><i class="dot ring"></i><span>Connecting</span></span>
    </header>
    <div class="machine" id="machine" data-list></div>
    <section class="tiles" id="tiles" data-list aria-label="All monitors"></section>
    <main class="grid" id="monitors" data-list></main>
</div>
<script nonce="__NONCE__">
'use strict';
var SVG = 'http://www.w3.org/2000/svg';
var BUILD = '__BUILD__';
var data = null;
var opened = {};
var restore = 0;     // where the page was scrolled to before it reloaded itself
// Open cards and the scroll position survive a reload: the page reloads itself when the code behind it changes.
try { var saved = JSON.parse(sessionStorage.getItem('uier-monitor') || '{}'); opened = saved.opened || {}; restore = saved.scroll || 0; } catch (error) { /* private mode */ }
function remember() { try { sessionStorage.setItem('uier-monitor', JSON.stringify({ opened: opened, scroll: window.scrollY })); } catch (error) { /* private mode */ } }
function reload() { remember(); location.reload(); }
var ready = false;   // the first paint appears at once; only later changes move
var moving = false;  // whether this update animates
var abrupt = false;  // a person's own toggle: what it removes goes at once, without a ghost over the new content
var changed = [];    // keyed elements whose state changed in this update
var flashes = [];    // elements whose own words changed in this update
var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
var slice = function (nodes) { return Array.prototype.slice.call(nodes); };

// ---------------------------------------------------------------- building nodes

function h(tag, attrs) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) {
        var value = attrs[key];
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (var index = 2; index < arguments.length; index++) add(node, arguments[index]);
    return node;
}
function add(node, child) {
    if (child === undefined || child === null || child === false || child === '') return;
    if (Array.isArray(child)) child.forEach(function (one) { add(node, one); });
    else node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
}
function s(tag, attrs) {
    var node = document.createElementNS(SVG, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
}

// Outlined icons are Lucide's (ISC). The agent marks are the ones uier draws: Claude, OpenAI and
// Cursor from Simple Icons (CC0), one colour, in the text colour.
var ICONS = {
    pr: ['M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M13 6h3a2 2 0 0 1 2 2v7', 'M6 9v12'],
    comment: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    session: ['M7 7h10v10', 'M7 17 17 7'],
    agent: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2']
};
var MARKS = {
    claude: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    openai: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
    cursor: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23'
};
function icon(name) {
    var filled = MARKS[name];
    var svg = s('svg', filled ? { class: 'ico', viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' }
        : { class: 'ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
    (filled ? [filled] : ICONS[name]).forEach(function (d) { svg.appendChild(s('path', { d: d })); });
    return svg;
}
function anchor(href, label, mark) {
    var inside = [mark ? icon(mark) : null, label];
    return href ? h('a', { class: 'link', href: href, target: href.indexOf('http') === 0 ? '_blank' : null, rel: 'noreferrer noopener' }, inside) : h('span', { class: 'link' }, inside);
}

function plural(count, word) { return count + ' ' + word + (count === 1 ? '' : 's'); }
function span(ms) {
    var seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return seconds + ' s';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + ' h' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '');
    return Math.round(hours / 24) + ' d';
}
function ago(iso) { return iso ? span(Date.now() - Date.parse(iso)) + ' ago' : 'never'; }
function inTime(iso) { return 'in ' + span(Date.parse(iso) - Date.now()); }
function clock(iso) {
    var at = new Date(iso);
    var day = at.toDateString() === new Date().toDateString() ? '' : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ';
    return day + at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}
// A group's comments: the comment icon once, then each number as a link to uier.
function comments(entries) {
    return h('span', { class: 'who' }, icon('comment'), (entries || []).map(function (entry) {
        var label = entry.number ? '#' + entry.number : 'comment';
        return entry.link ? h('a', { href: entry.link, target: '_blank', rel: 'noreferrer noopener', text: label }) : h('span', { text: label });
    }));
}
function agent(entry) {
    if (!entry.agent) return null;
    var words = entry.agent.name + (entry.agent.reasoning ? ', ' + entry.agent.reasoning.toLowerCase() + ' reasoning' : '');
    return h('span', { class: 'agent', title: words }, icon(entry.agent.kind), entry.agent.name,
        entry.agent.reasoning ? h('span', { class: 'level', text: '· ' + entry.agent.reasoning }) : null);
}

var STATUS = {
    running: ['good', 'Running'], waiting: ['idle', 'Waiting'], handling: ['work live', 'Handling a wake'], stale: ['bad', 'Not responding'],
    down: ['warn', 'Watcher not running'], stopped: ['ring', 'Stopped'], inactive: ['ring', 'Inactive']
};
var STAGES = [
    ['queued', 'Queued', 'ring'], ['building', 'Building', 'work'], ['reviewing', 'In review', 'work'],
    ['pr', 'Pull request', 'good'], ['deploying', 'Deploying', 'merged'], ['blocked', 'Blocked', 'bad'], ['other', 'Other', '']
];
function stageOf(key) { return STAGES.find(function (stage) { return stage[0] === key; }) || STAGES[STAGES.length - 1]; }
function active(entry) { return entry.status === 'running' || entry.status === 'handling'; }
// The dot of a group someone is working on right now beats.
function stageDot(item, entry) {
    var busy = active(entry) && (item.stage === 'building' || item.stage === 'reviewing' || item.stage === 'deploying');
    return h('i', { class: 'dot ' + stageOf(item.stage)[2] + (busy ? ' live' : '') });
}
function facts(item) {
    var list = [];
    if (item.state && ['queued', 'building', 'reviewing', 'pr', 'merged', 'blocked'].indexOf(item.state) < 0) list.push(item.state);
    if (item.since) list.push('for ' + span(Date.now() - Date.parse(item.since)));
    else if (item.startedAt && item.stage !== 'queued' && Date.parse(item.startedAt) <= Date.now()) list.push('started ' + ago(item.startedAt));
    if (item.checks) list.push('checks ' + item.checks);
    if (item.autoMerge) list.push('auto-merge on');
    return list;
}
function signature(item) { return [item.stage, item.state, item.pr, item.checks, item.autoMerge].join('|'); }

function tile(label, value, sub) {
    return h('div', { class: 'tile', 'data-key': label }, h('div', { class: 'label', text: label }), h('div', { class: 'value', 'data-flash': true, text: value }), sub ? h('div', { class: 'sub', text: sub }) : null);
}
function alert(item) {
    var when = item.since ? ' · since ' + clock(item.since) + ' (' + ago(item.since) + ')' : item.until ? ' · until ' + clock(item.until) : '';
    return h('div', { class: 'alert', 'data-key': 'alert:' + item.text, role: item.level === 'bad' ? 'alert' : null }, h('i', { class: 'dot ' + (item.level === 'bad' ? 'bad' : 'warn') }), h('span', { text: item.text + when }));
}

// One line per group that is being worked on: the at-a-glance view of a monitor.
function workRow(item, entry) {
    var words = facts(item);
    return h('div', { class: 'row', 'data-key': item.id, 'data-sig': signature(item), title: item.note || null },
        h('span', { class: 'stage', 'data-flash': true }, stageDot(item, entry), stageOf(item.stage)[1]),
        h('span', { class: 'what' }, comments(item.comments), item.pr ? anchor(item.prUrl, 'PR #' + item.pr, 'pr') : null, agent(item),
            words.length ? h('span', { class: 'muted num', text: words.join(', ') }) : null,
            item.session ? anchor(item.session, 'Session', 'session') : null));
}

function card(item, entry) {
    var words = facts(item);
    return h('div', { class: 'card', 'data-key': item.id, 'data-sig': signature(item), title: item.branch || null },
        h('div', { class: 'head' }, comments(item.comments), item.pr ? anchor(item.prUrl, 'PR #' + item.pr, 'pr') : null,
            item.session ? anchor(item.session, 'Session', 'session') : null),
        h('div', { class: 'meta' }, agent(item), [item.class, item.size].filter(Boolean).join(' · ')),
        words.length ? h('div', { class: 'meta num', text: words.join(' · ') }) : null,
        item.note ? h('div', { class: 'note clamp', title: item.note, text: item.note }) : null);
}

function sentence(entry) {
    var numbers = (entry.numbers || []).map(function (number) { return '#' + number; }).join(' ');
    var pr = entry.pr ? 'PR #' + entry.pr : '';
    var number = entry.number ? '#' + entry.number : 'a comment';
    switch (entry.type) {
        case 'log': return entry.text;
        case 'watcher': return entry.event === 'started' ? 'Watcher started' + (entry.version ? ' (version ' + entry.version + ')' : '') : 'Watcher stopped' + (entry.by ? ' (' + entry.by + ')' : '');
        case 'wake': return entry.delivered === false ? 'Wake delivery failed; ' + plural(entry.events || 0, 'event') + ' kept' : 'Woke the orchestrator with ' + plural(entry.events || 0, 'event');
        case 'taken': return 'The orchestrator took ' + plural(entry.events || 0, 'event');
        case 'group': return [entry.group, numbers].filter(Boolean).join(' ') + ': ' + (entry.from ? entry.from + ' → ' : '') + entry.to + (pr ? ' (' + pr + ')' : '');
        case 'item': return number + ' ' + entry.field + ': ' + (entry.from ? entry.from + ' → ' : '') + entry.to;
        case 'merged': return pr + ' merged' + (entry.sha ? ' as ' + entry.sha : '');
        case 'deployed': return pr + ' deployed' + (entry.sha ? ' (' + entry.sha + ')' : '');
        case 'closed': return 'Closed the comments of ' + pr + ' after its deploy';
        case 'close-failed': return 'Could not close ' + (entry.number ? number : 'the comments of ' + pr) + (entry.code ? ' (' + entry.code + ')' : '');
        case 'deploy-failed': return 'The deploy of ' + pr + ' failed';
        case 'deploy-missing': return 'No deploy found for ' + pr;
        case 'pr': return pr + ': ' + [entry.state, entry.checks ? 'checks ' + entry.checks : ''].filter(Boolean).join(', ');
        case 'pr-closed': return pr + ' was closed without merging';
        case 'new': return 'New comment ' + number;
        case 'untracked': return 'Comment ' + number + ' is not tracked yet';
        case 'reply': return 'Reply on ' + number;
        case 'mention': return 'Mention on ' + number;
        case 'status': return number + ' status: ' + (entry.change || 'changed');
        case 'reopened': return number + ' reopened';
        case 'assignment': case 'assigned': return number + ' assignment changed';
        case 'agent': return number + ' agent changed';
        case 'drift': return number + ' is ' + (entry.actual || '?') + ' in uier, expected ' + (entry.expected || '?');
        case 'timer': return 'Timer fired';
        case 'heartbeat': return 'Routine check';
        case 'poll-uier': return 'Asked the orchestrator to poll uier (no watcher token)';
        case 'error': case 'auth-error': case 'lease-error': case 'lease-unsupported': return (entry.type === 'auth-error' ? 'uier sign-in failed' : 'Error') + (entry.message ? ': ' + entry.message : '');
        default: return [entry.type, entry.number ? number : '', pr].filter(Boolean).join(' ');
    }
}

function chart(closed) {
    var days = [];
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var back = 13; back >= 0; back--) { var day = new Date(today); day.setDate(today.getDate() - back); days.push({ at: day, count: 0 }); }
    (closed || []).forEach(function (iso) {
        var at = new Date(iso); at.setHours(0, 0, 0, 0);
        var slot = days.find(function (entry) { return entry.at.getTime() === at.getTime(); });
        if (slot) slot.count++;
    });
    var max = Math.max.apply(null, days.map(function (entry) { return entry.count; }));
    var label = function (entry) { return entry.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
    var width = 420, height = 120, top = 16, bottom = 18, band = width / days.length, bar = Math.min(24, band - 2), plot = height - top - bottom;
    // Replaced as a whole when a number changes: its hover handlers hold the numbers they were drawn with.
    var box = h('div', { class: 'chart', 'data-atomic': true });
    var svg = s('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Comments closed per day, last 14 days' });
    var tip = h('div', { class: 'tip', hidden: true });
    var peak = days.reduce(function (best, entry) { return entry.count > best.count ? entry : best; }, days[0]);
    days.forEach(function (entry, index) {
        var x = index * band + (band - bar) / 2, size = max ? Math.round(entry.count / max * plot) : 0, y = top + plot - size, last = index === days.length - 1;
        var words = label(entry) + ': ' + plural(entry.count, 'comment') + ' closed';
        var hit = s('rect', { class: 'hit', x: index * band, y: 0, width: band, height: height - bottom, tabindex: 0, 'aria-label': words });
        var show = function () { tip.textContent = words; tip.hidden = false; tip.style.left = ((index + 0.5) / days.length * 100) + '%'; tip.style.top = (Math.max(top, y) / height * 100) + '%'; };
        var hide = function () { tip.hidden = true; };
        hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show);
        hit.addEventListener('mouseleave', hide); hit.addEventListener('blur', hide);
        svg.appendChild(hit);
        var radius = Math.min(4, size);
        svg.appendChild(s('path', { class: 'bar' + (last ? ' today' : ''), d: size ? 'M' + x + ' ' + (top + plot) + 'V' + (y + radius) + 'q0 ' + -radius + ' ' + radius + ' ' + -radius + 'H' + (x + bar - radius) + 'q' + radius + ' 0 ' + radius + ' ' + radius + 'V' + (top + plot) + 'Z' : '' }));
        if (entry.count && (entry === peak || last)) { var value = s('text', { class: 'value', x: x + bar / 2, y: y - 4, 'text-anchor': 'middle' }); value.textContent = entry.count; svg.appendChild(value); }
        if (index === 0 || index === 7 || last) { var tick = s('text', { x: last ? width : index ? x + bar / 2 : 0, y: height - 4, 'text-anchor': last ? 'end' : index ? 'middle' : 'start' }); tick.textContent = last ? 'Today' : label(entry); svg.appendChild(tick); }
    });
    svg.appendChild(s('line', { class: 'axis', x1: 0, x2: width, y1: top + plot + 0.5, y2: top + plot + 0.5 }));
    box.appendChild(svg); box.appendChild(tip);
    box.appendChild(h('table', { class: 'sr' }, h('caption', { text: 'Comments closed per day' }),
        h('tbody', null, days.map(function (entry) { return h('tr', null, h('th', { scope: 'row', text: label(entry) }), h('td', { text: entry.count })); }))));
    return box;
}

function details(entry) {
    var links = [entry.harness.thread ? anchor(entry.harness.thread, 'Orchestrator thread', 'session') : null, entry.project.site ? anchor(entry.project.site, 'Site') : null];
    var columns = STAGES.filter(function (stage) { return stage[0] !== 'other' && stage[0] !== 'blocked' || entry.pipeline.some(function (item) { return item.stage === stage[0]; }); });
    var seen = {};
    var feed = h('div', { class: 'feed', 'data-list': true, tabindex: 0, 'aria-label': 'Activity' }, entry.activity.length ? entry.activity.map(function (item) {
        var words = sentence(item) + (item.quiet ? ' · no wake needed' : '');
        var key = item.at + '|' + words;
        seen[key] = (seen[key] || 0) + 1;
        return h('div', { class: 'row' + (item.quiet ? ' quiet' : ''), 'data-key': key + '|' + seen[key] },
            h('time', { datetime: item.at, title: item.at ? new Date(item.at).toLocaleString() : null, text: item.at ? clock(item.at) : '' }), h('span', { text: words }));
    }) : h('div', { class: 'row muted', 'data-key': '~none', text: 'Nothing recorded yet.' }));
    var metrics = entry.metrics;
    var cycle = metrics.cycleMinutes === null ? 'No data' : span(metrics.cycleMinutes * 60000);
    return h('div', { class: 'details', 'data-key': 'details', 'data-list': true },
        h('div', { class: 'line muted', 'data-key': 'watcher' }, h('span', { class: 'eyebrow', text: 'Watcher' }),
            h('span', { class: 'num', text: [entry.watcher.version ? 'version ' + entry.watcher.version : '', entry.watcher.persistent === undefined ? '' : entry.watcher.persistent ? 'persistent' : 'one-shot',
                entry.watcher.heartbeatAt ? 'checked in ' + ago(entry.watcher.heartbeatAt) : '', plural(entry.wakes, 'wake'),
                entry.inbox.total ? plural(entry.inbox.total, 'event') + ' in the inbox' : '', entry.diskFreeGiB === null ? '' : entry.diskFreeGiB + ' GiB free'].filter(Boolean).join(' · ') }), links),
        h('div', { class: 'pipeline', 'data-key': 'pipeline', 'data-list': true }, columns.map(function (stage) {
            var cards = entry.pipeline.filter(function (item) { return item.stage === stage[0]; });
            return h('section', { class: 'column', 'data-key': stage[0], 'data-list': true, 'data-exit': 'finish' },
                h('h3', { 'data-key': '~head' }, h('i', { class: 'dot ' + stage[2] }), stage[1], h('span', { class: 'muted num', 'data-flash': true, text: cards.length })),
                cards.length ? cards.map(function (item) { return card(item, entry); }) : h('div', { class: 'empty', 'data-key': '~empty', text: 'Nothing here' }));
        })),
        entry.attention.length ? h('section', { class: 'panel', 'data-key': 'needs' }, h('h3', { text: 'Needs you' }), h('div', { class: 'needs', 'data-list': true }, entry.attention.map(function (item) {
            return h('div', { class: 'row', 'data-key': item.kind + ':' + item.number }, anchor(item.link, item.number ? '#' + item.number : 'Comment', 'comment'), h('span', { text: item.label }), item.note ? h('span', { class: 'muted', text: item.note }) : null);
        }))) : null,
        h('div', { class: 'split', 'data-key': 'split' },
            h('section', { class: 'panel' }, h('h3', { text: metrics.journal ? 'Activity' : 'Activity (watcher log; the history starts with watcher 1.5.0)' }), feed),
            h('section', { class: 'panel' }, h('h3', { text: 'Comments closed per day, last 14 days' }), chart(metrics.closed),
                h('h3', { text: 'Numbers' }), h('div', { class: 'stats', 'data-list': true },
                    tile('Closed, last 24 h', metrics.closed24h, plural(metrics.done, 'comment') + ' in total'),
                    tile('Start to close, median', cycle, metrics.cycleGroups ? plural(metrics.cycleGroups, 'group') + ', last 7 days' : 'last 7 days'),
                    metrics.journal ? tile('Wakes, last 24 h', metrics.wakes24h, plural(metrics.quiet24h, 'event') + ' handled without one') : null))));
}

// A monitor's card. Collapsed it is the overview: status, what it waits on and every group in
// progress, so several monitors fit one screen. Details adds notes, history and numbers.
function monitor(entry, alone) {
    var status = STATUS[entry.status] || STATUS.down;
    var resting = entry.status === 'stopped' || entry.status === 'inactive';
    var expanded = entry.id in opened ? opened[entry.id] : alone;
    var name = entry.project.name || entry.project.id || 'Monitor';
    var where = [entry.repo.slug ? entry.repo.slug + (entry.repo.base ? ' → ' + entry.repo.base : '') : '', entry.harness.kind,
        entry.workflow.mode ? entry.workflow.mode + (entry.workflow.autoMerge ? ' + auto-merge' : '') : ''].filter(Boolean).join(' · ');
    var pips = [];
    for (var slot = 0; slot < Math.min(entry.slots.max, 12); slot++) pips.push(h('i', { class: 'pip' + (slot < entry.slots.used ? ' on' : '') }));
    var pending = entry.pipeline.filter(function (item) { return item.stage !== 'queued'; });
    var queued = entry.pipeline.filter(function (item) { return item.stage === 'queued'; });
    var order = STAGES.map(function (stage) { return stage[0]; });
    pending.sort(function (a, b) { return order.indexOf(a.stage) - order.indexOf(b.stage); });

    return h('article', { class: 'monitor' + (expanded ? ' expanded' : '') + (resting ? ' resting' : ''), 'data-key': entry.id, 'data-list': true, 'aria-label': name },
        h('header', { class: 'mhead', 'data-key': 'head' },
            h('span', { class: 'badge', 'data-flash': true }, h('i', { class: 'dot ' + status[0] }), status[1]),
            h('h2', { text: name }),
            resting ? null : h('span', { class: 'slots muted num', title: 'Sessions working, of the slots this monitor may use' },
                h('span', { class: 'pips', 'aria-hidden': 'true' }, pips), h('span', { 'data-flash': true, text: entry.slots.used + '/' + entry.slots.max }), h('span', { class: 'sr', text: ' sessions working' }))),
        where ? h('div', { class: 'where muted', 'data-key': 'where', text: where }) : null,
        entry.health.map(function (item) { return item.machine ? null : alert(item); }),
        h('div', { class: 'line', 'data-key': 'waiting' }, h('span', { class: 'eyebrow', text: 'Waiting on' }), h('span', { class: 'chips', 'data-list': true }, entry.waiting.map(function (item) {
            return h('span', { class: 'chip', 'data-key': item.key }, h('span', { 'data-flash': true, text: item.text }), item.since ? ' · ' + ago(item.since) : item.until ? ' · ' + inTime(item.until) : '');
        }))),
        entry.note && !resting ? h('div', { class: 'line', 'data-key': 'note' }, h('span', { class: 'eyebrow', text: 'Last note' }),
            h('span', { class: expanded ? null : 'clamp', title: entry.note }, h('span', { 'data-flash': true, text: entry.note }), ' · ' + ago(entry.updatedAt))) : null,
        resting && entry.pipeline.length ? h('div', { class: 'muted', 'data-key': 'rest', text: plural(entry.pipeline.length, 'group') + ' left in the pipeline · updated ' + ago(entry.updatedAt) }) : null,
        !resting && !expanded && (pending.length || queued.length || entry.attention.length) ? h('div', { class: 'work', 'data-key': 'work', 'data-list': true, 'data-exit': 'finish' },
            pending.map(function (item) { return workRow(item, entry); }),
            queued.length ? h('div', { class: 'row', 'data-key': '~queued' }, h('span', { class: 'stage' }, h('i', { class: 'dot ring' }), 'Queued'),
                h('span', { class: 'what' }, queued.map(function (item) { return comments(item.comments); }))) : null,
            entry.attention.length ? h('div', { class: 'row', 'data-key': '~needs' }, h('span', { class: 'stage' }, h('i', { class: 'dot warn' }), 'Needs you'),
                h('span', { class: 'what' }, entry.attention.slice(0, 6).map(function (item) {
                    return h('span', null, anchor(item.link, item.number ? '#' + item.number : 'Comment', 'comment'), ' ', h('span', { class: 'muted', text: item.label.toLowerCase() }));
                }), entry.attention.length > 6 ? h('span', { class: 'muted', text: 'and ' + (entry.attention.length - 6) + ' more' }) : null)) : null) : null,
        h('button', { class: 'more', type: 'button', 'data-key': 'more', 'data-toggle': entry.id, 'aria-expanded': expanded ? 'true' : 'false', text: expanded ? 'Hide details' : 'Show details' }),
        expanded ? details(entry) : null);
}

// ---------------------------------------------------------------- updating the page
// Every update builds the page again off screen and carries the differences over to the page on
// screen, so what stays keeps its place, focus and scroll position, and what changes can be seen
// changing: a row takes its new state where it is, then glides to its new place; a finished group
// says how it ended before it leaves; new things fade in.

function motion() { return ready && !document.hidden && !(calm && calm.matches) && Boolean(document.body.animate); }
function play(node, frames, options) { return moving && node.animate ? node.animate(frames, options) : null; }
var EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
function tint(alpha) { return 'inset 0 0 0 999px hsl(' + getComputedStyle(document.documentElement).getPropertyValue('--ring').trim() + ' / ' + alpha + ')'; }
function flash(node) { play(node, [{ boxShadow: tint(0.22) }, { boxShadow: tint(0) }], { duration: 1500, easing: 'ease-out' }); }
function enter(node) { play(node, [{ opacity: 0, transform: 'translateY(-6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE }); }

// Fades a node out where it is, out of the layout, so its neighbours can close the gap at once.
function leave(node) {
    if (!moving || abrupt || !node.animate) { node.remove(); return; }
    var top = node.offsetTop, left = node.offsetLeft, width = node.offsetWidth, height = node.offsetHeight;
    node.setAttribute('data-leaving', '');
    node.setAttribute('aria-hidden', 'true');
    node.style.position = 'absolute'; node.style.top = top + 'px'; node.style.left = left + 'px'; node.style.width = width + 'px'; node.style.height = height + 'px';
    node.style.margin = '0'; node.style.pointerEvents = 'none';
    var out = node.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
    out.onfinish = out.oncancel = function () { node.remove(); };
}

// A group that left the pipeline shows how it ended for a moment, then leaves.
function finish(node) {
    var card = node.closest('.monitor');
    var entry = card && data.monitors.find(function (one) { return one.id === card.getAttribute('data-key'); });
    var id = node.getAttribute('data-key');
    // Still in the pipeline: it only moved to another list (a held group, another column).
    if (!entry || entry.pipeline.some(function (item) { return item.id === id; })) { leave(node); return; }
    var state = entry.ended ? entry.ended[id] : undefined;
    var label = state === 'cancelled' ? ['ring', 'Cancelled'] : ['good', state ? 'Done' : 'Finished'];
    var stage = node.querySelector('.stage');
    node.setAttribute('data-ending', '');
    if (stage) stage.replaceChildren(h('i', { class: 'dot ' + label[0] }), label[1]);
    else node.insertBefore(h('div', { class: 'meta' }, h('i', { class: 'dot ' + label[0] }), label[1]), node.firstChild);
    flash(node);
    setTimeout(function () { if (node.isConnected) animated(function () { node.removeAttribute('data-ending'); leave(node); }); }, 1700);
}

function outgoing(node) { return node.hasAttribute('data-leaving') || node.hasAttribute('data-ending'); }

function syncAttributes(live, next) {
    var index, attribute;
    for (index = live.attributes.length - 1; index >= 0; index--) if (!next.hasAttribute(live.attributes[index].name)) live.removeAttribute(live.attributes[index].name);
    for (index = 0; index < next.attributes.length; index++) {
        attribute = next.attributes[index];
        if (live.getAttribute(attribute.name) !== attribute.value) live.setAttribute(attribute.name, attribute.value);
    }
}

// Children of a list are matched by key: kept ones are updated in place, new ones are added, the
// rest leave. Nodes that are on their way out stay where they are.
function reconcile(live, next) {
    var current = {}, kept = {};
    slice(live.children).forEach(function (child) { if (!outgoing(child)) current[child.getAttribute('data-key')] = child; });
    var result = slice(next.children).map(function (child) {
        var key = child.getAttribute('data-key');
        if (!current[key]) return child;
        kept[key] = true;
        return morph(current[key], child);
    });
    Object.keys(current).forEach(function (key) {
        if (kept[key]) return;
        if (moving && !abrupt && live.getAttribute('data-exit') === 'finish' && key.charAt(0) !== '~') finish(current[key]);
        else leave(current[key]);
    });
    var cursor = live.firstElementChild;
    result.forEach(function (node) {
        while (cursor && outgoing(cursor)) cursor = cursor.nextElementSibling;
        if (node === cursor) cursor = cursor.nextElementSibling;
        else live.insertBefore(node, cursor);
    });
}

// Makes the node on the page say what the new one says, changing as little as possible. Returns the node now on the page.
function morph(live, next) {
    if (live.isEqualNode(next)) return live;
    if (live.nodeType !== 1 || next.nodeType !== 1 || live.tagName !== next.tagName || live.hasAttribute('data-atomic')) { live.replaceWith(next); return next; }
    var before = live.getAttribute('data-sig');
    syncAttributes(live, next);
    if (before !== null && before !== live.getAttribute('data-sig')) changed.push(live);
    if (live.hasAttribute('data-list')) { reconcile(live, next); return live; }
    var mine = slice(live.childNodes), theirs = slice(next.childNodes), index, alike = mine.length === theirs.length;
    for (index = 0; alike && index < mine.length; index++) alike = mine[index].nodeType === theirs[index].nodeType && (mine[index].nodeType !== 1 || mine[index].tagName === theirs[index].tagName);
    if (!alike) {
        live.replaceChildren.apply(live, theirs);
        if (live.hasAttribute('data-flash')) flashes.push(live);
        return live;
    }
    for (index = 0; index < mine.length; index++) {
        if (mine[index].nodeType === 1) morph(mine[index], theirs[index]);
        else if (mine[index].nodeValue !== theirs[index].nodeValue) {
            mine[index].nodeValue = theirs[index].nodeValue;
            if (live.hasAttribute('data-flash')) flashes.push(live);
        }
    }
    return live;
}

// Runs a change to the page and animates what it did: where every keyed node was, where it is now.
function animated(change) {
    var before = null;
    moving = motion();
    changed = []; flashes = [];
    if (moving) {
        before = new Map();
        slice(document.querySelectorAll('[data-key]')).forEach(function (node) { before.set(node, node.getBoundingClientRect()); });
    }
    change();
    if (moving) {
        var entered = [];
        // Parents come first in document order, so a child measures its own move inside a moving parent.
        slice(document.querySelectorAll('[data-key]')).forEach(function (node) {
            if (outgoing(node)) return;
            var was = before.get(node);
            if (!was) {
                if (!entered.some(function (other) { return other.contains(node); })) { entered.push(node); enter(node); }
                return;
            }
            var now = node.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
            // A node whose state changed shows the change where it was, then moves.
            play(node, [{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
                { duration: 420, delay: changed.indexOf(node) < 0 ? 0 : 500, fill: 'backwards', easing: EASE });
        });
        changed.forEach(flash);
        flashes.forEach(function (node) {
            flash(node);
            if (node.classList.contains('value')) play(node, [{ transform: 'translateY(45%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: EASE });
        });
    }
    moving = false;
}

function render() {
    if (!data) return;
    var monitors = data.monitors;
    var busy = monitors.filter(function (entry) { return entry.status !== 'stopped' && entry.status !== 'inactive'; });
    var sum = function (list, pick) { return list.reduce(function (total, entry) { return total + pick(entry); }, 0); };
    var count = function (stage) { return function (entry) { return entry.pipeline.filter(function (item) { return item.stage === stage; }).length; }; };
    var needs = sum(monitors, function (entry) { return entry.attention.length; });
    var working = monitors.filter(active).length, waiting = monitors.filter(function (entry) { return entry.status === 'waiting'; }).length;
    var summary = monitors.length ? [plural(monitors.length, 'monitor'), working + ' working', waiting ? waiting + ' waiting' : ''].filter(Boolean).join(', ') : 'No monitors';
    var shared = {};
    animated(function () {
        document.getElementById('summary').textContent = summary;
        document.title = (needs ? '(' + needs + ') ' : '') + 'uier monitor';
        reconcile(document.getElementById('machine'), h('div', null, busy.map(function (entry) {
            return entry.health.map(function (item) { if (!item.machine || shared[item.text]) return null; shared[item.text] = true; return alert(item); });
        })));
        reconcile(document.getElementById('tiles'), h('div', null, monitors.length ? [
            tile('Sessions working', sum(busy, function (entry) { return entry.slots.used; }), 'of ' + sum(busy, function (entry) { return entry.slots.max; }) + ' slots'),
            tile('Queued', sum(busy, count('queued')), 'groups waiting for a slot'),
            tile('Pull requests', sum(busy, count('pr')), 'open, waiting to merge'),
            tile('Needs you', needs, 'questions, checks and blocks'),
            tile('Closed, last 24 h', sum(monitors, function (entry) { return entry.metrics.closed24h; }), 'comments')
        ] : null));
        reconcile(document.getElementById('monitors'), h('div', null, monitors.length
            ? monitors.map(function (entry) { return monitor(entry, monitors.length === 1); })
            : h('div', { class: 'blank', 'data-key': '~blank' }, h('p', { text: 'No monitors found on this machine.' }),
                h('p', null, 'Start one with the uier-monitor skill, or pass a state folder: ', h('code', { text: 'node dashboard.mjs --state DIR' })))));
    });
    ready = true;
    if (restore) { window.scrollTo(0, restore); restore = 0; }
}

document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-toggle]') : null;
    if (!button) return;
    opened[button.getAttribute('data-toggle')] = button.getAttribute('aria-expanded') !== 'true';
    abrupt = true;
    render();
    abrupt = false;
    remember();
});

function connection(kind, label) {
    var live = document.getElementById('live');
    live.firstChild.className = 'dot ' + kind;
    live.lastChild.textContent = label;
}
var stream = new EventSource('/api/stream');
stream.onopen = function () { connection('good', 'Live'); };
stream.addEventListener('reload', reload);
stream.onmessage = function (event) {
    var next = JSON.parse(event.data);
    // A restarted or updated dashboard: this page is the old one.
    if (next.build && next.build !== BUILD) { reload(); return; }
    data = next;
    connection('good', 'Live');
    render();
    // One beat of the Live dot for every update that arrives.
    var dot = document.getElementById('live').firstChild;
    var green = getComputedStyle(document.documentElement).getPropertyValue('--brand-success').trim();
    if (motion()) dot.animate([{ boxShadow: '0 0 0 0 hsl(' + green + ' / 0.6)' }, { boxShadow: '0 0 0 7px hsl(' + green + ' / 0)' }], { duration: 900, easing: 'ease-out' });
};
stream.onerror = function () { connection('warn', 'Reconnecting'); };
setInterval(render, 20000);
</script>
</body>
</html>
`;

let entry = null;
try { entry = process.argv[1] ? realpathSync(process.argv[1]) : null; } catch { /* run from a string */ }
// Not when --dev imports this file again (with a query): the server is already running.
if (entry === fileURLToPath(import.meta.url) && !new URL(import.meta.url).search) {
    main(process.argv.slice(2)).catch(error => { console.error(error?.message ?? String(error)); process.exit(1); });
}
