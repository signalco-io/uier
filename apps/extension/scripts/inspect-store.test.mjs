import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreClient } from './store-api.mjs';
import { inspectStore } from './inspect-store.mjs';

test('bootstrap reads an unsubmitted store item without a tag or any write', async () => {
    const calls = [], name = `publishers/publisher/items/${'a'.repeat(32)}`;
    const client = new StoreClient({ publisherId: 'publisher', extensionId: 'a'.repeat(32), token: 'test-token', fetchImpl: async (url, init) => {
        calls.push({ url, init }); return Response.json({ name, lastAsyncUploadState: 'SUCCEEDED', publicKey: 'not-part-of-the-report' });
    } });
    const result = await inspectStore(client);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`);
    assert.equal(calls[0].init.method, undefined);
    assert.deepEqual(result.revisions, []);
    assert.equal(result.lastAsyncUploadState, 'SUCCEEDED');
    assert(!JSON.stringify(result).includes('test-token') && !JSON.stringify(result).includes('publicKey'));
});
test('bootstrap rejects another item or policy-blocked state', async () => {
    const name = `publishers/publisher/items/${'a'.repeat(32)}`;
    for (const payload of [{ name: 'other' }, { name, warned: true }, { name, takenDown: true }]) {
        const client = new StoreClient({ publisherId: 'publisher', extensionId: 'a'.repeat(32), token: 'test-token', fetchImpl: async () => Response.json(payload) });
        await assert.rejects(() => inspectStore(client));
    }
});
