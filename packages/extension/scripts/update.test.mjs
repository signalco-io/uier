import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const compiled = build({
    entryPoints: [resolve(import.meta.dirname, '../src/update.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    define: { __EXTENSION_BROWSER__: '"chrome"', __EXTENSION_API__: '"https://uier.io"' }
});

/** A fresh worker with the browser's update API and session storage; no network or store access. */
async function worker({ installed = '0.1.4', latest = '0.1.5', check = { status: 'update_available', version: '0.1.5' } } = {}) {
    const session = new Map(), calls = { fetch: [], checks: 0 }, listeners = [];
    const chrome = {
        runtime: {
            id: 'extension-id',
            getManifest: () => ({ version: installed }),
            onUpdateAvailable: { addListener: listener => listeners.push(listener) },
            async requestUpdateCheck() { calls.checks++; if (check instanceof Error) throw check; return check; }
        },
        storage: { session: {
            async get(key) { return { [key]: session.get(key) }; },
            async set(values) { for (const [key, value] of Object.entries(values)) session.set(key, value); }
        } }
    };
    async function fetch(url, init) {
        calls.fetch.push({ url, init });
        if (latest instanceof Error) throw latest;
        return { ok: true, json: async () => ({ version: latest }) };
    }
    const module = { exports: {} };
    runInNewContext((await compiled).outputFiles[0].text, { module, exports: module.exports, chrome, fetch, URL });
    module.exports.watchUpdates();
    return { ...module.exports, calls, session, available: version => Promise.all(listeners.map(listener => listener({ version }))) };
}

test('compares numeric versions', async () => {
    const { newerVersion } = await worker();
    assert.equal(newerVersion('0.1.10', '0.1.9'), true);
    assert.equal(newerVersion('0.2', '0.1.9'), true);
    assert.equal(newerVersion('0.1.5', '0.1.5'), false);
    assert.equal(newerVersion('0.1.4', '0.1.5'), false);
    assert.equal(newerVersion('1.0.0.1', '1.0.0'), true);
});

test('asks the browser only when uier reports a newer version, then offers the download', async () => {
    const current = await worker({ latest: '0.1.4' });
    assert.deepEqual({ ...await current.updateState(1_000) }, { version: '0.1.4' });
    assert.equal(current.calls.checks, 0);
    assert.equal(current.calls.fetch[0].url, 'https://uier.io/api/extension/version');
    assert.equal(current.calls.fetch[0].init.credentials, 'omit');

    const newer = await worker();
    assert.deepEqual({ ...await newer.updateState(1_000) }, { version: '0.1.4', ready: '0.1.5' });
    assert.equal(newer.calls.checks, 1);
    // A download stays offered without another server or store check.
    assert.deepEqual({ ...await newer.updateState(2_000) }, { version: '0.1.4', ready: '0.1.5' });
    assert.equal(newer.calls.fetch.length, 1);
    assert.equal(await newer.readyUpdate(), '0.1.5');
});

test('checks at most hourly and treats store review, throttling and failures as no update', async () => {
    for (const check of [{ status: 'no_update' }, { status: 'throttled' }, new Error('Updates are disabled')]) {
        const pending = await worker({ check });
        assert.deepEqual({ ...await pending.updateState(1_000) }, { version: '0.1.4' });
        assert.deepEqual({ ...await pending.updateState(1_000 + pending.updateCheckInterval - 1) }, { version: '0.1.4' });
        assert.equal(pending.calls.fetch.length, 1); assert.equal(pending.calls.checks, 1);
        await pending.updateState(1_000 + pending.updateCheckInterval);
        assert.equal(pending.calls.fetch.length, 2); assert.equal(pending.calls.checks, 2);
    }
    for (const latest of [new Error('offline'), 'not a version', '0.1.5; rm', null]) {
        const unreachable = await worker({ latest });
        assert.deepEqual({ ...await unreachable.updateState(1_000) }, { version: '0.1.4' });
        assert.equal(unreachable.calls.checks, 0);
    }
});

test('a download the browser reports is offered; older or malformed versions are not', async () => {
    const { available, updateState, calls } = await worker({ latest: '0.1.4' });
    await available('0.1.3'); await available('<b>0.2</b>');
    assert.deepEqual({ ...await updateState(1_000) }, { version: '0.1.4' });
    await available('0.1.6');
    assert.deepEqual({ ...await updateState(2_000) }, { version: '0.1.4', ready: '0.1.6' });
    assert.equal(calls.checks, 0);
});
