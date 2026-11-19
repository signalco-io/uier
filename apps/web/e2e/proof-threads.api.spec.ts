import { randomUUID } from 'node:crypto';
import type { Container } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import { ensureProjectPublicId } from '../src/lib/app/projectPublicIds';
import { getAppStore } from '../src/lib/app/store';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { randomToken, sha256Hex } from '../src/lib/app/tokens';
import type { DbProject, DbProjectRef } from '../src/lib/app/model';
import { projectRefPk } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { getProjectComment, listProjectComments, projectPartition, setProjectCommentResolved } from '../src/lib/review/comments';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { authorizeProofThread } from '../src/lib/proofs/threadAccess';
import { exchangeProofShare } from '../src/lib/proofs/access';
import { proofStore, type DbProofAsset, type DbProofShare, type DbProofVersion } from '../src/lib/proofs/store';
import { changeProofThread, createProofThread, exportProofThread, getProofThread, listProofThreads, listProofVerification, replyToProofThread, verifyProofThread } from '../src/lib/proofs/threadRoutes';
import type { ProofManifest } from '../src/lib/proofs/model';
import type { ProofPendingPage, ProofThread, ProofThreadLocation } from '../src/lib/proofs/threadModel';
import { persistProjectAccess } from './support/projectAccess';

const origin = 'https://proof.example';
const now = new Date().toISOString();
const key = () => randomUUID();
const threadFrom = async (response: Response) => (await response.json() as { thread: ProofThread }).thread;
const location = (versionId: string, x = 0.5): ProofThreadLocation => ({ versionId, anchor: { kind: 'point', surfaceId: 'page', x, y: 0.6 } });

const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

async function fixture(manifestFor?: (id: string) => ProofManifest) {
    const owner = { kind: 'member', userId: `u_owner_${key()}`, name: 'Developer', isAdmin: true } as const;
    const reviewer = { kind: 'member', userId: `u_reviewer_${key()}`, name: 'Reviewer', isAdmin: false } as const;
    const projectSeed = { id: key().replaceAll('-', '').slice(0, 12), verificationEnabled: true, access: 'guests' } as DbProject;
    await persistProjectAccess(projectSeed, [owner, reviewer]);
    const app = getAppStore();
    await app.create<DbProjectRef>({ type: 'project-ref', id: projectSeed.id, pk: projectRefPk(projectSeed.id), workspaceId: projectSeed.workspaceId });
    const project = await ensureProjectPublicId(projectSeed);
    const proofs = proofStore(project.id);
    const asset = async (assetId: string, versions: string[], current: string) => {
        await app.create<DbProofAsset>({ id: assetId, pk: proofs.pk, type: 'proof-asset', name: assetId, collectionId: null,
            position: 0, createdAt: now, updatedAt: now, currentVersionId: current });
        await Promise.all(versions.map((id, index) => app.create<DbProofVersion>({
            id, pk: proofs.pk, type: 'proof-version', projectId: project.id, workspaceId: project.workspaceId, epoch: 'initial',
            assetId, uploaderId: owner.userId, expectedVersionId: versions[index - 1] ?? null, number: index + 1, status: 'published',
            filename: 'menu.png', contentType: 'image/png', size: 1, uploadUntil: now, grantUntil: now, createdAt: now, publishedAt: now,
            manifest: manifestFor?.(id) ?? { format: 'image', surfaces: [{ id: 'page', artifactId: 'preview' }] }, artifacts: [{ id: 'preview', contentType: 'image/png', size: 1 }]
        })));
    };
    await Promise.all([asset('asset_a', ['v1', 'v2', 'v3'], 'v2'), asset('asset_b', ['v4'], 'v4')]);
    const token = randomToken();
    const shareId = key();
    await app.create<DbProofShare>({ id: shareId, type: 'proof-share', pk: proofs.pk, tokenHash: sha256Hex(token), epoch: 'initial', workspaceId: project.workspaceId,
        assetId: 'asset_a', scope: { kind: 'asset', id: 'asset_a' }, permission: 'comment', downloadOriginal: false, createdAt: now, expiresAt: null, revokedAt: null });
    const guestCookie = async () => (await exchangeProofShare(new Request(origin), project.publicId, token)).cookies.map(cookie => cookie.split(';')[0]).join('; ');
    const memberCookie = (actor: typeof owner | typeof reviewer) => `${cookieName(cookieNames.session)}=${sessionToken(actor.userId).token}`;
    const route = { projectId: project.publicId, assetId: 'asset_a' };
    const ctx = (threadId?: string, next = route) => ({ params: Promise.resolve({ ...next, threadId: threadId ?? '' }) });
    const make = (cookie?: string, body?: unknown, method = body ? 'POST' : 'GET', query = '') => new Request(origin + '/api/proofs/test' + query, {
        method, headers: { host: new URL(origin).host, origin, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const ownerCookie = memberCookie(owner);
    const open = async (cookie = ownerCookie, extra = {}) => {
        const response = await createProofThread(make(cookie, { text: 'Correct the price', authorName: 'Guest reviewer', idempotencyKey: key(), location: location('v1'), ...extra }),
            { params: Promise.resolve(route) });
        expect(response.status, await response.clone().text()).toBe(201);
        return await threadFrom(response);
    };
    const ask = (thread: ProofThread, extra = {}) => ({
        action: 'request', reviewerId: 'author', expectedRevision: thread.verification?.revision ?? null,
        idempotencyKey: key(), evidence: { assetId: 'asset_a', before: thread.target.source, after: location('v2', 0.7) }, ...extra
    });
    const postVerification = (cookie: string, thread: ProofThread, body: object) => verifyProofThread(make(cookie, body), ctx(thread.id));
    return { owner, reviewer, ownerCookie, memberCookie, guestCookie, project, route, app, proofs, shareId, ctx, make, open, ask, postVerification };
}

test('a guest file thread remains scoped on direct IDs, replies and all website query paths', async () => {
    const f = await fixture();
    const guest = await f.guestCookie();
    const first = await f.open(guest);
    const { project } = f;
    expect(first.target).toEqual({ assetId: 'asset_a', source: location('v1') });
    const proofReader = await authorizeProofThread(f.make(guest), f.route, 'v1');
    const legacyGuest = { kind: 'guest', visitorId: proofReader.actor.kind === 'guest' ? proofReader.actor.visitorId : '' } as const;
    expect(legacyGuest.visitorId).not.toBe('');
    expect(JSON.stringify(first)).not.toContain(legacyGuest.visitorId);
    expect(JSON.stringify(first)).not.toContain(f.shareId);
    expect(first.href).toBe(`/proof/${project.publicId}/asset_a?version=v1&thread=${first.id}`);
    await expect(getProjectComment(project, legacyGuest, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(setProjectCommentResolved(project, legacyGuest, first.id, true)).rejects.toMatchObject({ status: 404 });
    await expect(projectFeedbackExport(project, legacyGuest, first.id, undefined, origin)).rejects.toMatchObject({ status: 404 });
    expect(await listProjectComments(project, legacyGuest)).toEqual([]);
    const store = getMemoryCommentsStore();
    const domain = projectPartition(project.id);
    expect(await store.queryCandidates(domain)).toEqual([]);
    expect(await store.countOpen(domain)).toBe(0);
    expect(await store.listRealtime(domain)).toEqual([]);
    expect(await store.listActivity(domain)).toEqual([]);
    expect(await store.listAll(domain, 10, undefined, undefined, undefined, { includeProofs: true })).toHaveLength(1);
    expect((await getProofThread(f.make(), f.ctx(first.id))).status).toBe(404);
    expect((await getProofThread(f.make(guest), f.ctx(first.id, { ...f.route, assetId: 'asset_b' }))).status).toBe(404);
    expect((await getProofThread(f.make(f.ownerCookie), f.ctx(first.id, { ...f.route, assetId: 'asset_b' }))).status).toBe(404);
    const requestBody = { text: 'Same thread', authorName: 'Guest reviewer', idempotencyKey: key() };
    const reply = () => replyToProofThread(f.make(guest, requestBody), f.ctx(first.id));
    for (let n = 0; n < 2; n++) {
        const response = await reply();
        expect(response.status, await response.clone().text()).toBe(201);
        expect((await threadFrom(response)).thread.items).toHaveLength(2);
    }
    const grant = (await f.proofs.share(f.shareId))!;
    expect(await f.app.replace({ ...grant.doc, revokedAt: now }, grant.etag)).toBe('ok');
    expect((await reply()).status).toBe(404);
});

test('the pending page and exact count bind the guest and version, and re-request invalidates a stale decision', async () => {
    const f = await fixture();
    const guest = await f.guestCookie();
    const visitor = await f.guestCookie();
    const first = await f.open(guest);
    const second = await f.open(guest);
    const a = await f.postVerification(f.ownerCookie, first, f.ask(first));
    expect(a.status, await a.clone().text()).toBe(200);
    const requested = await threadFrom(a);
    expect(requested.evidenceLinks?.after).toMatchObject({ number: 2, previewUrl: expect.stringContaining('/versions/v2/media/preview') });
    expect((await f.postVerification(f.ownerCookie, second, f.ask(second))).status).toBe(200);
    const page = async (cookie: string, versionId = 'v2', before?: string) => {
        const query = '?' + new URLSearchParams({ version: versionId, limit: '1', ...(before ? { before } : {}) });
        const response = await listProofVerification(f.make(cookie, undefined, 'GET', query), { params: Promise.resolve(f.route) });
        expect(response.status).toBe(200);
        return await response.json() as ProofPendingPage;
    };
    const initial = await page(guest);
    expect(initial).toMatchObject({ count: 2, threads: [expect.any(Object)], next: expect.any(String) });
    const next = await page(guest, 'v2', initial.next!);
    expect(next.count).toBe(2);
    expect(next.next).toBeNull();
    expect(new Set([...initial.threads, ...next.threads].map(thread => thread.id))).toEqual(new Set([first.id, second.id]));
    expect(await page(visitor)).toMatchObject({ count: 0, threads: [] });
    expect((await page(guest, 'v1')).count).toBe(0);

    const decision = { action: 'confirm', expectedRevision: requested.verification!.revision, targetVersionId: 'v2', idempotencyKey: key() };
    expect((await f.postVerification(visitor, requested, decision)).status).toBe(403);
    expect((await f.postVerification(guest, requested, { ...decision, targetVersionId: 'v3' })).status).toBe(409);
    const move = await changeProofThread(f.make(f.ownerCookie, { operation: 'relocate', location: location('v2', 0.9), expectedRevision: requested.revision }, 'PATCH'), f.ctx(first.id));
    expect(move.status, await move.clone().text()).toBe(200);
    const moved = await threadFrom(move);
    expect(moved.target.source).toEqual(first.target.source);
    expect(moved.target.relocations).toEqual([location('v2', 0.9)]);
    expect(moved.verification!.evidence!.after).toEqual(location('v2', 0.7));
    expect(moved.location).toEqual(location('v2', 0.7));

    const asset = (await f.proofs.asset('asset_a'))!;
    await f.app.replace({ ...asset.doc, currentVersionId: 'v3' }, asset.etag);
    expect((await page(guest, 'v3')).count).toBe(0);
    const assetQueue = await listProofVerification(f.make(guest, undefined, 'GET', '?version=v3&scope=asset'), { params: Promise.resolve(f.route) });
    expect((await assetQueue.json() as ProofPendingPage).count).toBe(2);
    for (let n = 0; n < 2; n++) {
        const applied = await f.postVerification(guest, requested, decision);
        expect(applied.status, await applied.clone().text()).toBe(200);
        expect(await threadFrom(applied)).toMatchObject({ resolved: true, currentVersionId: 'v3', verification: { outcome: 'confirmed', evidence: { after: location('v2', 0.7) } } });
    }
    expect((await page(guest)).count).toBe(1);
    const confirmed = await threadFrom(await getProofThread(f.make(guest), f.ctx(first.id)));
    const replaced = await f.postVerification(f.ownerCookie, confirmed, f.ask(confirmed, { evidence: { assetId: 'asset_a', before: first.target.source, after: location('v3') } }));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect((await f.postVerification(guest, requested, decision)).status).toBe(409);
    expect((await page(guest, 'v3')).count).toBe(1);
});

test('private threads, disabled verification, and cross-asset evidence do not leak into queue or direct reads', async () => {
    const f = await fixture();
    const reviewer = f.memberCookie(f.reviewer);
    const memberThread = await f.open(reviewer);
    const privateThread = await f.open(f.ownerCookie, { private: true });
    expect((await f.postVerification(f.ownerCookie, privateThread, f.ask(privateThread, { reviewerId: f.reviewer.userId }))).status).toBe(403);
    expect((await getProofThread(f.make(reviewer), f.ctx(privateThread.id))).status).toBe(404);
    expect((await f.postVerification(f.ownerCookie, memberThread, f.ask(memberThread, {
        evidence: { assetId: 'asset_a', before: memberThread.target.source, after: location('v4') }
    }))).status).toBe(404);
    const requested = await f.postVerification(f.ownerCookie, memberThread, f.ask(memberThread));
    expect(requested.status).toBe(200);
    const pending = () => listProofVerification(f.make(reviewer, undefined, 'GET', '?version=v2'), { params: Promise.resolve(f.route) });
    expect(((await (await pending()).json()) as ProofPendingPage).count).toBe(1);

    const hiddenByPrivacy = await f.open();
    expect((await f.postVerification(f.ownerCookie, hiddenByPrivacy, f.ask(hiddenByPrivacy, { reviewerId: f.reviewer.userId }))).status).toBe(200);
    expect(((await (await pending()).json()) as ProofPendingPage).count).toBe(2);
    expect((await changeProofThread(f.make(f.ownerCookie, { operation: 'private', private: true }, 'PATCH'), f.ctx(hiddenByPrivacy.id))).status).toBe(200);
    expect(((await (await pending()).json()) as ProofPendingPage).count).toBe(1);
    const { doc, etag } = (await f.app.get<DbProject>(f.project.pk, f.project.id))!;
    await f.app.replace({ ...doc, verificationEnabled: false }, etag);
    expect(await (await pending()).json()).toEqual({ count: 0, threads: [], next: null });
    const disabled = await listProofThreads(f.make(reviewer, undefined, 'GET', '?version=v1'), { params: Promise.resolve(f.route) });
    expect(((await disabled.json()) as ProofPendingPage).threads.map(thread => thread.id)).toEqual([memberThread.id]);
    const ordinaryDone = await changeProofThread(f.make(reviewer, { operation: 'status', statusId: 'done', idempotencyKey: key() }, 'PATCH'), f.ctx(memberThread.id));
    expect(ordinaryDone.status).toBe(200);
    expect(await threadFrom(ordinaryDone)).toMatchObject({ resolved: true, verification: { outcome: 'unconfirmed' } });
});

test('proof export links both immutable editions without copying the private grant or guest identity', async () => {
    const f = await fixture();
    const guest = await f.guestCookie();
    const thread = await f.open(guest);
    expect((await f.postVerification(f.ownerCookie, thread, f.ask(thread))).status).toBe(200);
    const appBase = process.env.UIER_BASE_URL;
    try {
        process.env.UIER_BASE_URL = origin;
        const response = await exportProofThread(f.make(guest), f.ctx(thread.id));
        expect(response.status).toBe(200);
        const packet = await response.text();
        expect(packet).toContain(`?version=v1&thread=${thread.id}`);
        expect(packet).toContain(`?version=v2&thread=${thread.id}`);
        expect(packet).not.toContain(f.shareId);
        expect(packet).not.toContain('tokenHash');
        expect(await exportProofThread(f.make(), f.ctx(thread.id))).toHaveProperty('status', 404);
    } finally {
        if (appBase === undefined) delete process.env.UIER_BASE_URL;
        else process.env.UIER_BASE_URL = appBase;
    }
});

test('Cosmos pending page and aggregate use identical indexed scope and privacy predicates', async () => {
    type Query = { query: string; parameters: { name: string; value: unknown }[] };
    const queries: Query[] = [];
    const container = { id: 'comments', items: { query(input: Query) {
        queries.push(input);
        let more = true;
        return { hasMoreResults: () => more, async fetchNext() {
            more = false;
            return { resources: input.query.startsWith('SELECT VALUE COUNT') ? [300] : [], requestCharge: 2 };
        } };
    } } } as unknown as Container;
    const store = createCosmosCommentsStore(() => container);
    const scope = { asset: 'asset_a', reviewerId: 'reader', versionId: 'v2', visibility: { authorId: 'reader' } };
    const [page, count] = await Promise.all([store.listPage('project:test', { proof: scope, limit: 1 }), store.countProofThreads('project:test', scope)]);
    expect(page).toEqual([]);
    expect(count).toBe(300);
    const [list, aggregate] = queries;
    expect(list!.query.split(' WHERE ')[1]!.split(' ORDER BY ')[0]).toBe(aggregate!.query.split(' WHERE ')[1]);
    expect(aggregate!.query).toContain('c.assetTarget.assetId = @asset');
    expect(aggregate!.query).toContain('c.verification.reviewer = @proofReviewer');
    expect(aggregate!.query).toContain('c.verification.evidence.after.versionId = @proofVersion');
    expect(aggregate!.query).toContain('c.authorId = @readerId');
    expect(aggregate!.query).toContain('NOT IS_STRING(c.archivedAt)');
});

test('a grant revoked between optimistic attempts cannot write or replay a receipt', async () => {
    const f = await fixture();
    const guest = await f.guestCookie();
    const thread = await f.open(guest);
    const requested = await threadFrom(await f.postVerification(f.ownerCookie, thread, f.ask(thread)));
    const input = { action: 'confirm', expectedRevision: requested.verification!.revision, targetVersionId: 'v2', idempotencyKey: key() };
    const proof = await authorizeProofThread(f.make(guest), f.route, 'v2', true);
    const store = getMemoryCommentsStore();
    let attempts = 0;
    const revokeDuringWrite = { ...store, commitSubmission: async () => {
        attempts++;
        const grant = (await f.proofs.share(f.shareId))!;
        await f.app.replace({ ...grant.doc, revokedAt: now }, grant.etag);
        return 'conflict' as const;
    } };
    await expect(changeFixVerification(proof.project, proof.actor, thread.id, input, revokeDuringWrite)).rejects.toMatchObject({ status: 404 });
    expect(attempts).toBe(1);
    expect((await store.get(projectPartition(f.project.id), thread.id))?.comment.verification?.outcome).toBe('pending');
});

test('prototype evidence is bounded, immutable and visible only with live proof access', async () => {
    const f = await fixture(() => ({ format: 'html', surfaces: [{ id: 'page' }], html: { entry: 'index.html', pages: { page: 'index.html' } } }));
    const guest = await f.guestCookie();
    const node = { path: [2, 0], tag: 'button' };
    const source = { versionId: 'v1', anchor: { kind: 'prototype', surfaceId: 'page',
        target: node, selection: { quote: 'Recipes', offset: 0, endOffset: 0, start: 0, end: 7 },
        capture: { nodes: [{ node, box: { x: 0.2, y: 0.4, width: 0.25, height: 0.1 }, label: 'Recipes', state: '1----' }], native: [] } } } satisfies ProofThreadLocation;
    const first = await f.open(guest, { location: source });
    expect(first.target.source).toEqual(source);
    const read = await getProofThread(f.make(guest, undefined, 'GET', '?version=v1'), f.ctx(first.id));
    expect((await threadFrom(read)).location).toEqual(source);
    for (const invalid of [
        { ...source.anchor, capture: { ...source.anchor.capture, script: '<script>bad</script>' } },
        { ...source.anchor, capture: { nodes: Array(25).fill(source.anchor.capture.nodes[0]), native: [] } },
        { ...source.anchor, target: { path: [3, 0], tag: 'button' } },
        { ...source.anchor, surfaceId: 'other' }
    ]) {
        const rejected = await createProofThread(f.make(guest, { text: 'Bad evidence', authorName: 'Guest reviewer', idempotencyKey: key(),
            location: { ...source, anchor: invalid } }), { params: Promise.resolve(f.route) });
        expect(rejected.status).toBe(400);
    }
    expect((await getProofThread(f.make(), f.ctx(first.id))).status).toBe(404);
    const grant = (await f.proofs.share(f.shareId))!;
    await f.app.replace({ ...grant.doc, revokedAt: new Date().toISOString() }, grant.etag);
    expect((await getProofThread(f.make(guest, undefined, 'GET', '?version=v1'), f.ctx(first.id))).status).toBe(404);
    expect((await threadFrom(await getProofThread(f.make(f.ownerCookie, undefined, 'GET', '?version=v1'), f.ctx(first.id)))).location).toEqual(source);
});

test('timed regions and copy replacements follow the original thread through a revised location', async () => {
    const f = await fixture(id => id === 'v4'
        ? { format: 'email', surfaces: [{ id: 'page' }], email: { subject: 'Sale starts today', plainTextArtifactId: 'email-text', links: [] } }
        : { format: 'video', surfaces: [{ id: 'page', width: 640, height: 360 }], durationMs: id === 'v1' ? 4000 : 3000 });
    const original = { versionId: 'v1', anchor: { kind: 'time', surfaceId: 'page',
        startMs: 2750, endMs: 3500, geometry: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 } } } satisfies ProofThreadLocation;
    const thread = await f.open(f.ownerCookie, { location: original });
    const relocate = (location: ProofThreadLocation) => changeProofThread(f.make(f.ownerCookie,
        { operation: 'relocate', expectedRevision: thread.revision, location }, 'PATCH'), f.ctx(thread.id));
    expect((await relocate({ ...original, versionId: 'v2' })).status).toBe(400);
    const revised = { versionId: 'v2', anchor: { ...original.anchor, startMs: 1750, endMs: 2500 } } satisfies ProofThreadLocation;
    const response = await relocate(revised);
    expect(response.ok, await response.clone().text()).toBe(true);
    const moved = await threadFrom(response);
    expect(moved.target.source).toEqual(original);
    expect(moved.location).toEqual(revised);
    const evidence = { assetId: 'asset_a', before: original, after: revised };
    const verified = await f.postVerification(f.ownerCookie, moved, f.ask(moved, { reviewerId: f.reviewer.userId, evidence }));
    expect(verified.ok, await verified.clone().text()).toBe(true);
    expect((await threadFrom(verified)).verification?.evidence).toEqual(evidence);

    const route = { ...f.route, assetId: 'asset_b' };
    const suggestion = { replacement: 'Shop the winter offers' };
    const copySource = { versionId: 'v4', anchor: { kind: 'text', surfaceId: 'page', field: 'subject', quote: 'Sale starts today' } } satisfies ProofThreadLocation;
    const create = (location: ProofThreadLocation, idempotencyKey = key()) => createProofThread(f.make(f.ownerCookie,
        { idempotencyKey, text: suggestion.replacement, location, suggestion }), { params: Promise.resolve(route) });
    expect((await create({ versionId: 'v4', anchor: { kind: 'general' } })).status).toBe(400);
    expect((await create({ ...copySource, anchor: { ...copySource.anchor, quote: 'Wrong subject' } })).status).toBe(400);
    const idempotencyKey = key();
    const posted = await create(copySource, idempotencyKey);
    expect(posted.status, await posted.clone().text()).toBe(201);
    const copyThread = await threadFrom(posted);
    expect(copyThread.target).toMatchObject({ source: copySource, suggestion });
    const retry = await create(copySource, idempotencyKey);
    expect((await threadFrom(retry)).id).toBe(copyThread.id);
});
