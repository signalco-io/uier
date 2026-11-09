import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { AppStoreClient, submitSafari } from './app-store.mjs';
import { appleVersion } from './native.mjs';

test('Apple JWT uses ES256 with short expiry and the App Store audience', async () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const client = new AppStoreClient({ keyId: 'ABCDEFGHIJ', issuer: '12345678-1234-1234-1234-123456789abc',
        privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), async fetch(url, init) {
            assert.equal(url, 'https://api.appstoreconnect.apple.com/v1/apps/123'); assert.equal(init.redirect, 'error');
            const [head, body, signature] = init.headers.Authorization.slice(7).split('.');
            assert(verify('sha256', Buffer.from(`${head}.${body}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
            const claims = JSON.parse(Buffer.from(body, 'base64url')); assert.equal(claims.aud, 'appstoreconnect-v1'); assert(claims.exp - claims.iat < 1200);
            return Response.json({ data: {} });
        } });
    await client.call('/v1/apps/123');
    await assert.rejects(client.call('https://evil.test/v1/apps'), /assertion|false|true/i);
});
test('Safari versions fit both marketing and CFBundleVersion fields', () => {
    assert.equal(appleVersion('0.1.3'), '0.1.3');
    for (const version of ['1.0', '1.100.1', '10000.1.1', '1.0.0-beta']) assert.throws(() => appleVersion(version));
});
function fixture({ wrongApp = false, processing = false, lost } = {}) {
    let uploaded = false, receipt = { appId: '123', phase: 'prepared', version: '0.1.3' };
    const calls = [], writes = [];
    const client = { async call(path, options = {}) {
        calls.push(path);
        if (options.method) {
            writes.push(path);
            if (path === lost) throw new Error('Lost response');
            if (path === '/v1/appStoreVersions') return { data: { id: 'version1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } } };
            if (path === '/v1/reviewSubmissions') return { data: { id: 'review1' } };
            if (path === '/v1/reviewSubmissionItems') return { data: { id: 'item1' } };
            return { data: {} };
        }
        if (path === '/v1/apps/123') return { data: { attributes: { bundleId: wrongApp ? 'wrong.bundle' : 'io.uier.safari' } } };
        if (path.startsWith('/v1/builds?')) return { data: uploaded ? [{ id: 'build1', attributes: { processingState: processing ? 'PROCESSING' : 'VALID' } }] : [] };
        if (path.includes('appStoreVersions?')) return { data: [] };
        throw new Error(`Unexpected ${path}`);
    } };
    return { client, calls, writes, get receipt() { return receipt; }, upload: async () => { uploaded = true; writes.push('transporter'); },
        checkpoint: async value => { receipt = structuredClone(value); }, appId: '123', version: '0.1.3' };
}
test('Apple upload is distinct from review submission', async () => {
    const f = fixture();
    const result = await submitSafari({ ...f });
    assert.equal(result.phase, 'uploaded'); assert.equal(result.buildId, 'build1'); assert.deepEqual(f.writes, ['transporter']);
});
test('Apple review selects the processed build, creates an item, then submits it', async () => {
    const f = fixture();
    const result = await submitSafari({ ...f, submitForReview: true });
    assert.equal(result.phase, 'submitted-for-review');
    assert.deepEqual(f.writes, ['transporter', '/v1/appStoreVersions', '/v1/appStoreVersions/version1/relationships/build', '/v1/reviewSubmissions', '/v1/reviewSubmissionItems', '/v1/reviewSubmissions/review1']);
});
test('Apple refuses to upload to the wrong app', async () => {
    const f = fixture({ wrongApp: true });
    await assert.rejects(submitSafari({ ...f }), /wrong bundle/); assert.equal(f.writes.length, 0);
});
for (const phase of ['upload-started', 'review-create-started', 'review-item-started', 'review-submit-started']) test(`Apple ${phase} receipt blocks repeating an uncertain write`, async () => {
    const f = fixture();
    await assert.rejects(submitSafari({ ...f, receipt: { ...f.receipt, phase } }), /uncertain/); assert.equal(f.writes.length, 0);
});
test('Apple processing timeout retains the accepted upload for later polling', async () => {
    const f = fixture({ processing: true });
    await assert.rejects(submitSafari({ ...f, polls: 1 }), /still processing/);
    assert.equal(f.receipt.phase, 'processing'); assert.deepEqual(f.writes, ['transporter']);
    const ready = fixture();
    // Seed its simulated server with the uploaded binary, then clear its local write log.
    await ready.upload(); ready.writes.length = 0;
    const result = await submitSafari({ ...ready, receipt: f.receipt });
    assert.equal(result.phase, 'uploaded'); assert.deepEqual(ready.writes, []);
});
test('lost Apple review submission response is durably recorded before the write', async () => {
    const f = fixture({ lost: '/v1/reviewSubmissions/review1' });
    await assert.rejects(submitSafari({ ...f, submitForReview: true }), /Lost response/);
    assert.equal(f.receipt.phase, 'review-submit-started');
});
