import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

export class AmoClient {
    constructor({ issuer, secret, fetch: request = globalThis.fetch }) {
        assert(issuer && secret, 'Mozilla API credentials are missing');
        Object.assign(this, { issuer, secret, request });
    }
    async call(path, { method = 'GET', body, missing = false } = {}) {
        assert.match(path, /^(?:addons\/)[A-Za-z0-9@._%{}\/?=-]+$/);
        const now = Math.floor(Date.now() / 1000);
        const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const payload = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: this.issuer, jti: randomUUID(), iat: now - 30, exp: now + 300 })}`;
        const token = `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
        const multipart = body instanceof FormData;
        const response = await this.request(`https://addons.mozilla.org/api/v5/${path}`, {
            method, redirect: 'error', signal: AbortSignal.timeout(300_000),
            headers: { Authorization: `JWT ${token}`, ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? multipart ? body : JSON.stringify(body) : undefined
        });
        if (missing && response.status === 404) return undefined;
        // Never print response bodies, JWTs or credentials to build logs.
        assert(response.ok, `Mozilla ${method} request failed (${response.status}); inspect the retained receipt and Developer Hub`);
        return response.json();
    }
}

export async function submitFirefox({ client, artifact, source, metadata, receipt, checkpoint, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), polls = 60 }) {
    const base = `addons/addon/${encodeURIComponent('uier@signalco.io')}/`;
    let state = receipt ?? { schema: 1, browser: 'firefox', version: artifact.version, commit: artifact.commit, sha256: artifact.sha256, sourceSha256: source.sha256, phase: 'prepared' };
    assert.equal(state.sourceSha256, source.sha256);
    const save = async patch => { state = { ...state, ...patch, updatedAt: new Date().toISOString() }; await checkpoint(state); };
    // A lost response after a mutation is not permission to submit it again.
    assert(!['upload-started', 'submission-started', 'source-upload-started'].includes(state.phase), 'Previous Mozilla write is uncertain; reconcile the durable receipt in Developer Hub');
    if (['submitted-for-review', 'published', 'rejected'].includes(state.phase)) return state;
    if (!state.uploadId) {
        assert(!await client.call(`${base}versions/v${artifact.version}/`, { missing: true }), 'This version already exists without a matching completed receipt');
        const body = new FormData(); body.set('channel', 'listed'); body.set('upload', new Blob([artifact.bytes]), artifact.name);
        await save({ phase: 'upload-started' });
        const upload = await client.call('addons/upload/', { method: 'POST', body });
        assert.match(upload.uuid ?? '', /^[a-f0-9-]{36}$/i);
        await save({ phase: 'validating', uploadId: upload.uuid });
    }
    if (state.phase === 'validating') {
        let valid = false;
        for (let attempt = 0; attempt < polls; attempt++) {
            const upload = await client.call(`addons/upload/${state.uploadId}/`);
            assert.equal(upload.channel, 'listed'); assert.equal(upload.version, artifact.version);
            if (upload.processed) { assert.equal(upload.valid, true, 'Mozilla validation rejected the package'); valid = true; break; }
            if (attempt + 1 < polls) await sleep(5000);
        }
        assert(valid, 'Mozilla validation timed out; rerun to continue polling this upload');
        await save({ phase: 'validated' });
    }
    if (!state.versionId) {
        const addon = await client.call(base, { missing: true });
        await save({ phase: 'submission-started' });
        let version;
        if (addon) version = await client.call(`${base}versions/`, { method: 'POST', body: { ...metadata.version, upload: state.uploadId } });
        else {
            const created = await client.call('addons/addon/', { method: 'POST', body: { ...metadata, version: { ...metadata.version, upload: state.uploadId } } });
            assert.equal(created.guid, 'uier@signalco.io');
            version = created.current_version ?? await client.call(`${base}versions/v${artifact.version}/`);
        }
        assert.equal(version.version, artifact.version); assert(Number.isInteger(version.id));
        await save({ phase: 'version-created', versionId: version.id });
    }
    const body = new FormData(); body.set('source', new Blob([source.bytes]), source.name);
    await save({ phase: 'source-upload-started' });
    await client.call(`${base}versions/${state.versionId}/`, { method: 'PATCH', body });
    await save({ phase: 'submitted-for-review' });
    return state;
}
