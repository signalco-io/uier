import { browser, browserKind } from './browser';

// Firefox local storage cannot be restricted to trusted extension contexts. Their
// background-origin IndexedDB is inaccessible to isolated content scripts on reviewed sites.
// Chromium retains its existing restricted local store so installed sessions survive upgrades.
let database: Promise<IDBDatabase> | undefined;
function privateDatabase() {
    return database ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('uier-extension-credentials', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('credentials');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Credential storage is unavailable.'));
    });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await privateDatabase();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('credentials', mode);
        const request = operation(tx.objectStore('credentials'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Credential storage failed.'));
    });
}
export const credentialStorage = {
    async get(key: string): Promise<Record<string, unknown>> {
        if (browserKind === 'chrome') return browser.storage.local.get(key);
        return { [key]: await transaction('readonly', store => store.get(key)) };
    },
    async set(values: Record<string, unknown>) {
        if (browserKind === 'chrome') return browser.storage.local.set(values);
        for (const [key, value] of Object.entries(values)) await transaction('readwrite', store => store.put(value, key));
    },
    async remove(key: string) {
        if (browserKind === 'chrome') return browser.storage.local.remove(key);
        await transaction('readwrite', store => store.delete(key));
    }
};
export function secureStorage() {
    // Session storage is private to trusted contexts by default in Firefox.
    // Do not fall back to persistent storage for access tokens, proofs, drafts or bindings.
    if (!browser.storage.session) return Promise.reject(new Error('This browser needs an update to run uier.'));
    return browserKind === 'chrome' ? Promise.all([
        browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
        browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    ]) : Promise.resolve();
}
