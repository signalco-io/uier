/**
 * The app's own IndexedDB database in this browser (`uier-app`): a key-value store of copies the app can draw at once
 * while the server sends the current version (the shell's snapshot, the language's catalog, favicons). Never a source
 * of truth and never anything that authorizes: every page and action still reads and checks for itself. Every call
 * resolves even when IndexedDB is unavailable (private windows, blocked storage, the server), with nothing read or
 * written, so a caller never has to handle its failure.
 */
const DATABASE = 'uier-app';
const STORE = 'entries';

let opening: Promise<IDBDatabase | undefined> | undefined;

/** The database at `version`, or at its current one (created with the store when new) */
function openVersion(version?: number) {
    return new Promise<IDBDatabase | undefined>(resolve => {
        try {
            const request = version === undefined ? indexedDB.open(DATABASE) : indexedDB.open(DATABASE, version);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE))
                    request.result.createObjectStore(STORE);
            };
            request.onsuccess = () => {
                const database = request.result;
                // A newer version in another tab (after a deploy) asks this one to let go
                database.onversionchange = () => { database.close(); opening = undefined; };
                database.onclose = () => { opening = undefined; };
                resolve(database);
            };
            request.onerror = () => resolve(undefined);
            request.onblocked = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

function open() {
    if (typeof indexedDB === 'undefined')
        return Promise.resolve(undefined);
    opening ??= (async () => {
        const database = await openVersion();
        if (!database || database.objectStoreNames.contains(STORE))
            return database;
        // A database of this name without the store (opened by something else first): the next version adds it
        const next = database.version + 1;
        database.close();
        return openVersion(next);
    })();
    return opening;
}

/** One request in its own transaction; `undefined` when the database or the request fails */
async function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T> | void) {
    const database = await open();
    if (!database)
        return undefined;
    return new Promise<T | undefined>(resolve => {
        try {
            const transaction = database.transaction(STORE, mode);
            const pending = request(transaction.objectStore(STORE));
            transaction.oncomplete = () => resolve(pending ? pending.result : undefined);
            transaction.onerror = () => resolve(undefined);
            transaction.onabort = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

export function cacheGet<T>(key: string) {
    return run<T>('readonly', store => store.get(key) as IDBRequest<T>);
}

export async function cacheSet(key: string, value: unknown) {
    await run('readwrite', store => { store.put(value, key); });
}

export async function cacheDelete(keys: string | string[]) {
    const list = typeof keys === 'string' ? [keys] : keys;
    if (list.length)
        await run('readwrite', store => { for (const key of list) store.delete(key); });
}

/** The keys that start with `prefix` */
export async function cacheKeys(prefix: string) {
    // Every key that starts with the prefix sorts between it and the prefix followed by the highest code unit
    const keys = await run<IDBValidKey[]>('readonly', store => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    return (keys ?? []).filter((key): key is string => typeof key === 'string');
}

/** Removes every key that starts with `prefix` */
export async function cacheDeletePrefix(prefix: string) {
    await run('readwrite', store => { store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)); });
}

/** Every entry whose key starts with `prefix`, in one read */
export async function cacheEntries<T>(prefix: string) {
    const database = await open();
    if (!database)
        return [];
    return new Promise<[string, T][]>(resolve => {
        try {
            const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
            const transaction = database.transaction(STORE, 'readonly');
            const store = transaction.objectStore(STORE);
            const keys = store.getAllKeys(range);
            const values = store.getAll(range);
            transaction.oncomplete = () => resolve(keys.result.map((key, index) => [String(key), values.result[index] as T]));
            transaction.onerror = () => resolve([]);
            transaction.onabort = () => resolve([]);
        } catch {
            resolve([]);
        }
    });
}
