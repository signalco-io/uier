import assert from 'node:assert/strict';

export const storeApiOrigin = 'https://chromewebstore.googleapis.com';
export function validateTag(tag) {
    assert.match(tag ?? '', /^extension-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use extension-vX.Y.Z');
    const version = tag.slice('extension-v'.length);
    assert(version.split('.').some(part => Number(part) > 0), 'Version must be greater than zero');
    assert(version.split('.').every(part => Number(part) <= 65535), 'Version components must not exceed 65535');
    return version;
}
export function compareVersions(a, b) {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
    return 0;
}
export function revisions(status) {
    return ['submitted', 'published'].flatMap(kind => {
        const entry = status[`${kind}ItemRevisionStatus`];
        if (!entry) return [];
        return (entry.distributionChannels ?? []).map(channel => ({ kind, version: channel.crxVersion, state: entry.state, percentage: channel.deployPercentage }));
    });
}
export function targetState(status, version) {
    assert(!status.takenDown && !status.warned, 'Store policy warning or takedown: inspect the dashboard');
    const entries = revisions(status);
    assert(!entries.some(entry => typeof entry.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(entry.version)), 'Store returned an unknown version');
    assert(!entries.some(entry => compareVersions(entry.version, version) > 0), 'A newer version already exists in the store');
    const other = entries.find(entry => entry.kind === 'submitted' && entry.version !== version && ['PENDING_REVIEW', 'STAGED'].includes(entry.state));
    assert(!other, 'Another version is pending; never replace or cancel its submission');
    const target = entries.find(entry => entry.version === version && entry.kind === 'submitted') ?? entries.find(entry => entry.version === version);
    if (!target) return 'not-submitted';
    return ({ PENDING_REVIEW: 'submitted-for-review', STAGED: 'approved-staged', PUBLISHED: 'published', PUBLISHED_TO_TESTERS: 'published-to-testers', REJECTED: 'rejected', CANCELLED: 'cancelled' })[target.state]
        ?? 'unknown';
}
export class StoreClient {
    constructor({ publisherId, extensionId, token, fetchImpl = fetch }) {
        assert.match(publisherId ?? '', /^[A-Za-z0-9_-]{1,128}$/, 'Missing or invalid publisher ID');
        assert.match(extensionId ?? '', /^[a-p]{32}$/, 'Missing or invalid extension ID');
        assert(typeof token === 'string' && token.length > 0, 'Missing short-lived Google access token');
        this.name = `publishers/${publisherId}/items/${extensionId}`;
        this.token = token;
        this.fetch = fetchImpl;
    }
    async request(path, init = {}) {
        // A fixed origin, no credential-bearing redirect and a deadline on every store call.
        const response = await this.fetch(`${storeApiOrigin}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000),
            headers: { ...init.headers, Authorization: `Bearer ${this.token}` } });
        if (!response.ok) throw new Error(`Chrome Web Store API returned HTTP ${response.status}; inspect the dashboard before retrying a write`);
        const result = await response.json();
        assert.equal(result.name, this.name, 'Store response belongs to another item');
        return result;
    }
    status() { return this.request(`/v2/${this.name}:fetchStatus`); }
    upload(bytes) { return this.request(`/upload/v2/${this.name}:upload?uploadType=media`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: bytes }); }
    publish() { return this.request(`/v2/${this.name}:publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }) }); }
}

/** Journal is durably checkpointed before each write. Ambiguous writes are never blindly retried. */
export async function submitRelease({ client, artifact, receipt, checkpoint, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 12 }) {
    const identity = { version: artifact.version, commit: artifact.commit, sha256: artifact.sha256, name: client.name };
    if (receipt) for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, `Release receipt ${key} conflict`);
    if (receipt) assert.equal(receipt.schema, 1, 'Unsupported receipt schema');
    let journal = receipt ?? { schema: 1, ...identity, hostedAcceptance: artifact.hostedAcceptance, phase: 'prepared' };
    const save = async phase => { journal = { ...journal, phase, updatedAt: new Date().toISOString() }; await checkpoint(journal); };
    const status = await client.status();
    const state = targetState(status, artifact.version);
    if (state !== 'not-submitted') {
        assert(receipt && ['publishing', 'submitted-for-review', 'approved-staged', 'published', 'published-to-testers', 'rejected', 'cancelled'].includes(receipt.phase), 'Store version has no matching submission receipt');
        assert.notEqual(state, 'unknown', 'Store returned an unknown submission state');
        await save(state);
        assert(!['rejected', 'cancelled'].includes(state), `Submission ${state}; inspect the dashboard and publish a forward fix`);
        return journal;
    }
    assert(!['publishing', 'submitted-for-review', 'approved-staged', 'published', 'published-to-testers'].includes(journal.phase), 'Submission outcome is uncertain; use the status workflow, do not submit again');
    assert(!['uploading', 'upload-processing', 'uploaded', 'rejected', 'cancelled'].includes(journal.phase), 'Upload/submission needs dashboard reconciliation before a forward fix');
    assert.equal(journal.phase, 'prepared', 'Unknown release receipt phase');
    assert(!['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState), 'An upload is already processing');
    await save('uploading');
    const uploaded = await client.upload(artifact.bytes);
    if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploaded.uploadState)) {
        await save('upload-processing');
        let done = false;
        for (let attempt = 0; attempt < maxPolls; attempt++) {
            await sleep(5000);
            const next = await client.status();
            targetState(next, artifact.version);
            if (next.lastAsyncUploadState === 'FAILED') throw new Error('Async upload failed; inspect the dashboard');
            if (next.lastAsyncUploadState === 'SUCCEEDED') { done = true; break; }
        }
        assert(done, 'Upload is still processing; bounded polling ended without publishing');
        // fetchStatus exposes submitted/published versions, not the unsubmitted upload's version.
        // Do not invent a draft-version field or infer it from SUCCEEDED alone.
        assert.equal(uploaded.crxVersion, artifact.version, 'Async upload completed without an authoritative version; dashboard confirmation is required before publication');
    } else assert.equal(uploaded.uploadState, 'SUCCEEDED', 'Upload did not succeed');
    assert.equal(uploaded.crxVersion, artifact.version, 'Uploaded extension version differs from the tested artifact');
    await save('uploaded');
    // Recheck foreign submissions immediately before publish. No cancellation API is used.
    assert.equal(targetState(await client.status(), artifact.version), 'not-submitted', 'Store state changed during upload');
    await save('publishing');
    const published = await client.publish();
    const mapped = ({ PENDING_REVIEW: 'submitted-for-review', STAGED: 'approved-staged', PUBLISHED: 'published', PUBLISHED_TO_TESTERS: 'published-to-testers' })[published.state];
    assert(mapped, 'Publish returned an unknown state; reconcile using the status workflow');
    await save(mapped);
    return journal;
}
