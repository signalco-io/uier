import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { ensureProjectPublicId } from '../src/lib/app/projectPublicIds';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { getAppStore } from '../src/lib/app/store';
import { memberId, projectRefPk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { proofApi } from '../src/lib/proofs/routes';
import { proofStore } from '../src/lib/proofs/store';
import { assetApprovalRoute, projectApprovalRoute } from '../src/lib/proofs/approvals/routes';
import { runApprovalMail } from '../src/lib/proofs/approvals/mail';
import { approvalDay } from '../src/lib/proofs/approvals/storage';
import type { ApprovalReview } from '../src/lib/proofs/approvals/model';
import { cleanupTransferredProofs, deleteProjectProofs, retireProofProject, rotateProofProject } from '../src/lib/proofs/cleanup';
import type { ProofAsset, ProofCollection, ProofShare, ProofUploadGrant, ProofVersion } from '../src/lib/proofs/model';
import { changeProofThread, createProofThread } from '../src/lib/proofs/threadRoutes';
import { persistProjectAccess } from './support/projectAccess';

const origin = 'https://approvals.example';
type ApprovalTransport = typeof import('../src/lib/notifications/transport').deliverNotificationEmail;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

function cookies(response: Response) {
    return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}

async function read<T>(response: Response, status = 200) {
    expect(response.status, await response.clone().text()).toBe(status);
    return await response.json() as T;
}

async function approvalFixture() {
    const owner = { userId: `u_${randomUUID()}`, name: 'Avery', isAdmin: true };
    const second = { userId: `u_${randomUUID()}`, name: 'Blake', isAdmin: false };
    const optional = { userId: `u_${randomUUID()}`, name: 'Casey', isAdmin: false };
    const seed = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(seed, [owner, second, optional]);
    const store = getAppStore();
    await store.create<DbProjectRef>({ id: seed.id, type: 'project-ref', pk: projectRefPk(seed.id), workspaceId: seed.workspaceId });
    const project = await ensureProjectPublicId(seed);
    const proofs = proofStore(project.id);
    const projectId = project.publicId;
    const session = (userId: string) => `${cookieName(cookieNames.session)}=${sessionToken(userId).token}`;
    const ownerCookie = session(owner.userId);
    const secondCookie = session(second.userId);
    const optionalCookie = session(optional.userId);
    const request = (pathname: string, method = 'GET', cookie = ownerCookie, body?: unknown, bytes?: Buffer, headers?: HeadersInit) =>
        new Request(new URL(pathname, origin), { method, headers: {
            host: new URL(origin).host, origin, cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...Object.fromEntries(new Headers(headers))
        }, body: body === undefined ? bytes && Uint8Array.from(bytes) : JSON.stringify(body) });
    function api(path: string, method = 'GET', body?: unknown, cookie?: string, bytes?: Buffer, headers?: HeadersInit) {
        const full = path.startsWith('/api/') ? path : `/api/proofs/${projectId}${path}`;
        const proofPath = new URL(full, origin).pathname.split('/').slice(4);
        return proofApi(request(full, method, cookie, body, bytes, headers), { params: Promise.resolve({ projectId, proofPath }) }, async () => origin);
    }

    const { collection } = await read<{ collection: ProofCollection }>(await api('/collections', 'POST', { name: 'Launch' }), 201);
    const { asset } = await read<{ asset: ProofAsset }>(await api('/assets', 'POST', { collectionId: collection.id, name: 'Cover' }), 201);
    const route = { projectId, assetId: asset.id };
    const params = { params: Promise.resolve(route) };
    const assetPath = `/assets/${asset.id}`;
    const approvals = (query = '', method = 'GET', body?: unknown, cookie?: string) =>
        assetApprovalRoute(request(`/approvals${query}`, method, cookie, body), params);
    const dashboard = (query = '', method = 'GET', body?: unknown, cookie?: string) =>
        projectApprovalRoute(request(`/approvals${query}`, method, cookie, body), { params: Promise.resolve({ projectId }) });
    async function publish(expectedVersionId: string | null, background: string) {
        const bytes = await sharp({ create: { width: 5, height: 3, channels: 3, background } }).png().toBuffer();
        const { version, uploadUrl, headers } = await read<ProofUploadGrant>(await api(`${assetPath}/uploads`, 'POST',
            { requestId: randomUUID(), expectedVersionId, filename: 'Cover.png', contentType: 'image/png', size: bytes.length }));
        const put = uploadUrl!.startsWith('/api/') ? await api(uploadUrl!, 'PUT', undefined, '', bytes, headers)
            : await fetch(uploadUrl!, { method: 'PUT', body: Uint8Array.from(bytes), headers });
        expect(put.ok).toBe(true);
        return (await read<{ version: ProofVersion }>(await api(`${assetPath}/uploads/${version.id}/finalize`, 'POST'))).version;
    }
    const v1 = await publish(null, 'red');
    async function share(expiresAt?: string, scope: ProofShare['scope'] = { kind: 'asset', id: asset.id }) {
        const result = await read<{ share: ProofShare; url: string }>(await api('/shares', 'POST', { scope, permission: 'comment', expiresAt }), 201);
        const token = new URLSearchParams(new URL(result.url).hash.slice(1)).get('share')!;
        const response = await api('/exchange', 'POST', { token }, '');
        expect(response.ok).toBe(true);
        return { ...result, cookie: cookies(response) };
    }
    async function thread(text: string, privacy = false) {
        const response = await createProofThread(request('/threads', 'POST', ownerCookie,
            { text, private: privacy, location: { versionId: v1.id, anchor: { kind: 'general' } }, idempotencyKey: randomUUID() }), params);
        return (await read<{ thread: { id: string } }>(response, 201)).thread.id;
    }
    return { approvals, api, dashboard, request, v1, owner, second, optional, secondCookie, optionalCookie, ownerCookie,
        publish, share, collection, route, project, proofs, store, asset, thread };
}

const member = (userId: string, required = true) => ({ kind: 'member', userId, required });
const approve = (versionId: string, revision = 1, decisionRevision = 0) =>
    ({ versionId, requestId: randomUUID(), revision, decisionRevision, decision: 'approved' });
const readReview = (response: Response) => read<ApprovalReview>(response);

test('two named reviewers decide independently and a new publish requires fresh decisions', async () => {
    const f = await approvalFixture();
    const start = { versionId: f.v1.id, requestId: randomUUID(), deadline: null,
        reviewers: [member(f.owner.userId), member(f.second.userId), member(f.optional.userId, false)] };
    const membership = (await f.store.get<DbMember>(f.project.pk, memberId(f.optional.userId)))!;
    await f.store.replace({ ...membership.doc, projects: [] }, membership.etag);
    expect((await f.approvals('', 'POST', start)).status).toBe(400);
    expect((await f.approvals('', 'GET', undefined, f.optionalCookie)).status).toBe(404);
    await f.store.replace({ ...membership.doc, projects: [f.project.id] },
        (await f.store.get<DbMember>(membership.doc.pk, membership.doc.id))!.etag);
    const first = await readReview(await f.approvals('', 'POST', start));
    expect(first.round?.outcome).toBe('pending');
    expect(await readReview(await f.approvals('', 'POST', start))).toEqual(first);
    expect((await f.approvals('', 'POST', { ...start, deadline: new Date(Date.now() + approvalDay).toISOString() })).status).toBe(409);

    const threadId = await f.thread('Resolved feedback still requires a version decision.');
    const done = await changeProofThread(f.request(`/threads?version=${f.v1.id}`, 'PATCH', f.ownerCookie,
        { operation: 'status', statusId: 'done', idempotencyKey: randomUUID() }), { params: Promise.resolve({ ...f.route, threadId }) });
    expect(done.ok, await done.text()).toBe(true);
    expect((await readReview(await f.approvals())).round?.outcome).toBe('pending');

    const decision = approve(f.v1.id);
    const [a, replay] = await Promise.all([f.approvals('?mode=decision', 'POST', decision), f.approvals('?mode=decision', 'POST', decision)]);
    expect([a.status, replay.status]).toEqual([200, 200]);
    expect((await readReview(await f.approvals())).round).toMatchObject({
        outcome: 'pending', outstanding: [{ name: 'Blake', required: true }, { name: 'Casey', required: false }], history: [{ reviewerName: 'Avery' }]
    });
    expect((await f.approvals('?mode=decision', 'POST', approve(f.v1.id))).status).toBe(409);
    const change = { ...approve(f.v1.id), decision: 'changes-requested' };
    expect((await f.approvals('?mode=decision', 'POST', change, f.secondCookie)).status).toBe(400);
    const requested = await readReview(await f.approvals('?mode=decision', 'POST', { ...change, explanation: 'Update the cover.' }, f.secondCookie));
    expect(requested.round?.outcome).toBe('changes-requested');
    await readReview(await f.approvals('?mode=decision', 'POST', { ...change, requestId: randomUUID(), explanation: 'Optional idea.' }, f.optionalCookie));
    const second = approve(f.v1.id, 1, 1);
    const approved = await readReview(await f.approvals('?mode=decision', 'POST', second, f.secondCookie));
    expect(approved.round?.outcome).toBe('approved');
    expect(approved.round?.history).toHaveLength(4);

    const v2 = await f.publish(f.v1.id, 'blue');
    const latest = await readReview(await f.approvals());
    expect(latest.round).toMatchObject({ versionId: v2.id, outcome: 'pending', history: [] });
    expect(latest.round?.outstanding.map(item => item.name)).toEqual(['Avery', 'Blake', 'Casey']);
    expect((await f.approvals('?mode=decision', 'POST', approve(f.v1.id, 1, 2), f.secondCookie)).status).toBe(409);
    expect((await readReview(await f.approvals('?mode=decision', 'POST', second, f.secondCookie))).round).toMatchObject({
        state: 'closed', outcome: 'approved', versionId: f.v1.id
    });
    const dashboard = await read<{ summaries: object }>(await f.dashboard(`?collection=${f.collection.id}`));
    expect(dashboard.summaries).toMatchObject({ [f.asset.id]: { versionId: v2.id, outcome: 'pending' } });
});

test('named mailbox link verifies one reviewer, and guest and member records enforce export privacy', async () => {
    const f = await approvalFixture();
    const grant = await f.share();
    const another = await f.share();
    const outsider = { kind: 'external', name: 'Devon', email: 'assigned-reviewer@example.test', shareId: grant.share.id, required: true };
    await readReview(await f.approvals('', 'POST', { versionId: f.v1.id, requestId: randomUUID(), reviewers: [outsider], deadline: null }));
    const approveInput = approve(f.v1.id);
    expect((await f.approvals('?mode=decision', 'POST', approveInput, grant.cookie)).status).toBe(403);
    expect((await f.approvals('?mode=decision', 'POST', approveInput)).status).toBe(403);
    expect((await f.approvals('?mode=options', 'GET', undefined, grant.cookie)).status).toBe(403);
    const captured: string[] = [];
    await runApprovalMail(origin, { projectId: f.project.id, transport: async message => {
        expect(message.to).toBe(outsider.email);
        captured.push(message.text);
        return { status: 'sent' };
    } });
    const mailLink = (text: string) => new URL(text.match(/https:\/\/[^\s]+#approval=[\w.-]+/)![0]);
    const link = mailLink(captured[0]!);
    expect(link.searchParams.get('version')).toBe(f.v1.id);
    const token = new URLSearchParams(link.hash.slice(1)).get('approval');
    const response = await f.dashboard('', 'POST', { token }, '');
    expect(response.status).toBe(200);
    const verified = cookies(response);
    expect((await f.dashboard('', 'POST', { token }, '')).status).toBe(404);
    expect((await readReview(await f.approvals('', 'GET', undefined, verified))).reviewerId).toBeDefined();
    const switched = another.cookie + '; ' + verified.split('; ').find(cookie => cookie.startsWith('uier-approval-'));
    expect((await f.approvals('?mode=decision', 'POST', approveInput, switched)).status).toBe(403);
    const signed = await readReview(await f.approvals('?mode=decision', 'POST', approveInput, verified));
    expect(signed.round?.outcome).toBe('approved');
    for (const email of ['unknown@example.test', outsider.email, outsider.email]) {
        expect((await f.approvals('?mode=recover', 'POST', { versionId: f.v1.id, email }, grant.cookie)).status).toBe(204);
    }
    const recoveryMail: string[] = [];
    await runApprovalMail(origin, { projectId: f.project.id, transport: async message => {
        expect(message.to).toBe(outsider.email);
        recoveryMail.push(message.text);
        return { status: 'sent' };
    } });
    expect(recoveryMail).toHaveLength(1);
    const recoveryToken = new URLSearchParams(mailLink(recoveryMail[0]!).hash.slice(1)).get('approval');
    const recovered = await f.dashboard('', 'POST', { token: recoveryToken }, '');
    expect(recovered.ok).toBe(true);
    const secondDevice = cookies(recovered);
    expect(secondDevice).not.toBe(verified);
    expect((await readReview(await f.approvals('?mode=decision', 'POST', approveInput, secondDevice))).reviewerId).toBe(signed.reviewerId);

    await f.thread('Review-visible feedback.');
    await f.thread('Private production notes.', true);
    for (const [cookie, hasPrivate, hasOriginal] of [[verified, false, false], [f.secondCookie, false, true], [f.ownerCookie, true, true]] as const) {
        const response = await f.approvals(`?mode=export&version=${f.v1.id}`, 'GET', undefined, cookie);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="review-version-1.json"');
        const record = await response.text();
        expect(record).toContain('Review-visible feedback.');
        expect(record).toContain(f.v1.digest);
        expect(record).toContain('Devon');
        expect(record).not.toContain(outsider.email);
        expect(record).not.toContain(outsider.shareId);
        expect(record.includes('Private production notes.')).toBe(hasPrivate);
        expect(record.includes('originalUrl')).toBe(hasOriginal);
    }

    const live = (await f.proofs.share(grant.share.id))!;
    await f.store.replace({ ...live.doc, expiresAt: new Date(Date.now() - 1000).toISOString() }, live.etag);
    expect((await f.approvals('?mode=decision', 'POST', approveInput, verified)).status).toBe(404);
    expect((await f.approvals('?mode=export', 'GET', undefined, verified)).status).toBe(404);
    const expired = (await f.proofs.share(grant.share.id))!;
    await f.store.replace(live.doc, expired.etag);
    expect((await f.api(`/shares/${grant.share.id}`, 'DELETE')).status).toBe(204);
    expect((await f.approvals('?mode=decision', 'POST', approveInput, verified)).status).toBe(404);
    expect((await f.approvals('?mode=export', 'GET', undefined, verified)).status).toBe(404);

    const expiring = (await f.proofs.share(another.share.id))!;
    await f.store.replace({ ...expiring.doc, expiresAt: new Date(Date.now() - 1000).toISOString() }, expiring.etag);
    expect((await f.approvals('?mode=export', 'GET', undefined, another.cookie)).status).toBe(404);
    expect((await f.approvals('', 'PATCH', { versionId: f.v1.id, revision: 1, requestId: randomUUID(), state: 'open', deadline: null,
        reviewers: [{ ...outsider, shareId: another.share.id }] })).status).toBe(400);
});

test('deadlines, suspended and closed rounds, and worker reminders are idempotent across retries and retirement', async () => {
    const f = await approvalFixture();
    const now = Date.now();
    const versionId = f.v1.id;
    const deadline = new Date(now + 2 * approvalDay).toISOString();
    const input = { versionId, reviewers: [member(f.owner.userId), member(f.second.userId)], deadline, requestId: randomUUID() };
    await readReview(await f.approvals('', 'POST', input));
    const sent: string[] = [];
    let approachingOperation: string | undefined;
    const transport: ApprovalTransport = async (message, attempt, retry) => {
        if (message.subject === 'File approval deadline approaching') {
            if (!approachingOperation) {
                expect(retry).toBe(false);
                approachingOperation = attempt.operationId;
                return { status: 'pending' };
            }
            expect(retry).toBe(true);
            expect(attempt.operationId).toBe(approachingOperation);
        }
        sent.push(message.subject);
        return { status: 'sent' };
    };
    const run = (at: number) => runApprovalMail(origin, { projectId: f.project.id, transport, now: at });
    await Promise.all([run(now + 100), run(now + 100)]);
    expect(sent).toEqual(['File approval requested', 'File approval requested']);
    await readReview(await f.approvals('?mode=decision', 'POST', approve(versionId)));
    const paused = { versionId, deadline, revision: 1, state: 'paused', requestId: randomUUID() };
    expect((await readReview(await f.approvals('', 'PATCH', paused))).round?.state).toBe('paused');
    expect((await f.approvals('?mode=decision', 'POST', approve(versionId, 2), f.secondCookie)).status).toBe(409);
    await run(now + approvalDay + 100);
    expect(sent).toHaveLength(2);
    await readReview(await f.approvals('', 'PATCH', { ...paused, state: 'open', revision: 2, requestId: randomUUID() }));
    await run(now + approvalDay + 16 * 60_000);
    await run(now + approvalDay + 16 * 60_000);
    expect(approachingOperation).toBeDefined();
    expect(sent).toHaveLength(2);
    await run(now + approvalDay + 17 * 60_000);
    await run(now + approvalDay + 18 * 60_000);
    expect(sent.filter(item => item === 'File approval deadline approaching')).toHaveLength(1);
    await Promise.all([run(now + 2 * approvalDay + 100), run(now + 2 * approvalDay + 100)]);
    expect(sent.filter(item => item === 'File approval due')).toHaveLength(1);
    await readReview(await f.approvals('', 'PATCH', { ...paused, state: 'closed', revision: 3, requestId: randomUUID() }));
    expect((await f.approvals('?mode=decision', 'POST', approve(versionId, 4), f.secondCookie)).status).toBe(409);
    await rotateProofProject(f.project.id, new Date().toISOString(), f.store);
    await cleanupTransferredProofs(f.project.id, f.store);
    expect((await readReview(await f.approvals())).round?.history).toHaveLength(1);
    expect(await f.store.query({ type: 'proof-approval-mail', pk: f.proofs.pk })).toHaveLength(0);
    await retireProofProject(f.project.id, f.store);
    expect((await f.approvals()).status).toBe(404);
    await deleteProjectProofs(f.project.id, f.store, now + approvalDay);
    expect(await f.store.query({ type: 'proof-approval-event', pk: f.proofs.pk })).toHaveLength(0);
    expect(await f.store.query({ type: 'proof-approval-round', pk: f.proofs.pk })).toHaveLength(0);
});
