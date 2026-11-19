import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { DELETE, POST } from '../app/api/workspaces/[workspaceId]/logo/route';
import { GET } from '../app/api/workspaces/[workspaceId]/logo/[version]/route';
import { KnownPageLinks } from '../src/knownPages';
import { MAX_AVATAR_UPLOAD_BYTES } from '../src/lib/app/avatarLimits';
import { removeMember } from '../src/lib/app/invitations';
import { memberId, workspacePk, type DbMember, type DbWorkspaceLogo } from '../src/lib/app/model';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { getAppStore, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { changeWorkspaceLogo, normalizeWorkspaceLogo } from '../src/lib/app/workspaceLogos';
import { ensureOwnWorkspace, getWorkspace, renameWorkspace } from '../src/lib/app/workspaces';
import { ensurePublicProject } from '../src/lib/comments/publicProject';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { cookieName, cookieNames } from '../src/lib/cookieNames';

const origin = `http://localhost:${process.env.PORT || 4004}`;
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

async function fixture() {
    const user = await findOrCreateUser(`workspace-logo-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    return { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
}

const png = (width = 400, height = 200) =>
    sharp({ create: { width, height, channels: 4, background: 'rgba(30, 110, 190, 0.5)' } }).png().toBuffer();

function request(path: string, userId?: string, { headers, ...init }: RequestInit = {}) {
    const merged = new Headers({ host: new URL(origin).host, origin, 'sec-fetch-site': 'same-origin' });
    if (userId) merged.set('cookie', `${cookieName(cookieNames.session)}=${sessionToken(userId).token}`);
    new Headers(headers).forEach((value, key) => merged.set(key, value));
    return new Request(`${origin}${path}`, { ...init, headers: merged });
}

async function upload(workspaceId: string, userId?: string, bytes?: Buffer, headers?: HeadersInit) {
    const body = new FormData();
    body.set('file', new Blob([new Uint8Array(bytes ?? await png())], { type: 'image/png' }), 'logo.png');
    return POST(request(KnownPageLinks.workspaceLogoUpload(workspaceId), userId, { method: 'POST', body, headers }), { params: Promise.resolve({ workspaceId }) });
}

function remove(workspaceId: string, userId?: string, headers?: HeadersInit) {
    return DELETE(request(KnownPageLinks.workspaceLogoUpload(workspaceId), userId, { method: 'DELETE', headers }), { params: Promise.resolve({ workspaceId }) });
}

function read(workspaceId: string, version: string, userId?: string, size = 32, headers?: HeadersInit) {
    return GET(request(`${KnownPageLinks.workspaceLogo(workspaceId, version)}?size=${size}`, userId, { headers }), { params: Promise.resolve({ workspaceId, version }) });
}

const logos = (workspaceId: string) => getAppStore().query<DbWorkspaceLogo>({ type: 'workspace-logo', pk: workspacePk(workspaceId) });

test('workspace logo variants fit both densities and versions are replaced and removed atomically', async () => {
    const { user, workspace } = await fixture();
    expect((await upload(workspace.id, user.id)).status).toBe(204);
    const first = (await getWorkspace(workspace.id))!.logoVersion!;
    for (const size of [32, 64]) {
        const response = await read(workspace.id, first, user.id, size);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toBe('private, no-cache');
        expect(response.headers.get('vary')).toBe('Cookie');
        expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        const info = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        expect(info).toMatchObject({ format: 'webp', width: size, height: size / 2, hasAlpha: true });
    }
    expect((await read(workspace.id, first, user.id, 512)).status).toBe(400);
    expect((await upload(workspace.id, user.id, await png(16, 8))).status).toBe(204);
    const second = (await getWorkspace(workspace.id))!.logoVersion!;
    expect(second).not.toBe(first);
    expect((await read(workspace.id, first, user.id, 32, { 'if-none-match': '*' })).status).toBe(404);
    const small = await read(workspace.id, second, user.id, 64);
    expect(await sharp(Buffer.from(await small.arrayBuffer())).metadata()).toMatchObject({ width: 16, height: 8 });
    expect(await logos(workspace.id)).toHaveLength(1);
    expect((await remove(workspace.id, user.id)).status).toBe(204);
    expect((await remove(workspace.id, user.id)).status).toBe(204);
    expect((await read(workspace.id, second, user.id)).status).toBe(404);
    expect((await getWorkspace(workspace.id))?.logoVersion).toBeUndefined();
    expect(await logos(workspace.id)).toHaveLength(0);
});

test('workspace logo writes require a same-origin admin, and a cached read still requires current membership', async () => {
    const admin = await fixture();
    const commenter = await fixture();
    const workspaceId = admin.workspace.id;
    expect((await upload(workspaceId)).status).toBe(401);
    expect((await upload(workspaceId, commenter.user.id)).status).toBe(404);
    expect((await upload(workspaceId, admin.user.id, undefined, { origin: 'https://elsewhere.test' })).status).toBe(403);
    expect((await remove(workspaceId, admin.user.id, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await upload(workspaceId, admin.user.id)).status).toBe(204);
    const version = (await getWorkspace(workspaceId))!.logoVersion!;
    expect((await read(workspaceId, version)).status).toBe(401);
    expect((await read(workspaceId, version, commenter.user.id)).status).toBe(404);

    const store = getAppStore();
    expect(await store.create<DbMember>({
        ...admin.member, id: memberId(commenter.user.id), userId: commenter.user.id, email: commenter.user.email, role: 'commenter', projects: []
    })).toBe(true);
    const response = await read(workspaceId, version, commenter.user.id);
    expect(response.status).toBe(200);
    const headers = { 'if-none-match': response.headers.get('etag')! };
    expect((await read(workspaceId, version, commenter.user.id, 32, headers)).status).toBe(304);
    expect((await read(workspaceId, version, commenter.user.id, 64, headers)).status).toBe(200);
    expect((await upload(workspaceId, commenter.user.id)).status).toBe(403);
    expect((await remove(workspaceId, commenter.user.id)).status).toBe(403);
    await removeMember(admin, commenter.user.id);
    const denied = await read(workspaceId, version, commenter.user.id, 32, headers);
    expect(denied.status).toBe(404);
    expect(denied.headers.get('cache-control')).toBe('private, no-store');

    await ensurePublicProject();
    const publicMember = (await store.get<DbMember>(workspacePk(PUBLIC_WORKSPACE_ID), memberId(admin.user.id)))!;
    expect(await store.replace({ ...publicMember.doc, role: 'admin' }, publicMember.etag)).toBe('ok');
    expect((await upload(PUBLIC_WORKSPACE_ID, admin.user.id)).status).toBe(403);
    expect((await remove(PUBLIC_WORKSPACE_ID, admin.user.id)).status).toBe(403);
});

test('invalid logo uploads preserve the existing logo', async () => {
    const { user, workspace } = await fixture();
    expect((await upload(workspace.id, user.id)).status).toBe(204);
    const logoVersion = (await getWorkspace(workspace.id))!.logoVersion;
    for (const [bytes, status] of [
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415],
        [Buffer.alloc(0), 400],
        [(await png()).subarray(0, 16), 400],
        [Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1), 413],
        [await png(4097, 16), 400],
        [await png(16, 4097), 400]
    ] as const)
        expect((await upload(workspace.id, user.id, bytes)).status).toBe(status);
    expect((await getWorkspace(workspace.id))!.logoVersion).toBe(logoVersion);
    expect(await logos(workspace.id)).toHaveLength(1);
});

test('a logo write retries after a rename and stops after a concurrent revocation', async () => {
    const admin = await fixture();
    const other = await fixture();
    const { id, pk } = admin.workspace;
    const store = getAppStore();
    expect(await store.create<DbMember>({
        ...admin.member, id: memberId(other.user.id), userId: other.user.id, email: other.user.email
    })).toBe(true);
    const variants = await normalizeWorkspaceLogo(await png());
    const beforeBatch = (change: () => Promise<unknown>): AppStore => {
        let first = true;
        return { ...store, transact: async operations => {
            if (first) {
                first = false;
                await change();
            }
            return store.transact(operations);
        } };
    };
    await changeWorkspaceLogo(id, admin.user.id, variants, beforeBatch(() => renameWorkspace(id, admin.user.id, 'Renamed')));
    const saved = (await getWorkspace(id))!;
    expect(saved).toMatchObject({ name: 'Renamed', logoVersion: expect.any(String) });
    await expect(changeWorkspaceLogo(id, other.user.id, null, beforeBatch(() => removeMember(admin, other.user.id))))
        .rejects.toMatchObject({ status: 404 });
    expect(await getWorkspace(id)).toMatchObject({ logoVersion: saved.logoVersion, accessRevision: 1 });
    expect(await store.get(pk, memberId(other.user.id))).toBeNull();
    expect(await logos(id)).toHaveLength(1);
});
