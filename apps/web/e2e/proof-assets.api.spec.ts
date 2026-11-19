import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { createProject, updateProject } from '../src/lib/app/projects';
import { createWorkspace, ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { findOrCreateUser } from '../src/lib/app/users';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { getAppStore } from '../src/lib/app/store';
import { memberId, workspacePk, type DbMember } from '../src/lib/app/model';
import { deleteProject, queueProjectDeletion, runProjectDeletion } from '../src/lib/app/projectDeletion';
import { transferProject } from '../src/lib/app/projectTransfer';
import { authorizeProof } from '../src/lib/proofs/access';
import { getProofBlobs, proofAssetPrefix, proofStagedBlob, proofVersionPrefix } from '../src/lib/proofs/blobs';
import { deleteProjectProofs, sweepProofStorage } from '../src/lib/proofs/cleanup';
import { proofApi } from '../src/lib/proofs/routes';
import { processProofUpload } from '../src/lib/proofs/uploads';
import { proofStore } from '../src/lib/proofs/store';
import { MAX_PROOF_UPLOAD_BYTES, proofApiPath, type ProofAsset, type ProofAssetDetail, type ProofLibrary,
    type ProofShare, type ProofUploadGrant, type ProofVersion } from '../src/lib/proofs/model';
import type { AppContext } from '../src/lib/app/context';

const hostUrl = 'http://127.0.0.1:4651';
const host = new URL(hostUrl).host;
test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
});

function send(projectId: string, path = '', { method = 'GET', cookies, json, bytes, headers }: {
    method?: string; cookies?: string; json?: unknown; bytes?: Buffer; headers?: HeadersInit
} = {}) {
    const url = new URL(path.startsWith('/api/') ? path : proofApiPath(projectId) + path, hostUrl);
    const requestHeaders = new Headers({ host, Origin: hostUrl, 'Sec-Fetch-Site': 'same-origin' });
    if (cookies) requestHeaders.set('cookie', cookies);
    if (json !== undefined) requestHeaders.set('Content-Type', 'application/json');
    new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
    const body = json !== undefined ? JSON.stringify(json) : bytes ? Uint8Array.from(bytes) : undefined;
    const segments = url.pathname.split('/').slice(3);
    const [actualProject, ...proofPath] = segments;
    return proofApi(new Request(url, { method, headers: requestHeaders, body }),
        { params: Promise.resolve({ projectId: actualProject!, proofPath }) }, async () => hostUrl);
}

async function body<T>(response: Response, status = 200) {
    expect(response.status, await response.clone().text()).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return await response.json() as T;
}

async function fixture() {
    const store = getAppStore();
    const user = await findOrCreateUser(`proof-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Private proof fixture', mode: 'files', urls: [] });
    await updateProject(workspace.id, project.id, { access: 'guests' });
    const projectId = project.publicId;
    const cookies = `${cookieName(cookieNames.session)}=${sessionToken(user.id).token}`;
    const memberApi = (path = '', options: Parameters<typeof send>[2] = {}) => send(projectId, path, { ...options, cookies });
    const createAsset = async (name: string, collectionId?: string) =>
        (await body<{ asset: ProofAsset }>(await memberApi('/assets', { method: 'POST', json: { name, collectionId } }), 201)).asset;
    return { store, context, project, projectId, cookies, memberApi, createAsset };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function png(color = 'red') {
    return sharp({ create: { width: 5, height: 3, channels: 3, background: color } }).png().toBuffer();
}

async function upload(f: Fixture, assetId: string, bytes: Buffer, expectedVersionId: string | null = null, contentType = 'image/png', requestId = randomUUID()) {
    const path = `/assets/${assetId}/uploads`;
    const json = { filename: 'Page ü.png', contentType, size: bytes.length, expectedVersionId, requestId };
    const grant = await body<ProofUploadGrant>(await f.memberApi(path, { method: 'POST', json }));
    expect(grant.version.status).toBe('pending');
    const put = async (source = bytes, url = grant.uploadUrl!) => {
        if (url.startsWith('/api/')) return send(f.projectId, url, { method: 'PUT', headers: grant.headers, bytes: source });
        return fetch(url, { method: 'PUT', headers: grant.headers, body: Uint8Array.from(source) });
    };
    const finalize = () => f.memberApi(`${path}/${grant.version.id}/finalize`, { method: 'POST' });
    return { grant, put, finalize, path, json };
}

async function publish(f: Fixture, asset: ProofAsset) {
    const source = await png();
    const uploadProof = await upload(f, asset.id, source);
    expect((await uploadProof.put()).ok).toBe(true);
    const { version } = await body<{ version: ProofVersion }>(await uploadProof.finalize());
    return { version, source };
}

async function share(f: Fixture, scope: ProofShare['scope'], permission: ProofShare['permission'] = 'view', downloadOriginal = false) {
    const result = await body<{ share: ProofShare; url: string }>(await f.memberApi('/shares', {
        method: 'POST', json: { scope, permission, downloadOriginal }
    }), 201);
    const token = new URLSearchParams(new URL(result.url).hash.slice(1)).get('share')!;
    const exchange = (cookies?: string) => send(f.projectId, '/exchange', { method: 'POST', json: { token }, cookies });
    const response = await exchange();
    expect(await body(response)).toEqual({ scope });
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies.every(value => value.includes('HttpOnly'))).toBe(true);
    const cookies = setCookies.map(value => value.split(';')[0]).join('; ');
    return { ...result, exchange, cookies, guestApi: (path = '', options: Parameters<typeof send>[2] = {}) =>
        send(f.projectId, path, { ...options, cookies }) };
}

test('create-only upload, idempotent publish, private byte ranges and authorized originals', async () => {
    const f = await fixture();
    const asset = await f.createAsset('Private image');
    const bytes = await png();
    const pending = await upload(f, asset.id, bytes);
    const earlier = await body<ProofUploadGrant>(await f.memberApi(pending.path, { method: 'POST', json: pending.json }));
    expect(earlier.version.id).toBe(pending.grant.version.id);
    const mismatch = await f.memberApi(pending.path, { method: 'POST', json: { ...pending.json, filename: 'different.png' } });
    expect(mismatch.status).toBe(409);
    expect((await pending.finalize()).status).toBe(409);
    const staged = await pending.put();
    expect(staged.ok, await staged.text()).toBe(true);
    const retry = await body<ProofUploadGrant>(await f.memberApi(pending.path, { method: 'POST', json: pending.json }));
    expect(retry.uploadUrl).toBeNull();
    const tampered = Buffer.from(bytes);
    tampered[30] = tampered[30]! ^ 1;
    expect((await pending.put(tampered)).ok).toBe(false);

    const { version } = await body<{ version: ProofVersion }>(await pending.finalize());
    expect(version).toMatchObject({ status: 'published', number: 1, size: bytes.length, digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        manifest: { format: 'image', surfaces: [{ id: 'image', width: 5, height: 3, artifactId: 'image' }] } });
    expect(await body(await pending.finalize())).toEqual({ version });
    const media = version.artifacts[0]!.url;
    expect((await send(f.projectId, media)).status).toBe(404);
    expect((await send(f.projectId, version.originalUrl!)).status).toBe(404);
    const partial = await f.memberApi(media, { headers: { Range: 'bytes=0-3' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await partial.arrayBuffer()).toString('ascii')).toBe('RIFF');
    expect((await f.memberApi(media, { headers: { Range: 'bytes=1000000-' } })).status).toBe(416);
    const original = await f.memberApi(version.originalUrl!);
    expect(original.headers.get('content-disposition')).toContain('Page%20%C3%BC.png');
    expect(original.headers.get('content-type')).toBe('application/octet-stream');
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    expect((await f.memberApi(media, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
});

test('large staged sources stream through the authorized original endpoint', async () => {
    const f = await fixture();
    const asset = await f.createAsset('Large private source');
    const source = await sharp({ create: { width: 1300, height: 1300, channels: 3, background: 'blue' } })
        .png({ compressionLevel: 0 }).toBuffer();
    expect(source.length).toBeGreaterThan(4_500_000);
    const pending = await upload(f, asset.id, source);
    expect((await pending.put()).ok).toBe(true);
    const { version } = await body<{ version: ProofVersion }>(await pending.finalize());
    const original = await f.memberApi(version.originalUrl!);
    expect(original.status).toBe(200);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(source);
});

test('compare-and-swap publishes one revision and keeps all accepted versions after a validation failure', async () => {
    const f = await fixture();
    const asset = await f.createAsset('Revisions');
    const { version: v1 } = await publish(f, asset);
    const bytes = await png('blue');
    const [a, b] = await Promise.all([upload(f, asset.id, bytes, v1.id), upload(f, asset.id, bytes, v1.id)]);
    expect((await a.put()).ok).toBe(true);
    expect((await b.put()).ok).toBe(true);
    const competing = await Promise.all([a.finalize(), b.finalize()]);
    expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
    const { version: v2 } = await body<{ version: ProofVersion }>(competing.find(response => response.ok)!);
    expect(v2.number).toBe(2);
    const masquerade = await upload(f, asset.id, Buffer.from('<svg><script>void 0</script></svg>'), v2.id);
    expect((await masquerade.put()).ok).toBe(true);
    expect((await masquerade.finalize()).status).toBe(422);
    expect((await masquerade.finalize()).status).toBe(422);
    const detail = await body<ProofAssetDetail>(await f.memberApi(`/assets/${asset.id}`));
    expect(detail.asset.currentVersionId).toBe(v2.id);
    expect(detail.versions.filter(version => version.status === 'published').map(version => version.id)).toEqual([v2.id, v1.id]);
    expect((await f.memberApi(v1.originalUrl!)).status).toBe(200);
    expect((await f.memberApi(a.path, { method: 'POST', json: { ...a.json, size: MAX_PROOF_UPLOAD_BYTES + 1 } })).status).toBe(413);
});

test('collection and asset shares bound listing, immutable versions, commenting and original download', async () => {
    const f = await fixture();
    const { collection } = await body<{ collection: { id: string } }>(await f.memberApi('/collections', { method: 'POST', json: { name: 'Client' } }), 201);
    const scoped = await f.createAsset('First file', collection.id);
    await f.createAsset('Unpublished', collection.id);
    const other = await f.createAsset('Internal file');
    const { version } = await publish(f, scoped);
    const { version: sibling } = await publish(f, other);
    const invite = await share(f, { kind: 'collection', id: collection.id });
    expect((await body<ProofLibrary>(await invite.guestApi())).assets.map(asset => asset.id)).toEqual([scoped.id]);
    const guest = await body<ProofAssetDetail>(await invite.guestApi(`/assets/${scoped.id}?version=${version.id}`));
    expect(guest.permissions).toEqual({ view: true, comment: false, downloadOriginal: false, manage: false });
    expect(guest.version?.originalUrl).toBeUndefined();
    expect((await invite.guestApi(version.originalUrl!)).status).toBe(403);
    expect((await invite.guestApi(sibling.artifacts[0]!.url)).status).toBe(404);
    expect((await invite.guestApi(`/assets/${scoped.id}?version=${sibling.id}`)).status).toBe(404);
    expect((await invite.guestApi('/shares')).status).toBe(403);
    const grant = await share(f, { kind: 'asset', id: scoped.id }, 'comment', true);
    const authorization = await authorizeProof(new Request(hostUrl, { headers: { cookie: grant.cookies } }),
        { projectId: f.projectId, assetId: scoped.id, versionId: version.id }, 'comment');
    expect(authorization.actor).toMatchObject({ kind: 'guest', scope: { kind: 'asset', id: scoped.id } });
    expect((await grant.guestApi(version.originalUrl!)).status).toBe(200);

    await f.memberApi(`/assets/${scoped.id}`, { method: 'PATCH', json: { collectionId: null } });
    expect((await invite.guestApi(version.artifacts[0]!.url)).status).toBe(404);
    expect((await grant.guestApi(version.artifacts[0]!.url)).status).toBe(200);
    await updateProject(f.context.workspace.id, f.project.id, { access: 'invited' });
    expect((await grant.guestApi(version.artifacts[0]!.url)).status).toBe(404);
    await updateProject(f.context.workspace.id, f.project.id, { access: 'guests' });
    expect((await f.memberApi(`/shares/${grant.share.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await grant.exchange(grant.cookies)).status).toBe(404);
    expect((await grant.guestApi(version.artifacts[0]!.url)).status).toBe(404);

    expect((await f.memberApi('/settings', { method: 'PATCH', json: { formats: [] } })).status).toBe(200);
    expect((await f.memberApi(version.artifacts[0]!.url)).status).toBe(200);
    expect((await f.memberApi(`/assets/${scoped.id}/uploads`, { method: 'POST',
        json: { requestId: randomUUID(), expectedVersionId: version.id, filename: 'later.png', contentType: 'image/png', size: 10 } })).status).toBe(415);
});

test('abandoned processing resumes from staged bytes and removes superseded blobs', async () => {
    const f = await fixture();
    const asset = await f.createAsset('Background retry');
    const pending = await upload(f, asset.id, await png());
    expect((await pending.put()).ok).toBe(true);
    const blobs = getProofBlobs();
    const injected = { ...blobs, async put(name: string, bytes: Buffer, contentType: string) {
        if (name.endsWith('/original')) await blobs.put(name, bytes, contentType);
        throw new Error('simulated process interruption after writing a candidate');
    } };
    const versionId = pending.grant.version.id;
    await expect(processProofUpload({ project: f.project, userId: f.context.user.id, assetId: asset.id, versionId, blobs: injected }))
        .rejects.toThrow('simulated process interruption');
    const proofs = proofStore(f.project.id);
    const job = (await proofs.version(versionId))!;
    const expired = new Date(Date.now() - 1000).toISOString();
    expect(await f.store.replace({ ...job.doc, attempt: { id: job.doc.attempt!.id, until: expired }, nextAttemptAt: expired }, job.etag)).toBe('ok');
    expect(await sweepProofStorage()).toEqual({ failed: 0 });
    const published = (await proofs.version(versionId))!.doc;
    expect(published.status).toBe('published');
    expect(published.publishedAttemptId).not.toBe(job.doc.attempt!.id);
    await sweepProofStorage({ now: Date.now() + 60 * 60_000 });
    const objects: string[] = [];
    for await (const blob of blobs.list(proofVersionPrefix(published))) objects.push(blob.name);
    expect(objects).toHaveLength(2);
    expect(objects.every(name => name.includes(published.publishedAttemptId!))).toBe(true);
    expect(await blobs.readStaged(proofStagedBlob(published), published.size)).toBeNull();
});

test('transfer retires grants and staging, and deletion removes the published files and their records', async () => {
    const f = await fixture();
    const asset = await f.createAsset('Moving proof');
    const { version } = await publish(f, asset);
    const pending = await upload(f, asset.id, await png('yellow'), version.id);
    expect((await pending.put()).ok).toBe(true);
    const invite = await share(f, { kind: 'asset', id: asset.id }, 'comment', true);
    const target = await createWorkspace(f.context.user, 'Target for proof');
    const targetMember = (await f.store.get<DbMember>(workspacePk(target.id), memberId(f.context.user.id)))!.doc;
    const targetContext: AppContext = { ...f.context, workspace: target, member: targetMember,
        memberships: [...f.context.memberships, { workspace: target, member: targetMember }] };
    await transferProject(f.context, f.project.id, target.id, f.project.name);
    expect((await invite.exchange()).status).toBe(404);
    expect((await invite.guestApi(version.originalUrl!)).status).toBe(404);
    expect((await f.memberApi(version.originalUrl!)).status).toBe(200);
    expect((await pending.finalize()).status).toBe(404);
    const proofs = proofStore(f.project.id);
    expect((await proofs.version(pending.grant.version.id))?.doc.status).toBe('failed');

    expect((await f.memberApi(`/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await f.memberApi(version.originalUrl!)).status).toBe(404);
    expect(await sweepProofStorage({ now: Date.now() + 60 * 60_000 })).toEqual({ failed: 0 });
    expect(await proofs.asset(asset.id)).toBeNull();
    const remaining = await f.createAsset('Left in deleted project');
    await publish(f, remaining);
    const moved = { ...f.project, workspaceId: target.id, pk: workspacePk(target.id) };
    const intent = await queueProjectDeletion(moved, f.context.user.id);
    await deleteProject(targetContext, f.project.id, f.project.name);
    expect((await f.memberApi()).status).toBe(404);
    expect((await proofs.guard())?.doc.deleted).toBe(true);
    expect(await deleteProjectProofs(f.project.id, f.store, Date.now() + 60 * 60_000)).toBe(true);
    await runProjectDeletion(intent);
    expect(await proofs.assets()).toHaveLength(0);
    expect(await proofs.shares()).toHaveLength(0);
    for await (const _ of getProofBlobs().list(proofAssetPrefix(f.project.id, remaining.id))) throw new Error('A deleted proof blob remains.');
});
