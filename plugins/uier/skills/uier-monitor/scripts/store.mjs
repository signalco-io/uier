// Shared by the local monitor, dashboard and supervisor. All callbacks in a transaction
// are synchronous. External commands, HTTP and session launches belong outside it.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('The uier monitor requires Node 24 or newer.');

export const monitorHome = () => resolve(process.env.UIER_MONITOR_HOME || join(homedir(), '.uier-monitor'));
export const databasePath = () => join(monitorHome(), 'monitor.sqlite');
const sections = ['items', 'groups', 'prs'];
const connections = new Map();

export function canonical(dir) {
    try { return realpathSync(dir); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const path = resolve(dir);
        return join(canonical(dirname(path)), basename(path));
    }
}

const schema = `
    CREATE TABLE monitors (dir TEXT PRIMARY KEY, config TEXT NOT NULL, touched INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE entities (dir TEXT NOT NULL REFERENCES monitors(dir), section TEXT NOT NULL,
        id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (dir, section, id));
    CREATE INDEX working_groups ON entities(dir, json_extract(body,'$.state'))
        WHERE section='groups' AND json_extract(body,'$.state') IN ('building','fixing','reviewing');
    CREATE TABLE records (scope TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope,name));
    CREATE TABLE inbox (seq INTEGER PRIMARY KEY, dir TEXT NOT NULL, identity TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(dir,identity));
    CREATE TABLE activity (seq INTEGER PRIMARY KEY, dir TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX recent_activity ON activity(dir,seq);
    CREATE TABLE slots (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
    PRAGMA user_version=1;
`;

function db(write = false) {
    const file = databasePath();
    const connection = connections.get(file);
    if (connection && (!write || connection.writable)) return connection.db;
    if (!existsSync(file)) {
        const home = dirname(file);
        const registry = join(home, 'monitors');
        if (existsSync(join(home, 'orchestrator.json')) || existsSync(join(home, 'slots.json'))
            || (existsSync(registry) && readdirSync(registry).some(name => name.endsWith('.json'))))
            throw new Error('Existing JSON monitors need a manual cutover before using SQLite.');
        if (!write) return null;
    }
    if (write) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        closeSync(openSync(file, 'a', 0o600));
    }
    const handle = new DatabaseSync(file, { readOnly: !write });
    try {
        handle.exec('PRAGMA busy_timeout=10000');
        const version = () => handle.prepare('PRAGMA user_version').get().user_version;
        if (write && !version()) {
            handle.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
            if (!version()) handle.exec(schema);
            handle.exec('COMMIT');
        }
        if (!write && !version()) { handle.close(); return null; } // first writer is initializing
        if (version() !== 1) throw new Error('Unsupported uier monitor database version.');
    } catch (error) { handle.close(); throw error; }
    connection?.db.close();
    connections.set(file, { db: handle, writable: write });
    return handle;
}

export function transaction(fn) {
    const handle = db(true);
    // Compose synchronous operations in the outer transaction on Node 24.0 and later.
    if (handle.isTransaction) return fn();
    handle.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        if (result?.then) throw new Error('Asynchronous SQLite transaction');
        handle.exec('COMMIT');
        return result;
    } catch (error) { handle.exec('ROLLBACK'); throw error; }
}

const keyed = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const parsed = rows => Object.fromEntries(rows.map(row => [row.id, JSON.parse(row.body)]));
const scopeOf = dir => dir ? canonical(dir) : '';

export function readRecord(dir, name, fallback) {
    const row = db()?.prepare('SELECT body FROM records WHERE scope=? AND name=?').get(scopeOf(dir), name);
    return row ? JSON.parse(row.body) : fallback;
}

export function writeRecord(dir, name, value) {
    db(true).prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(scope,name) DO UPDATE SET body=excluded.body')
        .run(scopeOf(dir), name, JSON.stringify(value));
}

export function readEntities(dir, section, ids) {
    const conn = db();
    if (!conn) return {};
    const args = [canonical(dir), section];
    if (ids) return parsed(conn.prepare(`SELECT id, body FROM entities WHERE dir=? AND section=?
        AND id IN (SELECT value FROM json_each(?)) ORDER BY rowid`).all(...args, JSON.stringify(ids)));
    return parsed(conn.prepare('SELECT id, body FROM entities WHERE dir=? AND section=? ORDER BY rowid').all(...args));
}

// One SELECT supplies a consistent snapshot of config and its entities, even while another
// process writes. Empty sections and extension fields round-trip exactly as the CLI received them.
export function readState(dir, fallback) {
    dir = canonical(dir);
    const rows = db()?.prepare(`SELECT NULL AS section, NULL AS id, config AS body FROM monitors WHERE dir=?
        UNION ALL SELECT section,id,body FROM (SELECT section,id,body FROM entities WHERE dir=? ORDER BY rowid)`).iterate(dir, dir);
    let state;
    for (const row of rows ?? []) {
        if (!row.section) state = JSON.parse(row.body);
        else Object.defineProperty(state[row.section], row.id, { value: JSON.parse(row.body), enumerable: true, writable: true, configurable: true });
    }
    if (!state) checkLegacyProject(dir);
    return state ?? fallback;
}

export function readConfig(dir) {
    const row = db()?.prepare('SELECT config FROM monitors WHERE dir=?').get(canonical(dir));
    if (!row) checkLegacyProject(dir);
    return row ? JSON.parse(row.config) : null;
}

function checkLegacyProject(dir) {
    if (existsSync(join(dir, 'state.json'))) throw new Error('Transfer the existing JSON project state before starting this monitor.');
}

// Increment a project revision independently of watcher heartbeats. Long-running readers
// can reuse the decoded state while no patch has changed any project fields.
const snapshots = new Map();
export function stateSnapshot(dir, fallback) {
    dir = canonical(dir);
    const key = join(databasePath(), dir);
    const revision = db()?.prepare('SELECT revision FROM monitors WHERE dir=?').get(dir)?.revision;
    const saved = snapshots.get(key);
    if (revision && saved?.revision === revision) return saved.state;
    const state = readState(dir, fallback);
    if (revision) snapshots.set(key, { revision, state });
    return state;
}

export function writeState(dir, state, before) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    dir = canonical(dir);
    transaction(() => {
        const conn = db(true);
        before ??= readState(dir, {});
        const config = { ...state };
        for (const key of sections) if (keyed(config[key])) config[key] = {};
        conn.prepare('INSERT INTO monitors(dir,config,touched) VALUES(?,?,?) ON CONFLICT(dir) DO UPDATE SET config=excluded.config,touched=excluded.touched,revision=revision+1')
            .run(dir, JSON.stringify(config), Date.now());
        const put = conn.prepare('INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(dir,section,id) DO UPDATE SET body=excluded.body');
        const del = conn.prepare('DELETE FROM entities WHERE dir=? AND section=? AND id=?');
        for (const key of sections) {
            const old = keyed(before[key]) ? before[key] : {};
            const next = keyed(state[key]) ? state[key] : {};
            for (const id of Object.keys(old)) {
                if (!Object.hasOwn(next, id)) del.run(dir, key, id);
            }
            for (const [id, value] of Object.entries(next)) {
                if (Object.hasOwn(old, id) && value === old[id]) continue;
                const body = JSON.stringify(value);
                if (body !== JSON.stringify(old[id])) put.run(dir, key, id, body);
            }
        }
    });
}

export function registrations() {
    return (db()?.prepare(`SELECT dir AS stateDir,json_extract(config,'$.project.id') AS id,
        json_extract(config,'$.project.name') AS name,json_extract(config,'$.repo.slug') AS repo,
        json_extract(config,'$.max') AS max,json_extract(config,'$.stopped') OR json_extract(config,'$.watch.stopped') AS stopped,
        touched, (SELECT json_extract(body,'$.heartbeatAt') FROM records WHERE scope=monitors.dir AND name='watch') AS heartbeat FROM monitors ORDER BY dir`).all() ?? []).filter(row => existsSync(row.stateDir));
}

export function activeGroupCount(dir) {
    return db()?.prepare(`SELECT count(*) AS n FROM entities WHERE dir=? AND section='groups'
        AND json_extract(body,'$.state') IN ('building','fixing','reviewing')`).get(dir).n ?? 0;
}

export function readInbox(dir) {
    return (db()?.prepare('SELECT body FROM inbox WHERE dir=? ORDER BY seq').all(canonical(dir)) ?? []).map(row => JSON.parse(row.body));
}

export function clearInbox(dir) { db(true).prepare('DELETE FROM inbox WHERE dir=?').run(canonical(dir)); }

export function appendInbox(dir, events, suppressPolling = false) {
    const conn = db(true);
    dir = canonical(dir);
    if (suppressPolling) conn.prepare("DELETE FROM inbox WHERE dir=? AND json_extract(body,'$.type') IN ('heartbeat','poll-uier')").run(dir);
    const put = conn.prepare('INSERT INTO inbox(dir,identity,body) VALUES(?,?,?) ON CONFLICT(dir,identity) DO NOTHING');
    return events.filter(event => {
        const { foundAt, ...identity } = event;
        return put.run(dir, JSON.stringify(identity), JSON.stringify(event)).changes > 0;
    });
}

export function addActivity(dir, entries) {
    if (!entries.length) return;
    transaction(() => {
        dir = canonical(dir);
        const put = db().prepare('INSERT INTO activity(dir,body) VALUES(?,?)');
        for (const event of entries) put.run(dir, JSON.stringify(event));
        db().prepare('DELETE FROM activity WHERE dir=? AND seq <= (SELECT seq FROM activity WHERE dir=? ORDER BY seq DESC LIMIT 1 OFFSET 10000)').run(dir, dir);
    });
}

export function activity(dir, limit = 400) {
    return (db()?.prepare('SELECT body FROM activity WHERE dir=? ORDER BY seq DESC LIMIT ?').all(canonical(dir), limit) ?? [])
        .reverse().map(row => JSON.parse(row.body));
}

export function readSlots() {
    const slots = { claims: {}, waiting: {} };
    for (const row of db()?.prepare('SELECT * FROM slots').all() ?? []) slots[row.kind][row.id] = JSON.parse(row.body);
    return slots;
}

export function writeSlots(slots) {
    transaction(() => {
        const conn = db();
        const old = readSlots();
        const remove = conn.prepare('DELETE FROM slots WHERE kind=? AND id=?');
        const save = conn.prepare('INSERT OR REPLACE INTO slots VALUES(?,?,?)');
        for (const kind of ['claims', 'waiting']) {
            for (const id of Object.keys(old[kind])) if (!Object.hasOwn(slots[kind], id)) remove.run(kind, id);
            for (const [id, value] of Object.entries(slots[kind])) {
                const body = JSON.stringify(value);
                if (body !== JSON.stringify(old[kind][id])) save.run(kind, id, body);
            }
        }
    });
}
