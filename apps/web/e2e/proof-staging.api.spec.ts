import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Container, SqlQuerySpec } from '@azure/cosmos';
import sharp from 'sharp';
import { ensureProjectPublicId } from '../src/lib/app/projectPublicIds';
import { projectRefPk, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { getAppStore } from '../src/lib/app/store';
import { signToken } from '../src/lib/app/tokens';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { assetApprovalRoute } from '../src/lib/proofs/approvals/routes';
import { cleanupTransferredProofs, retireProofProject, rotateProofProject } from '../src/lib/proofs/cleanup';
import { proofApi } from '../src/lib/proofs/routes';
import type { ProofAsset, ProofUploadGrant, ProofVersion } from '../src/lib/proofs/model';
import { stagingApi } from '../src/lib/proofs/stagingRoutes';
import { stagingPreview } from '../src/lib/proofs/stagingPreview';
import { proofStore } from '../src/lib/proofs/store';
import { reviewApiHandler } from '../src/lib/review/http';
import { createReviewComment, getReviewStaging } from '../src/lib/review/routes';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import type { StagingPairing } from '../src/lib/proofs/stagingModel';
import { allowedExtensionOperation, extensionOperation } from '@uier/toolbar/extension-contract';
import { persistProjectAccess } from './support/projectAccess';

const app = 'https://app.example';
const live = 'https://staging.example';
const alt = 'https://other.example';
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

async function result<T>(response: Response, status = 200) {
    expect(response.status, await response.clone().text()).toBe(status);
    return await response.json() as T;
}

test('staging requires explicit approval and both authorities, and invalidates links on scope, transfer and deletion', async () => {
    const userId = `u_${randomUUID()}`;
    const store = getAppStore();
    const seed = { id: randomUUID().replaceAll('-', '').slice(0, 12), urls: [live, alt] } as DbProject;
    await persistProjectAccess(seed, [{ userId, name: 'Owner', isAdmin: true }]);
    await store.create<DbProjectRef>({ id: seed.id, type: 'project-ref', pk: projectRefPk(seed.id), workspaceId: seed.workspaceId });
    const project = await ensureProjectPublicId(seed);
    const projectId = project.publicId;
    const params = { params: Promise.resolve({ projectId }) };
    const session = `${cookieName(cookieNames.session)}=${sessionToken(userId).token}`;
    const review = `Bearer ${signToken('review', { uid: userId, pid: project.id }, 300)}`;
    function request(path: string, method = 'GET', body?: unknown, options: { cookie?: string; origin?: string; token?: string; bytes?: Buffer; headers?: HeadersInit } = {}) {
        return new Request(new URL(path, app), { method, headers: {
            host: new URL(app).host, origin: options.origin ?? app, cookie: options.cookie ?? session,
            ...(options.token ? { authorization: options.token } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...Object.fromEntries(new Headers(options.headers))
        }, body: body === undefined ? options.bytes && Uint8Array.from(options.bytes) : JSON.stringify(body) });
    }
    function proof(path: string, method = 'GET', body?: unknown, options?: Parameters<typeof request>[3]) {
        const url = path.startsWith('/api/') ? path : `/api/proofs/${projectId}${path}`;
        return proofApi(request(url, method, body, options), { params: Promise.resolve({
            projectId, proofPath: new URL(url, app).pathname.split('/').slice(4)
        }) }, async () => app);
    }
    function pair(path = '', method = 'GET', body?: unknown, options?: Parameters<typeof request>[3]) {
        const route = new URL('/staging' + path, app);
        return stagingApi(request(route.pathname + route.search, method, body, options), { params: Promise.resolve({
            projectId, stagingPath: route.pathname.split('/').slice(2)
        }) });
    }
    const { asset } = await result<{ asset: ProofAsset }>(await proof('/assets', 'POST', { name: 'Private cover' }), 201);
    const publish = async (previous: string | null) => {
        const bytes = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'red' } }).png().toBuffer();
        const grant = await result<ProofUploadGrant>(await proof(`/assets/${asset.id}/uploads`, 'POST', {
            expectedVersionId: previous, requestId: randomUUID(), filename: 'cover.png', contentType: 'image/png', size: bytes.length
        }));
        const target = grant.uploadUrl!;
        expect((await proof(target, 'PUT', undefined, { bytes, headers: grant.headers, cookie: '' })).status).toBe(204);
        return (await result<{ version: ProofVersion }>(await proof(`/assets/${asset.id}/uploads/${grant.version.id}/finalize`, 'POST'))).version;
    };
    const version = await publish(null);
    const surfaceId = version.manifest!.surfaces[0]!.id;
    const input = { assetId: asset.id, versionId: version.id, surfaceId, url: live + '/checkout', width: 1280, height: 720, requestId: randomUUID() };
    const approvals = (query: string, method: string, body: object) => assetApprovalRoute(request('/approvals' + query, method, body), {
        params: Promise.resolve({ projectId, assetId: asset.id })
    });
    const decision = (decision: string, decisionRevision: number, revision = 1) => approvals('?mode=decision', 'POST', {
        versionId: version.id, decision, decisionRevision, revision, ...(decision === 'changes-requested' ? { explanation: 'Wrong heading.' } : {}), requestId: randomUUID()
    });
    expect((await pair('', 'POST', input)).status).toBe(404);
    await result(await approvals('', 'POST', { versionId: version.id, deadline: null, reviewers: [{ kind: 'member', userId, required: true }], requestId: randomUUID() }));
    expect((await pair('', 'POST', input)).status).toBe(404);
    expect((await decision('approved', 0)).status).toBe(200);
    expect((await pair('', 'POST', { ...input, url: live + '/checkout?auth=secret' })).status).toBe(400);
    expect((await pair('', 'POST', { ...input, url: 'https://another.example/checkout' })).status).toBe(400);
    expect((await pair('', 'POST', { ...input, surfaceId: 'wrong' })).status).toBe(404);
    expect((await pair('', 'POST', input, { cookie: '', token: review })).status).toBe(404);
    const first = await result<StagingPairing>(await pair('', 'POST', input), 201);
    expect(await result(await pair('', 'POST', input), 201)).toEqual(first);
    const path = '/' + first.pairingId;
    const reviewRead = reviewApiHandler(getReviewStaging);
    const readPair = (origin = live, page = '/checkout', token = review) => reviewRead(request(
        '/review?' + new URLSearchParams({ pair: first.pairingId, path: page }), 'GET', undefined, { origin, token, cookie: '' }), params);
    expect((await readPair(alt)).status).toBe(404);
    expect((await readPair(live, '/wrong')).status).toBe(404);
    expect((await readPair(live, '/checkout', '')).status).toBe(404);
    expect(await result(await readPair())).toMatchObject({ id: first.pairingId, width: 1280, height: 720 });
    const logical = `/api/review/${projectId}/staging?pair=${first.pairingId}&path=%2Fcheckout`;
    expect(extensionOperation(app + logical, app, projectId, 'GET').path).toBe('staging');
    expect(allowedExtensionOperation('staging', 'POST')).toBe(false);
    expect(allowedExtensionOperation(`staging-preview/${first.pairingId}`, 'GET')).toBe(false);

    const post = reviewApiHandler(createReviewComment, { verifyWrites: false });
    const commentInput = { position: { type: 'page' }, path: '/checkout', kind: 'feedback', text: 'Shipping differs.',
        stagingPairingId: first.pairingId, idempotencyKey: randomUUID() };
    const create = (body = commentInput, origin = live) => post(request('/review/comments', 'POST', body, { origin, token: review, cookie: '' }), params);
    expect((await create({ ...commentInput, path: '/elsewhere' })).status).toBe(404);
    expect((await create(commentInput, alt)).status).toBe(404);
    const thread = await result<{ id: string; hasDesignReference?: true }>(await create(), 201);
    expect(thread.hasDesignReference).toBe(true);
    expect(JSON.stringify(thread)).not.toContain(asset.id);
    const doc = (await getCommentsStore().get(`project:${project.id}`, thread.id))!.comment;
    expect(doc.assetTarget).toBeUndefined();
    expect(doc.stagingDesign).toEqual({ pairingId: first.pairingId, surfaceId, assetId: asset.id, versionId: version.id });
    expect((await pair(path + '/threads')).status).toBe(200);

    const previewUrl = `/api/review/${projectId}/staging-preview/${first.pairingId}`;
    const previewParams = { params: Promise.resolve({ projectId, pairingId: first.pairingId }) };
    const verifier = '2'.repeat(64);
    const preview = (options: Parameters<typeof request>[3]) => stagingPreview(request(previewUrl, 'POST', { verifier, check: false }, options), previewParams);
    expect((await stagingPreview(request(previewUrl, 'GET', undefined, { cookie: '' }), previewParams)).status).toBe(404);
    expect((await preview({ cookie: '', token: review })).status).toBe(404);
    expect((await preview({ origin: live })).status).toBe(403);
    const bytes = await preview({});
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toMatch(/^image\//);
    expect(bytes.headers.get('cache-control')).toBe('private, no-store');
    const challenge = createHash('sha256').update(verifier).digest('hex');
    const consent = `/app/staging-preview/${projectId}/${first.pairingId}?challenge=${challenge}`;
    expect((await stagingPreview(request(consent, 'POST'), previewParams)).status).toBe(200);
    expect((await preview({ cookie: '' })).status).toBe(200);

    expect((await decision('changes-requested', 1)).status).toBe(200);
    expect((await readPair()).status).toBe(404);
    expect((await create()).status).toBe(404);
    expect((await preview({ cookie: '' })).status).toBe(404);
    expect((await decision('approved', 2)).status).toBe(200);
    expect((await readPair()).status).toBe(404);
    const repaired = await result<StagingPairing>(await pair('', 'POST', { ...input, requestId: randomUUID() }), 201);
    const repairedPath = '/' + repaired.pairingId;
    const next = await publish(version.id);
    expect((await pair('', 'POST', { ...input, versionId: next.id, surfaceId: next.manifest!.surfaces[0]!.id, requestId: randomUUID() })).status).toBe(404);
    expect((await pair(repairedPath + '/open')).status).toBe(303);

    const original = (await store.get<DbProject>(project.pk, project.id))!;
    expect(await store.replace({ ...original.doc, urls: [alt] }, original.etag)).toBe('ok');
    expect((await pair(repairedPath + '/open')).status).toBe(404);
    const removed = (await store.get<DbProject>(project.pk, project.id))!;
    expect(await store.replace(original.doc, removed.etag)).toBe('ok');
    expect((await pair(repairedPath + '/open')).status).toBe(303);
    await rotateProofProject(project.id, '2099-01-01T00:00:00.000Z', store);
    await cleanupTransferredProofs(project.id, store);
    expect((await pair(repairedPath + '/open')).status).toBe(404);
    expect(await store.query({ pk: proofStore(project.id).pk, type: 'proof-staging-pairing' })).toEqual([]);
    await retireProofProject(project.id, store);
    expect((await pair('', 'POST', { ...input, requestId: randomUUID() })).status).toBe(404);
    expect((await getCommentsStore().get(`project:${project.id}`, thread.id))?.comment.id).toBe(thread.id);
});

test('the Cosmos backlink query scopes the page before applying its limit', async () => {
    const queries: SqlQuerySpec[] = [];
    const container = { id: 'comments', items: { query(input: SqlQuerySpec) {
        queries.push(input);
        let pending = true;
        return { hasMoreResults: () => pending, async fetchNext() { pending = false; return { resources: [] }; } };
    } } } as unknown as Container;
    const pairingId = '1'.repeat(64);
    await createCosmosCommentsStore(() => container).listPage('project:paired', {
        limit: 20, path: '/checkout', stagingPairingId: pairingId, originFilter: { origins: [live] },
        visibility: { authorId: 'user:reviewer' }
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toContain('c.stagingDesign.pairingId = @stagingPairingId ORDER BY c.createdAt DESC');
    expect(queries[0]!.query).toContain('NOT IS_DEFINED(c.assetTarget)');
    expect(queries[0]!.parameters).toEqual(expect.arrayContaining([
        { name: '@stagingPairingId', value: pairingId }, { name: '@readerId', value: 'user:reviewer' }, { name: '@limit', value: 20 }
    ]));
});
