import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AmoClient, submitFirefox } from './amo.mjs';

const artifact = { version: '0.1.3', commit: 'a'.repeat(40), sha256: 'b'.repeat(64), name: 'package.zip', bytes: Buffer.from('unchanged ZIP') };
const source = { name: 'source.zip', bytes: Buffer.from('source'), sha256: 'c'.repeat(64) };
const metadata = JSON.parse(await readFile(new URL('../amo-metadata.json', import.meta.url), 'utf8'));
function fixture({ existing = false, invalid = false, pending = false, lost, uploadId = '12345678-1234-1234-1234-123456789abc' } = {}) {
    const writes = [], calls = [];
    const client = { async call(path, options = {}) {
        calls.push({ path, ...options });
        if (options.method) {
            writes.push(path);
            if (lost === path) throw new Error('Lost response');
            if (path === 'addons/upload/') {
                assert.equal(await options.body.get('upload').text(), artifact.bytes.toString());
                assert.equal(options.body.get('channel'), 'listed');
                return { uuid: uploadId };
            }
            if (path.endsWith('/eula_policy/')) {
                assert.equal(options.body.privacy_policy['en-US'], metadata.privacy_policy['en-US']);
                return {};
            }
            if (options.method === 'PATCH') { assert.equal(await options.body.get('source').text(), source.bytes.toString()); return {}; }
            if (path === 'addons/addon/') {
                assert.deepEqual(options.body.categories, { firefox: ['web-development'] });
                assert.deepEqual(options.body.version.compatibility, ['firefox']);
                assert(!('privacy_policy' in options.body));
                return { guid: 'uier@signalco.io', version: { id: 42, version: artifact.version } };
            }
            return { id: 42, version: artifact.version };
        }
        if (path.includes('versions/v')) return undefined;
        if (path.startsWith('addons/upload/')) return { processed: !pending, valid: !invalid, channel: 'listed', version: artifact.version };
        return existing ? { guid: 'uier@signalco.io' } : undefined;
    } };
    let receipt;
    return { client, writes, calls, get receipt() { return receipt; }, checkpoint: async value => { receipt = structuredClone(value); } };
}
test('Mozilla authentication signs a short-lived JWT and refuses redirects', async () => {
    const client = new AmoClient({ issuer: 'publisher', secret: 'local-test-secret', async fetch(url, init) {
        assert.equal(url, 'https://addons.mozilla.org/api/v5/addons/upload/'); assert.equal(init.redirect, 'error');
        const [head, body, signature] = init.headers.Authorization.slice(4).split('.');
        assert.equal(signature, createHmac('sha256', 'local-test-secret').update(`${head}.${body}`).digest('base64url'));
        const claims = JSON.parse(Buffer.from(body, 'base64url')); assert.equal(claims.iss, 'publisher');
        assert(claims.exp > claims.iat && claims.exp - claims.iat <= 300, 'Mozilla limits JWT lifetime to five minutes');
        return Response.json({ okay: true });
    } });
    assert.deepEqual(await client.call('addons/upload/'), { okay: true });
    await assert.rejects(client.call('https://evil.test/'), /match/);
});
for (const existing of [false, true]) test(`Mozilla ${existing ? 'update' : 'first listing'} retains ZIP identity and supplies original source`, async () => {
    const f = fixture({ existing });
    const result = await submitFirefox({ ...f, artifact, source, metadata });
    assert.equal(result.phase, 'submitted-for-review'); assert.equal(result.versionId, 42);
    assert.equal(f.writes.length, 4); assert.equal(f.writes[1], existing ? 'addons/addon/uier%40signalco.io/versions/' : 'addons/addon/');
});
test('Mozilla compact upload IDs are retained and used for validation without another upload', async () => {
    const uploadId = '02efc8454fd34e20895bfb5dfb43f318';
    const f = fixture({ uploadId, pending: true });
    await assert.rejects(submitFirefox({ ...f, artifact, source, metadata, polls: 1 }), /timed out/);
    assert.equal(f.receipt.uploadId, uploadId);
    assert.equal(f.receipt.phase, 'validating');
    const ready = fixture();
    await submitFirefox({ ...ready, receipt: f.receipt, artifact, source, metadata });
    assert(ready.calls.some(call => call.path === `addons/upload/${uploadId}/`));
    assert(!ready.writes.includes('addons/upload/'));
});
for (const uploadId of ['a'.repeat(36), '-'.repeat(36), '../uploads', '']) test(`malformed Mozilla upload ID ${JSON.stringify(uploadId)} cannot reach validation or submission`, async () => {
    const f = fixture({ uploadId });
    await assert.rejects(submitFirefox({ ...f, artifact, source, metadata }), /match/);
    assert.equal(f.receipt.phase, 'upload-started');
    assert.deepEqual(f.writes, ['addons/upload/']);
});
test('validation timeout resumes the same upload without a second store upload', async () => {
    const f = fixture({ pending: true });
    await assert.rejects(submitFirefox({ ...f, artifact, source, metadata, polls: 1 }), /timed out/);
    assert.equal(f.receipt.phase, 'validating');
    const ready = fixture();
    await submitFirefox({ ...ready, receipt: f.receipt, artifact, source, metadata });
    assert(!ready.writes.includes('addons/upload/'));
});
for (const lost of ['addons/upload/', 'addons/addon/', 'addons/addon/uier%40signalco.io/eula_policy/', 'addons/addon/uier%40signalco.io/versions/42/']) test(`lost Mozilla response at ${lost} cannot trigger a duplicate write`, async () => {
    const f = fixture({ lost });
    await assert.rejects(submitFirefox({ ...f, artifact, source, metadata }), /Lost response/);
    const before = f.calls.length;
    await assert.rejects(submitFirefox({ ...f, receipt: f.receipt, artifact, source, metadata }), /uncertain/);
    assert.equal(f.calls.length, before);
});
test('failed Mozilla validation never creates a version', async () => {
    const f = fixture({ invalid: true });
    await assert.rejects(submitFirefox({ ...f, artifact, source, metadata }), /rejected/);
    assert.deepEqual(f.writes, ['addons/upload/']);
});
