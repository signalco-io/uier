import type { OperationInput, SqlParameter } from '@azure/cosmos';
import { cosmosDataContainerApp, isCosmosConfigured } from '../db/client';
import { isLocalRuntime } from '../comments/environment';
import type { AppDoc } from './model';

export type StoredDoc<T> = {
    doc: T;
    /** Opaque version for optimistic concurrency (Cosmos `_etag`) */
    etag: string;
};

export type ReplaceResult = 'ok' | 'conflict' | 'not_found';

type FieldValue = string | number | boolean;

export type DocQuery<TType extends string> = {
    type: TType;
    /** Partition key; without it the query spans all partitions */
    pk?: string;
    /** Equality filters on top-level fields */
    where?: Record<string, FieldValue>;
};

/**
 * Persistence of the app's own documents (`app` container, partition key `/pk`). Every document
 * has a `type`; related documents share a partition (e.g. a workspace with its members and
 * projects), so most queries are single-partition.
 */
export type AppStore = {
    get<T extends AppDoc>(pk: string, id: string): Promise<StoredDoc<T> | null>;
    /** Returns `false` when a document with the same id already exists in the partition */
    create<T extends AppDoc>(doc: T): Promise<boolean>;
    /**
     * Creates documents of one partition together (a transactional batch): all of them, or none and
     * `false` when one of them already exists
     */
    createAll(docs: AppDoc[]): Promise<boolean>;
    /** Replaces the document only when it was not changed since it was read (`etag`) */
    replace<T extends AppDoc>(doc: T, etag: string): Promise<ReplaceResult>;
    /** Returns `false` when the document does not exist */
    delete(pk: string, id: string): Promise<boolean>;
    query<T extends AppDoc>(query: DocQuery<T['type']>): Promise<T[]>;
};

function errorCode(error: unknown): number | string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number | string }).code
        : undefined;
}

/** All documents share one partition key, which is returned */
function singlePartition(docs: AppDoc[]) {
    const pk = docs[0]?.pk;
    if (!pk || docs.some(doc => doc.pk !== pk))
        throw new Error('createAll needs documents of one partition');
    return pk;
}

/** Removes Cosmos system properties (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`) */
function withoutSystemProperties<T>(resource: Record<string, unknown>): T {
    return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith('_'))) as T;
}

const fieldPattern = /^[A-Za-z][A-Za-z0-9]*$/;

function createCosmosAppStore(): AppStore {
    const container = cosmosDataContainerApp;
    return {
        async get<T extends AppDoc>(pk: string, id: string) {
            try {
                const response = await container().item(id, pk).read<Record<string, unknown>>();
                if (!response.resource || !response.etag)
                    return null;
                return { doc: withoutSystemProperties<T>(response.resource), etag: response.etag };
            } catch (error) {
                if (errorCode(error) === 404)
                    return null;
                throw error;
            }
        },
        async create(doc) {
            try {
                await container().items.create(doc);
                return true;
            } catch (error) {
                if (errorCode(error) === 409)
                    return false;
                throw error;
            }
        },
        async createAll(docs) {
            const pk = singlePartition(docs);
            const operations: OperationInput[] = docs.map(doc => ({ operationType: 'Create', resourceBody: doc }));
            try {
                const response = await container().items.batch(operations, pk);
                // A failed transaction reports the failing operation's status; the others are 424
                const codes = [response.code, ...(response.result ?? []).map(result => result.statusCode)]
                    .filter((code): code is number => typeof code === 'number');
                if (codes.includes(409))
                    return false;
                if (response.result?.length !== docs.length || codes.some(code => code < 200 || code >= 300))
                    throw new Error(`Creating ${docs.length} documents failed (${codes.join(', ')})`);
                return true;
            } catch (error) {
                // The SDK wraps transaction failures in Error.cause
                const code = errorCode(error) ?? (error instanceof Error ? errorCode(error.cause) : undefined);
                if (code === 409)
                    return false;
                throw error;
            }
        },
        async replace(doc, etag) {
            try {
                await container().item(doc.id, doc.pk).replace(doc, {
                    accessCondition: { type: 'IfMatch', condition: etag }
                });
                return 'ok';
            } catch (error) {
                const code = errorCode(error);
                if (code === 412)
                    return 'conflict';
                if (code === 404)
                    return 'not_found';
                throw error;
            }
        },
        async delete(pk, id) {
            try {
                await container().item(id, pk).delete();
                return true;
            } catch (error) {
                if (errorCode(error) === 404)
                    return false;
                throw error;
            }
        },
        async query<T extends AppDoc>({ type, pk, where = {} }: DocQuery<T['type']>) {
            const conditions = ['c.type = @type'];
            const parameters: SqlParameter[] = [{ name: '@type', value: type }];
            if (pk) {
                conditions.push('c.pk = @pk');
                parameters.push({ name: '@pk', value: pk });
            }
            Object.entries(where).forEach(([field, value], index) => {
                if (!fieldPattern.test(field))
                    throw new Error(`Unsupported query field "${field}"`);
                conditions.push(`c.${field} = @p${index}`);
                parameters.push({ name: `@p${index}`, value });
            });

            const { resources } = await container().items.query<Record<string, unknown>>({
                query: `SELECT * FROM c WHERE ${conditions.join(' AND ')}`,
                parameters
            }, pk ? { partitionKey: pk } : undefined).fetchAll();
            return resources.map(resource => withoutSystemProperties<T>(resource));
        }
    };
}

type MemoryEntry = {
    doc: AppDoc;
    version: number;
    /** Milliseconds; emulates Cosmos `_ts` (last modification) for TTL */
    modifiedAt: number;
};

type MemoryState = {
    partitions: Map<string, Map<string, MemoryEntry>>;
    version: number;
};

// Kept on globalThis so the data survives module reloads in `next dev`
const globalForStore = globalThis as typeof globalThis & { __uierAppMemoryStore?: MemoryState };

function memoryState() {
    return globalForStore.__uierAppMemoryStore ??= { partitions: new Map(), version: 0 };
}

function isExpired(entry: MemoryEntry, now: number) {
    const ttl = entry.doc.ttl;
    return typeof ttl === 'number' && ttl > 0 && entry.modifiedAt + ttl * 1000 <= now;
}

function partition(pk: string) {
    const partitions = memoryState().partitions;
    let entries = partitions.get(pk);
    if (!entries) {
        entries = new Map();
        partitions.set(pk, entries);
    }

    const now = Date.now();
    for (const [id, entry] of entries) {
        if (isExpired(entry, now))
            entries.delete(id);
    }
    return entries;
}

function setEntry(doc: AppDoc) {
    partition(doc.pk).set(doc.id, { doc: structuredClone(doc), version: ++memoryState().version, modifiedAt: Date.now() });
}

function createMemoryAppStore(): AppStore {
    return {
        async get<T extends AppDoc>(pk: string, id: string) {
            const entry = partition(pk).get(id);
            return entry ? { doc: structuredClone(entry.doc) as T, etag: String(entry.version) } : null;
        },
        async create(doc) {
            if (partition(doc.pk).has(doc.id))
                return false;
            setEntry(doc);
            return true;
        },
        async createAll(docs) {
            const entries = partition(singlePartition(docs));
            if (docs.some(doc => entries.has(doc.id)))
                return false;
            docs.forEach(setEntry);
            return true;
        },
        async replace(doc, etag) {
            const entry = partition(doc.pk).get(doc.id);
            if (!entry)
                return 'not_found';
            if (String(entry.version) !== etag)
                return 'conflict';
            setEntry(doc);
            return 'ok';
        },
        async delete(pk, id) {
            return partition(pk).delete(id);
        },
        async query<T extends AppDoc>({ type, pk, where = {} }: DocQuery<T['type']>) {
            const pks = pk ? [pk] : [...memoryState().partitions.keys()];
            return pks
                .flatMap(key => [...partition(key).values()].map(entry => entry.doc))
                .filter(doc => doc.type === type
                    && Object.entries(where).every(([field, value]) => (doc as Record<string, unknown>)[field] === value))
                .map(doc => structuredClone(doc) as T);
        }
    };
}

let warnedAboutMemoryStore = false;

/**
 * Cosmos DB when `COSMOSDB_CONNECTION_STRING` is set. Locally (`next dev`, e2e tests) without it,
 * an in-memory store. Anywhere else a missing connection string is an error.
 */
export function getAppStore(): AppStore {
    if (isCosmosConfigured())
        return createCosmosAppStore();

    if (!isLocalRuntime())
        throw new Error('COSMOSDB_CONNECTION_STRING is required outside local development.');

    if (!warnedAboutMemoryStore) {
        warnedAboutMemoryStore = true;
        console.warn('[app] COSMOSDB_CONNECTION_STRING is not set - using an in-memory app store (data is lost on restart).');
    }
    return createMemoryAppStore();
}

const MAX_UPDATE_ATTEMPTS = 8;

/**
 * Read-modify-write with optimistic concurrency, retried on conflicts. `update` may throw to abort;
 * returns `null` when the document does not exist.
 */
export async function updateDoc<T extends AppDoc>(pk: string, id: string, update: (doc: T) => T): Promise<T | null> {
    const store = getAppStore();
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await store.get<T>(pk, id);
        if (!stored)
            return null;

        const updated = update(stored.doc);
        const result = await store.replace(updated, stored.etag);
        if (result === 'ok')
            return updated;
        if (result === 'not_found')
            return null;

        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
    }
    throw new Error(`Document ${id} changed too often while saving`);
}
