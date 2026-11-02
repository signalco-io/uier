import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreClient, submitRelease, targetState, validateTag } from './store-api.mjs';
const name = `publishers/test-publisher/items/${'a'.repeat(32)}`;
const artifact = { version: '1.2.3', commit: 'a'.repeat(40), sha256: 'b'.repeat(64), bytes: new Uint8Array([1, 2, 3]) };
const status = (version, state, kind = 'submitted') => ({ name, ...(version ? { [`${kind}ItemRevisionStatus`]: { state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] } } : {}) });
function fixture(responses, receipt) {
    const calls = [], saved = [];
    const client = new StoreClient({ publisherId: 'test-publisher', extensionId: 'a'.repeat(32), token: 'test-token', fetchImpl: async (url, init) => {
        calls.push({ url, ...init });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert(response, 'Unexpected extra API call');
        return Response.json(response, { status: response.httpStatus ?? 200 });
    } });
    const run = () => submitRelease({ client, artifact, receipt, checkpoint: async value => saved.push(value), sleep: async () => {}, maxPolls: 2 });
    return { run, calls, saved };
}
test('v2 upload + verified version + review submission records intents before writes', async () => {
    const f = fixture([status(), { name, uploadState: 'SUCCEEDED', crxVersion: artifact.version }, status(), { name, state: 'PENDING_REVIEW' }]);
    assert.equal((await f.run()).phase, 'submitted-for-review');
    assert.deepEqual(f.saved.map(r => r.phase), ['uploading', 'uploaded', 'publishing', 'submitted-for-review']);
    assert.equal(f.calls[1].url, `https://chromewebstore.googleapis.com/upload/v2/${name}:upload?uploadType=media`);
    assert.deepEqual(JSON.parse(f.calls[3].body), { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true });
    assert(f.calls.every(call => call.redirect === 'error' && call.headers.Authorization === 'Bearer test-token'));
});
test('matching submitted/published retries are reads only and cannot duplicate a publish', async () => {
    for (const [state, phase] of [['PENDING_REVIEW', 'submitted-for-review'], ['STAGED', 'approved-staged'], ['PUBLISHED', 'published'], ['PUBLISHED_TO_TESTERS', 'published-to-testers']]) {
        const f = fixture([status(artifact.version, state)], { schema: 1, name, ...artifact, phase: 'publishing' });
        assert.equal((await f.run()).phase, phase); assert.equal(f.calls.length, 1);
    }
});
test('receipt mismatch, foreign pending versions, policy warnings and newer versions refuse writes', async () => {
    for (const current of [status('1.2.4', 'PUBLISHED'), status('1.2.2', 'PENDING_REVIEW'), { ...status(), warned: true }, { ...status(), takenDown: true }]) {
        const f = fixture([current]); await assert.rejects(f.run); assert.equal(f.calls.length, 1);
    }
    const mismatch = fixture([], { name, ...artifact, sha256: 'wrong', phase: 'prepared' });
    await assert.rejects(mismatch.run, /conflict/); assert.equal(mismatch.calls.length, 0);
    const unknown = fixture([status(artifact.version, 'PENDING_REVIEW')]);
    await assert.rejects(unknown.run, /no matching/);
});
test('upload/version failure and an uncertain publish are retained and never silently retried', async () => {
    const wrong = fixture([status(), { name, uploadState: 'SUCCEEDED', crxVersion: '9.9.9' }]);
    await assert.rejects(wrong.run, /version differs/); assert.equal(wrong.calls.length, 2);
    const f = fixture([status(), { name, uploadState: 'SUCCEEDED', crxVersion: artifact.version }, status(), new Error('connection lost')]);
    await assert.rejects(f.run, /connection lost/);
    assert.equal(f.saved.at(-1).phase, 'publishing');
    const retry = fixture([status()], f.saved.at(-1)); await assert.rejects(retry.run, /uncertain/); assert.equal(retry.calls.length, 1);
});
test('async uploads are polled boundedly and cannot publish an unconfirmed version', async () => {
    const f = fixture([status(), { name, uploadState: 'IN_PROGRESS' }, { ...status(), lastAsyncUploadState: 'IN_PROGRESS' }, { ...status(), lastAsyncUploadState: 'IN_PROGRESS' }]);
    await assert.rejects(f.run, /bounded polling/); assert.equal(f.calls.length, 4);
    const done = fixture([status(), { name, uploadState: 'IN_PROGRESS' }, { ...status(), lastAsyncUploadState: 'SUCCEEDED' }]);
    await assert.rejects(done.run, /authoritative version/); assert.equal(done.calls.length, 3);
});
test('rejected/cancelled, unknown states and a submission changing during upload fail closed', async () => {
    for (const state of ['REJECTED', 'CANCELLED', 'FUTURE_STATE']) {
        const f = fixture([status(artifact.version, state)], { schema: 1, name, ...artifact, phase: 'publishing' });
        await assert.rejects(f.run); assert.equal(f.calls.length, 1);
    }
    const f = fixture([status(), { name, uploadState: 'SUCCEEDED', crxVersion: artifact.version }, status('1.2.2', 'PENDING_REVIEW')]);
    await assert.rejects(f.run, /Another version/); assert.equal(f.calls.length, 3);
});
test('tag and version syntax cannot introduce refs, shell input or invalid Chrome versions', () => {
    assert.equal(validateTag('extension-v1.2.3'), '1.2.3');
    for (const tag of ['main', 'extension-v01.2.3', 'extension-v1.2.65536', 'extension-v1.2.3;echo secret', 'extension-v1.2.3/other']) assert.throws(() => validateTag(tag));
    assert.equal(targetState(status('1.2.3', 'STAGED'), '1.2.3'), 'approved-staged');
});
