import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { POST, DELETE } from '../app/api/workspaces/[workspaceId]/clients/[clientId]/logo/route';
import { GET } from '../app/api/workspaces/[workspaceId]/clients/[clientId]/logo/[version]/route';
import { changeClientLogo } from '../src/lib/app/clientLogos';
import { MAX_AVATAR_UPLOAD_BYTES, normalizeAvatar, type AvatarImage } from '../src/lib/app/avatars';
import { getClient, updateClient, setProjectClient, clientSummary } from '../src/lib/app/clients';
import type { AppContext } from '../src/lib/app/context';
import { createProject } from '../src/lib/app/projects';
import { memberId, workspacePk, type DbClientLogo, type DbMember, type DbTeam } from '../src/lib/app/model';
import { getAppStore, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { KnownPageLinks } from '../src/knownPages';

const origin = `http://localhost:${process.env.PORT || 4004}`;
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});
async function fixture() {
    const user = await findOrCreateUser(`client-logo-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Site', urls: ['https://logo.example.test'], clientName: 'Client' });
    return { context, ids: { workspaceId: workspace.id, clientId: project.clientId! }, project };
}
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 110, b: 190 } } }).png().toBuffer();
function request(path: string, userId?: string, init: RequestInit = {}) {
    return new Request(`${origin}${path}`, { ...init, headers: {
        host: new URL(origin).host, origin, 'sec-fetch-site': 'same-origin',
        ...(userId ? { cookie: `${cookieName(cookieNames.session)}=${sessionToken(userId).token}` } : {}), ...init.headers
    } });
}
async function upload(ids: { workspaceId: string; clientId: string }, userId?: string, bytes?: Buffer, headers?: Record<string, string>) {
    const body = new FormData();
    body.set('file', new Blob([new Uint8Array(bytes ?? await png())], { type: 'text/plain' }), 'pretends.txt');
    return POST(request(KnownPageLinks.clientLogoUpload(ids.workspaceId, ids.clientId), userId, { method: 'POST', body, headers }), { params: Promise.resolve(ids) });
}
function read(url: string, userId?: string) {
    const parts = url.split('/');
    return GET(request(url, userId), { params: Promise.resolve({ workspaceId: parts[3]!, clientId: parts[5]!, version: parts[7]! }) });
}
const docs = (workspaceId: string) => getAppStore().query<DbClientLogo>({ type: 'client-logo', pk: workspacePk(workspaceId) });

test('client logos use normalized, versioned private images; replace and remove delete the previous bytes', async () => {
    const { context, ids } = await fixture();
    const saved = await upload(ids, context.user.id);
    expect(saved.status).toBe(200);
    const { url } = await saved.json() as { url: string };
    const response = await read(url, context.user.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(clientSummary((await getClient(ids.workspaceId, ids.clientId))!.doc).logoUrl).toBe(url);
    const next = await upload(ids, context.user.id);
    const second = (await next.json() as { url: string }).url;
    expect(second).not.toBe(url);
    expect((await read(url, context.user.id)).status).toBe(404);
    expect(await docs(ids.workspaceId)).toHaveLength(1);
    const remove = () => DELETE(request(KnownPageLinks.clientLogoUpload(ids.workspaceId, ids.clientId), context.user.id, { method: 'DELETE' }), { params: Promise.resolve(ids) });
    expect((await remove()).status).toBe(204);
    expect((await remove()).status).toBe(204);
    expect((await read(second, context.user.id)).status).toBe(404);
    expect(await docs(ids.workspaceId)).toHaveLength(0);
    expect((await getClient(ids.workspaceId, ids.clientId))!.doc.logo).toBeUndefined();
});

test('logo writes require an admin and same-origin session; reads follow direct and team project access', async () => {
    const { context, ids, project } = await fixture();
    expect((await upload(ids)).status).toBe(401);
    for (const headers of [{ origin: 'https://elsewhere.test' }, { origin: '' }, { 'sec-fetch-site': 'same-site' }] as Record<string, string>[])
        expect((await upload(ids, context.user.id, undefined, headers)).status).toBe(403);
    const stranger = await fixture();
    expect((await upload(ids, stranger.context.user.id)).status).toBe(404);
    const url = (await (await upload(ids, context.user.id)).json() as { url: string }).url;
    expect((await read(url)).status).toBe(401);
    expect((await read(url, stranger.context.user.id)).status).toBe(404);
    const user = await findOrCreateUser(`client-logo-viewer-${randomUUID()}@example.test`);
    const member: DbMember = { ...context.member, id: memberId(user.id), userId: user.id, email: user.email, role: 'commenter', projects: [project.id] };
    const store = getAppStore();
    await store.create(member);
    expect((await read(url, user.id)).status).toBe(200);
    expect((await upload(ids, user.id)).status).toBe(403);
    const stored = (await store.get<DbMember>(member.pk, member.id))!;
    await store.replace({ ...stored.doc, projects: [], teamIds: ['team_logo'] }, stored.etag);
    expect((await read(url, user.id)).status).toBe(404);
    expect((await upload(ids, user.id)).status).toBe(404);
    await store.create({ type: 'team', id: 'team_logo', pk: member.pk, workspaceId: ids.workspaceId, name: 'Logo team', nameKey: 'logo team', updatedBy: context.user.id, state: 'active',
        projectIds: [project.id], createdBy: context.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } satisfies DbTeam);
    expect((await read(url, user.id)).status).toBe(200);
    // No visible projects means no client, even for its admin.
    await setProjectClient(context, project.id, undefined);
    expect((await read(url, context.user.id)).status).toBe(404);
    expect((await upload(ids, context.user.id)).status).toBe(404);
});

test('client logo upload rejects disguised, malformed and oversized images with no stored changes', async () => {
    const { context, ids } = await fixture();
    for (const [bytes, status] of [
        [Buffer.from('<svg/>'), 415], [Buffer.alloc(0), 400],
        [Buffer.concat([(await png()).subarray(0, 16), Buffer.alloc(64, 7)]), 400],
        [Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1), 413],
        [await sharp({ create: { width: 6000, height: 4400, channels: 3, background: 'white' } }).png().toBuffer(), 400]
    ] as const) expect((await upload(ids, context.user.id, bytes)).status).toBe(status);
    expect(await docs(ids.workspaceId)).toHaveLength(0);
    expect((await getClient(ids.workspaceId, ids.clientId))!.doc.logo).toBeUndefined();
});

test('concurrent logo and detail writes preserve both; unused client deletion removes its image', async () => {
    const { context, ids, project } = await fixture();
    const image = await normalizeAvatar(await png()) as AvatarImage;
    const store = getAppStore();
    let conflicted = false;
    const racing: AppStore = { ...store, transact: async operations => {
        if (!conflicted) {
            conflicted = true;
            await updateClient(context, ids.clientId, { name: 'Renamed', icon: 'rocket', color: 'blue' });
        }
        return store.transact(operations);
    } };
    await changeClientLogo(ids.workspaceId, ids.clientId, context.user.id, image, racing);
    expect((await getClient(ids.workspaceId, ids.clientId))!.doc).toMatchObject({ name: 'Renamed', icon: 'rocket', color: 'blue', logo: { version: expect.any(String) } });
    await Promise.all([changeClientLogo(ids.workspaceId, ids.clientId, context.user.id, image), changeClientLogo(ids.workspaceId, ids.clientId, context.user.id, null)]);
    const current = (await getClient(ids.workspaceId, ids.clientId))!.doc;
    expect(await docs(ids.workspaceId)).toHaveLength(current.logo ? 1 : 0);
    await changeClientLogo(ids.workspaceId, ids.clientId, context.user.id, image);
    await setProjectClient(context, project.id, 'Kept');
    const kept = await createProject(context, { name: 'Kept site', urls: ['https://kept.example.test'], clientName: 'Kept' });
    await updateClient(context, kept.clientId!, { name: 'Renamed' });
    expect(await getClient(ids.workspaceId, ids.clientId)).toBeNull();
    expect(await docs(ids.workspaceId)).toHaveLength(0);
});


test('client logo writes enforce a per-person hourly limit before decoding', async () => {
    const { context, ids } = await fixture();
    for (let index = 0; index < 30; index++) {
        const response = await DELETE(request(KnownPageLinks.clientLogoUpload(ids.workspaceId, ids.clientId), context.user.id, { method: 'DELETE' }), { params: Promise.resolve(ids) });
        expect(response.status).toBe(204);
    }
    const response = await upload(ids, context.user.id);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(await docs(ids.workspaceId)).toHaveLength(0);
});
