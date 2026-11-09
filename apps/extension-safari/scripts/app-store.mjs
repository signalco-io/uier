import assert from 'node:assert/strict';
import { sign, createPrivateKey } from 'node:crypto';

export class AppStoreClient {
    constructor({ keyId, issuer, privateKey, fetch: request = globalThis.fetch }) {
        assert.match(keyId ?? '', /^[A-Z0-9]{10}$/);
        assert.match(issuer ?? '', /^[a-f0-9-]{36}$/i);
        Object.assign(this, { keyId, issuer, privateKey: createPrivateKey(privateKey), request });
    }
    async call(path, { method = 'GET', body } = {}) {
        assert(path.startsWith('/v1/') && !path.includes('..'));
        const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const payload = `${part({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })}.${part({ iss: this.issuer, iat: now - 30, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
        const token = `${payload}.${sign('sha256', Buffer.from(payload), { key: this.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
        const response = await this.request(`https://api.appstoreconnect.apple.com${path}`, {
            method, redirect: 'error', signal: AbortSignal.timeout(60_000),
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        assert(response.ok, `App Store Connect ${method} failed (${response.status}); inspect App Store Connect and the retained receipt`);
        return response.status === 204 ? undefined : response.json();
    }
}

export async function submitSafari({ client, appId, version, receipt, checkpoint, upload, submitForReview = false,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), polls = 90 }) {
    assert.match(appId ?? '', /^\d+$/);
    let state = receipt;
    const save = async patch => { state = { ...state, ...patch, updatedAt: new Date().toISOString() }; await checkpoint(state); };
    const app = await client.call(`/v1/apps/${appId}`);
    assert.equal(app.data.attributes.bundleId, 'io.uier.safari', 'App Store record has the wrong bundle ID');
    assert.equal(state.appId, appId);
    assert(!state.phase.endsWith('-started'), 'Previous Apple write is uncertain; reconcile the receipt in App Store Connect before retrying');
    if (state.phase === 'submitted-for-review') return state;
    const query = new URLSearchParams({ 'filter[app]': appId, 'filter[version]': version, 'filter[preReleaseVersion.version]': version, limit: '2' });
    const builds = async () => (await client.call(`/v1/builds?${query}`)).data;
    if (state.phase === 'prepared') {
        assert.equal((await builds()).length, 0, 'This build already exists without a matching upload receipt');
        await save({ phase: 'upload-started' });
        await upload();
        await save({ phase: 'processing' });
    }
    if (!state.buildId) {
        for (let attempt = 0; attempt < polls; attempt++) {
            const found = await builds();
            assert(found.length <= 1, 'Ambiguous Apple build identity');
            const build = found[0];
            if (build) {
                assert(!['FAILED', 'INVALID'].includes(build.attributes.processingState), 'Apple rejected the uploaded build');
                if (build.attributes.processingState === 'VALID') { await save({ phase: 'uploaded', buildId: build.id }); break; }
            }
            if (attempt + 1 < polls) await sleep(10_000);
        }
        assert(state.buildId, 'Apple is still processing; rerun to poll without uploading again');
    }
    if (!submitForReview) return state; // Available to TestFlight after Apple processing.
    if (!state.versionId) {
        const versions = await client.call(`/v1/apps/${appId}/appStoreVersions?${new URLSearchParams({ 'filter[versionString]': version, 'filter[platform]': 'MAC_OS', limit: '2' })}`);
        assert(versions.data.length <= 1);
        let record = versions.data[0];
        if (!record) {
            await save({ phase: 'version-create-started' });
            record = (await client.call('/v1/appStoreVersions', { method: 'POST', body: { data: {
                type: 'appStoreVersions', attributes: { platform: 'MAC_OS', versionString: version, releaseType: 'AFTER_APPROVAL' },
                relationships: { app: { data: { type: 'apps', id: appId } } }
            } } })).data;
        }
        assert(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'READY_FOR_REVIEW'].includes(record.attributes.appVersionState ?? record.attributes.appStoreState), 'Version is not editable; inspect App Store Connect');
        await save({ phase: 'version-ready', versionId: record.id });
    }
    // Selecting a known build is idempotent. Apple validates required listing/review metadata.
    await client.call(`/v1/appStoreVersions/${state.versionId}/relationships/build`, { method: 'PATCH', body: { data: { type: 'builds', id: state.buildId } } });
    if (!state.submissionId) {
        await save({ phase: 'review-create-started' });
        const submission = await client.call('/v1/reviewSubmissions', { method: 'POST', body: { data: {
            type: 'reviewSubmissions', attributes: { platform: 'MAC_OS' }, relationships: { app: { data: { type: 'apps', id: appId } } }
        } } });
        await save({ phase: 'review-created', submissionId: submission.data.id });
    }
    if (!state.itemId) {
        await save({ phase: 'review-item-started' });
        const item = await client.call('/v1/reviewSubmissionItems', { method: 'POST', body: { data: {
            type: 'reviewSubmissionItems', relationships: {
                reviewSubmission: { data: { type: 'reviewSubmissions', id: state.submissionId } },
                appStoreVersion: { data: { type: 'appStoreVersions', id: state.versionId } }
            }
        } } });
        await save({ phase: 'review-item-created', itemId: item.data.id });
    }
    await save({ phase: 'review-submit-started' });
    await client.call(`/v1/reviewSubmissions/${state.submissionId}`, { method: 'PATCH', body: { data: {
        type: 'reviewSubmissions', id: state.submissionId, attributes: { submitted: true }
    } } });
    await save({ phase: 'submitted-for-review' });
    return state;
}
