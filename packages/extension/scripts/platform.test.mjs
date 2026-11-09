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

test('Firefox selects native Promise APIs ahead of the chrome compatibility namespace', async () => {
    const { browser } = nativeBrowser();
    const result = await load('browser', 'firefox', { browser, chrome: { runtime: { id: 'callback-api' } } });
    assert.equal(result.browser, browser);
    assert.equal(result.clientId, 'native-extension-id');
    assert.equal(result.extensionOrigin(), 'moz-extension://installation-uuid');
});

test('Chromium uses its native namespace and sender ID', async () => {
    const { browser } = nativeBrowser();
    const chromium = await load('browser', 'chrome', { chrome: browser });
    assert.equal(chromium.browser, browser);
    assert.equal(chromium.clientId, browser.runtime.id);
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

test(`Firefox persists refresh credentials in private IndexedDB without touching content-readable local storage`, async () => {
    const { browser } = nativeBrowser();
    const forbidden = () => { throw new Error('Content-readable storage must not hold credentials'); };
    browser.storage.local = { get: forbidden, set: forbidden, remove: forbidden, setAccessLevel: forbidden };
    browser.storage.session = {};
    const indexedDB = indexedDatabase();
    const { credentialStorage, secureStorage } = await load('storage', 'firefox', { browser, indexedDB });
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
    const { secureStorage } = await load('storage', 'firefox', { browser });
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
        assert.equal(redirectURL(), kind === 'firefox' ? 'https://identity.extensions.allizom.org/' : 'https://identity.example/uier');
        assert.equal(await launchAuth('https://uier.io/app/extension'), 'https://identity.example/uier?code=one-use&state=bound');
    }
});
