import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const compiled = new Map();
async function load(name, kind, globals = {}) {
    const key = `${name}:${kind}`;
    if (!compiled.has(key)) compiled.set(key, build({
        entryPoints: [resolve(import.meta.dirname, '../src', `${name}.ts`)],
        bundle: true, write: false, format: 'cjs', platform: 'browser',
        define: { __EXTENSION_BROWSER__: JSON.stringify(kind) }
    }));
    const result = await compiled.get(key);
    const module = { exports: {} };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, URL, ...globals });
    return module.exports;
}

function event() {
    const listeners = new Set();
    return {
        listeners,
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
        emit(...args) { for (const listener of [...listeners]) listener(...args); }
    };
}

function nativeBrowser() {
    const restrictions = [];
    const local = new Map();
    const browser = {
        runtime: { id: 'native-extension-id', getURL: path => `moz-extension://installation-uuid/${path}` },
        storage: {
            local: {
                async get(key) { return { [key]: local.get(key) }; },
                async set(values) { for (const [key, value] of Object.entries(values)) local.set(key, value); },
                async remove(key) { local.delete(key); },
                async setAccessLevel(value) { restrictions.push(['local', value.accessLevel]); }
            },
            session: { async setAccessLevel(value) { restrictions.push(['session', value.accessLevel]); } }
        }
    };
    return { browser, restrictions, local };
}

function indexedDatabase({ failWrites = false } = {}) {
    const values = new Map();
    let opens = 0;
    const database = {
        createObjectStore(name) { assert.equal(name, 'credentials'); },
        transaction(name, mode) {
            assert.equal(name, 'credentials');
            const tx = {
                error: undefined,
                objectStore(storeName) {
                    assert.equal(storeName, 'credentials');
                    const request = operation => {
                        const result = {};
                        queueMicrotask(() => {
                            if (failWrites && mode === 'readwrite') {
                                tx.error = new Error('Simulated transaction failure');
                                tx.onabort();
                            } else {
                                result.result = operation();
                                tx.oncomplete();
                            }
                        });
                        return result;
                    };
                    return {
                        get: key => request(() => values.get(key)),
                        put: (value, key) => request(() => { values.set(key, value); return key; }),
                        delete: key => request(() => { values.delete(key); })
                    };
                }
            };
            return tx;
        }
    };
    return {
        values,
        get opens() { return opens; },
        open(name, version) {
            assert.equal(name, 'uier-extension-credentials');
            assert.equal(version, 1);
            opens++;
            const request = { result: database };
            queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
            return request;
        }
    };
}

function authFixture() {
    const onUpdated = event(), onRemoved = event();
    const timers = new Map(), removed = [], opened = [];
    let nextTimer = 1;
    const tab = { id: 42, url: 'https://uier.io/app/extension' };
    const browser = {
        runtime: { id: 'native-extension-id' },
        tabs: {
            onUpdated, onRemoved,
            async create(options) {
                assert.equal(onUpdated.listeners.size, 1, 'Observe navigation before opening the tab');
                assert.equal(onRemoved.listeners.size, 1);
                opened.push(options);
                return { ...tab };
            },
            async get(id) { assert.equal(id, tab.id); return { ...tab }; },
            async remove(id) { removed.push(id); }
        }
    };
    return {
        browser, tab, onUpdated, onRemoved, timers, removed, opened,
        globals: {
            browser,
            setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
            clearTimeout(id) { timers.delete(id); }
        }
    };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('Firefox selects native Promise APIs ahead of the chrome compatibility namespace', async () => {
    const { browser } = nativeBrowser();
    const result = await load('browser', 'firefox', { browser, chrome: { runtime: { id: 'callback-api' } } });
    assert.equal(result.browser, browser);
    assert.equal(result.clientId, 'native-extension-id');
    assert.equal(result.extensionOrigin(), 'moz-extension://installation-uuid');
});

test('Chromium uses its native namespace and Safari separates registered client ID from sender ID', async () => {
    const { browser } = nativeBrowser();
    const chromium = await load('browser', 'chrome', { chrome: browser });
    assert.equal(chromium.browser, browser);
    assert.equal(chromium.clientId, browser.runtime.id);
    browser.runtime.getURL = path => `safari-web-extension://installation-uuid/${path}`;
    const safari = await load('browser', 'safari', { browser });
    assert.equal(safari.clientId, 'io.uier.safari.Extension');
    assert.equal(safari.browser.runtime.id, 'native-extension-id');
    assert.equal(safari.extensionOrigin(), 'safari-web-extension://installation-uuid');
});

test('Chromium restricts both credential stores and preserves the existing local refresh record', async () => {
    const { browser, restrictions, local } = nativeBrowser();
    const { credentialStorage, secureStorage } = await load('storage', 'chrome', { chrome: browser });
    await secureStorage();
    assert.deepEqual(restrictions, [['session', 'TRUSTED_CONTEXTS'], ['local', 'TRUSTED_CONTEXTS']]);
    const key = 'extension-refresh-v1:https://uier.io';
    const record = { id: 'reviewer', refreshToken: 'private-refresh', attempt: 'pending-attempt' };
    await credentialStorage.set({ [key]: record });
    assert.equal(local.get(key), record);
    assert.equal((await credentialStorage.get(key))[key], record);
    await credentialStorage.remove(key);
    assert.equal(local.has(key), false);
});

for (const kind of ['firefox', 'safari']) {
    test(`${kind} persists refresh credentials in private IndexedDB without touching content-readable local storage`, async () => {
        const { browser } = nativeBrowser();
        const forbidden = () => { throw new Error('Content-readable storage must not hold credentials'); };
        browser.storage.local = { get: forbidden, set: forbidden, remove: forbidden, setAccessLevel: forbidden };
        browser.storage.session = {};
        const indexedDB = indexedDatabase();
        const { credentialStorage, secureStorage } = await load('storage', kind, { browser, indexedDB });
        await secureStorage();
        const key = 'extension-refresh-v1:https://uier.io';
        const record = { id: 'reviewer', refreshToken: 'private-refresh', attempt: 'pending-attempt' };
        await credentialStorage.set({ [key]: record });
        assert.equal((await credentialStorage.get(key))[key], record);
        assert.equal(indexedDB.opens, 1);
        assert.equal(indexedDB.values.get(key), record);
        await credentialStorage.remove(key);
        assert.equal((await credentialStorage.get(key))[key], undefined);
    });
}

test('private credential writes fail when the IndexedDB transaction aborts', async () => {
    const { browser } = nativeBrowser();
    const indexedDB = indexedDatabase({ failWrites: true });
    const { credentialStorage } = await load('storage', 'firefox', { browser, indexedDB });
    await assert.rejects(credentialStorage.set({ refresh: 'secret' }), /Simulated transaction failure/);
    assert.equal(indexedDB.values.size, 0);
});

test('missing private session storage fails instead of persisting access tokens', async () => {
    const { browser, local } = nativeBrowser();
    delete browser.storage.session;
    const { secureStorage } = await load('storage', 'safari', { browser });
    await assert.rejects(secureStorage(), /browser needs an update/);
    assert.equal(local.size, 0);
});

test('Firefox and Chromium delegate sign-in to the native identity flow', async () => {
    for (const kind of ['chrome', 'firefox']) {
        const { browser } = nativeBrowser();
        browser.identity = {
            getRedirectURL(...args) {
                assert.deepEqual(args, kind === 'firefox' ? [] : ['uier']);
                return kind === 'firefox' ? 'https://identity.extensions.allizom.org/' : 'https://identity.example/uier';
            },
            async launchWebAuthFlow(options) {
                assert.equal(options.url, 'https://uier.io/app/extension');
                assert.equal(options.interactive, true);
                return 'https://identity.example/uier?code=one-use&state=bound';
            }
        };
        const { redirectURL, launchAuth } = await load('auth', kind, { browser });
        assert.equal(redirectURL('https://uier.io'), kind === 'firefox' ? 'https://identity.extensions.allizom.org/' : 'https://identity.example/uier');
        assert.equal(await launchAuth('https://uier.io/app/extension', redirectURL('https://uier.io')), 'https://identity.example/uier?code=one-use&state=bound');
    }
});

test('Safari accepts only the created tab and exact first-party callback', async () => {
    const fixture = authFixture();
    const { launchAuth, redirectURL } = await load('auth', 'safari', fixture.globals);
    assert.equal(redirectURL('https://uier.io'), 'https://uier.io/extension-callback');
    const result = launchAuth('https://uier.io/app/extension?state=bound', redirectURL('https://uier.io'));
    let settled = false;
    void result.then(() => { settled = true; });
    await flush();
    fixture.onUpdated.emit(99, { url: 'https://uier.io/extension-callback?code=unrelated' }, {});
    for (const url of ['https://evil.test/extension-callback?code=stolen', 'https://uier.io.evil.test/extension-callback', 'https://uier.io/extension-callback/other', 'https://uier.io/app/extension?next=https://uier.io/extension-callback', 'not a URL']) {
        fixture.onUpdated.emit(42, { url }, {});
    }
    await flush();
    assert.equal(settled, false);
    assert.equal(fixture.removed.length, 0);
    const callback = 'https://uier.io/extension-callback?code=one-use&state=bound';
    fixture.onUpdated.emit(42, { url: callback }, {});
    assert.equal(await result, callback);
    assert.deepEqual(fixture.removed, [42]);
    assert.equal(fixture.onUpdated.listeners.size, 0);
    assert.equal(fixture.onRemoved.listeners.size, 0);
    assert.equal(fixture.timers.size, 0);
});

test('Safari cancellation and timeout remove observers without accepting unrelated tab closure', async () => {
    for (const cancel of [true, false]) {
        const fixture = authFixture();
        const { launchAuth } = await load('auth', 'safari', fixture.globals);
        const result = launchAuth('https://uier.io/app/extension', 'https://uier.io/extension-callback');
        await flush();
        fixture.onRemoved.emit(99);
        assert.equal(fixture.onUpdated.listeners.size, 1);
        if (cancel) {
            fixture.onRemoved.emit(42);
            assert.equal(await result, undefined);
        } else {
            const timer = [...fixture.timers.values()][0];
            assert.equal(timer.delay, 5 * 60_000);
            timer.callback();
            await assert.rejects(result, /Sign-in timed out/);
        }
        assert.equal(fixture.onUpdated.listeners.size, 0);
        assert.equal(fixture.onRemoved.listeners.size, 0);
        assert.equal(fixture.timers.size, 0);
    }
});

test('Safari recovers an immediate callback navigation that completed before tabs.create resolved', async () => {
    const fixture = authFixture();
    const callback = 'https://uier.io/extension-callback?code=fast&state=bound';
    fixture.tab.url = callback;
    const { launchAuth } = await load('auth', 'safari', fixture.globals);
    assert.equal(await launchAuth('https://uier.io/app/extension', 'https://uier.io/extension-callback'), callback);
    assert.equal(fixture.onUpdated.listeners.size, 0);
    assert.equal(fixture.timers.size, 0);
});
