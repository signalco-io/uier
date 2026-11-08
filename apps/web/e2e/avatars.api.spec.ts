import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { POST as uploadAvatar, DELETE as deleteAvatar } from '../app/api/account/avatar/route';
import { GET as readAvatar } from '../app/api/avatars/[userId]/[version]/route';
import {
    AVATAR_SIZE, avatarErrors, avatarUrl, fetchProviderPicture, getAvatarImage, importProviderAvatar, MAX_AVATAR_UPLOAD_BYTES,
    MAX_PROVIDER_PICTURE_BYTES, normalizeAvatar, removeUserAvatar, saveUserAvatar, type AvatarImage
} from '../src/lib/app/avatars';
import { googlePictureUrl } from '../src/lib/app/google/picture';
import { avatarDocId, userPk, type DbUserAvatar } from '../src/lib/app/model';
import { SESSION_TTL_SECONDS } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { getAppStore } from '../src/lib/app/store';
import { signToken } from '../src/lib/app/tokens';
import { findOrCreateUser, getUser, updateUserName } from '../src/lib/app/users';
import { uniqueEmail } from './support/app';
import { persistProjectAccess } from './support/projectAccess';
import { loadProjectComments } from '../src/lib/app/projectComments';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { AppContext } from '../src/lib/app/context';
import type { DbProject } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';

const origin = 'http://localhost:4004';
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

const image = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' | 'gif') =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } }).toFormat(format).toBuffer();

/** The session cookie by its local name (read once local runtime is on) */
const sessionCookieName = () => cookieName(cookieNames.session);

function sessionCookie(userId: string) {
    return `${sessionCookieName()}=${signToken('session', { uid: userId, iat: Math.floor(Date.now() / 1000) }, SESSION_TTL_SECONDS)}`;
}

/** A request from an app page: same origin, the session of `userId` (none when omitted) */
function appRequest(path: string, init: RequestInit & { userId?: string; headers?: Record<string, string> } = {}) {
    const { userId, headers = {}, ...rest } = init;
    return new Request(`${origin}${path}`, { ...rest, headers: {
        host: 'localhost:4004', origin, 'sec-fetch-site': 'same-origin', ...(userId ? { cookie: sessionCookie(userId) } : {}), ...headers
    } });
}

function upload(file: Blob | null, init: { userId?: string; headers?: Record<string, string> } = {}) {
    const body = new FormData();
    if (file !== null) body.set('file', file, 'picture');
    return uploadAvatar(appRequest('/api/account/avatar', { method: 'POST', body, ...init }));
}

function read(url: string, userId?: string) {
    const [, , , id, version] = url.split('/');
    return readAvatar(appRequest(url, { userId }), { params: Promise.resolve({ userId: decodeURIComponent(id!), version: decodeURIComponent(version!) }) });
}

async function avatarDocs(userId: string) {
    return (await getAppStore().query<DbUserAvatar>({ type: 'user-avatar', pk: userPk(userId) }));
}

test('pictures are re-encoded as square WebP images of at most 256 pixels, upright and without metadata', async () => {
    for (const format of ['png', 'jpeg', 'webp', 'gif'] as const) {
        const result = await normalizeAvatar(await image(600, 400, format)) as AvatarImage;
        expect(result.size, format).toBe(AVATAR_SIZE);
        const meta = await sharp(result.data).metadata();
        expect(meta).toMatchObject({ format: 'webp', width: AVATAR_SIZE, height: AVATAR_SIZE });
        expect(meta.exif).toBeUndefined();
    }
    // Small pictures stay their size, as the square of their shorter side
    expect(await normalizeAvatar(await image(48, 32, 'png'))).toMatchObject({ size: 32 });
    // A photo turned by its EXIF orientation is cropped upright, and the orientation is not kept
    const turned = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } })
        .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const upright = await normalizeAvatar(turned) as AvatarImage;
    expect(upright.size).toBe(200);
    expect((await sharp(upright.data).metadata()).orientation).toBeUndefined();
});

test('anything but a PNG, JPEG, WebP or GIF image within the limits is refused, whatever it claims to be', async () => {
    expect(await normalizeAvatar(Buffer.alloc(0))).toBe(avatarErrors.empty);
    expect(await normalizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe(avatarErrors.type);
    expect(await normalizeAvatar(Buffer.from('<!doctype html><title>picture.png</title>'))).toBe(avatarErrors.type);
    // The right first bytes, then nothing that decodes
    const png = await image(64, 64, 'png');
    expect(await normalizeAvatar(Buffer.concat([png.subarray(0, 16), Buffer.alloc(64, 7)]))).toBe(avatarErrors.unreadable);
    const tooLarge = Buffer.concat([png, Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES)]);
    expect(await normalizeAvatar(tooLarge)).toBe(avatarErrors.tooLarge(MAX_AVATAR_UPLOAD_BYTES));
    // Decoding stops at the pixel limit instead of expanding a huge image
    const huge = await sharp({ create: { width: 10_000, height: 6_000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(MAX_AVATAR_UPLOAD_BYTES);
    expect(await normalizeAvatar(huge)).toBe(avatarErrors.unreadable);
});

test('the upload route takes only same-origin requests with a session, and a multipart image', async () => {
    const user = await findOrCreateUser(uniqueEmail('avatar-auth'));
    const png = new Blob([new Uint8Array(await image(80, 80, 'png'))], { type: 'image/png' });
    const status = async (response: Response | Promise<Response>) => (await response).status;

    // Cross-site: a missing, foreign or malformed Origin, or the browser saying so
    expect(await status(upload(png, { userId: user.id, headers: { origin: '' } }))).toBe(403);
    expect(await status(upload(png, { userId: user.id, headers: { origin: 'https://attacker.example' } }))).toBe(403);
    expect(await status(upload(png, { userId: user.id, headers: { origin: 'not a url' } }))).toBe(403);
    expect(await status(upload(png, { userId: user.id, headers: { 'sec-fetch-site': 'same-site' } }))).toBe(403);
    expect(await status(deleteAvatar(appRequest('/api/account/avatar', { method: 'DELETE', userId: user.id, headers: { origin: 'https://attacker.example' } })))).toBe(403);
    // Signed out, or a forged session
    expect(await status(upload(png))).toBe(401);
    expect(await status(upload(png, { headers: { cookie: `${sessionCookieName()}=forged` } }))).toBe(401);
    expect(await status(deleteAvatar(appRequest('/api/account/avatar', { method: 'DELETE' })))).toBe(401);
    expect((await getUser(user.id))?.avatar).toBeUndefined();

    // Not a multipart form, no file, an announced body over the limit, a file over the limit, not an image
    const json = await uploadAvatar(appRequest('/api/account/avatar', { method: 'POST', userId: user.id,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: 'x' }) }));
    expect(json.status).toBe(415);
    const missing = await upload(null, { userId: user.id });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'invalid_request', message: avatarErrors.empty });
    const announced = await uploadAvatar(appRequest('/api/account/avatar', { method: 'POST', userId: user.id,
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_AVATAR_UPLOAD_BYTES * 2) }, body: '--x--' }));
    expect(announced.status).toBe(413);
    const large = await upload(new Blob([new Uint8Array(await image(80, 80, 'png')), new Uint8Array(MAX_AVATAR_UPLOAD_BYTES)]), { userId: user.id });
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ error: 'too_large', message: 'Use an image up to 4 MB.' });
    const svg = await upload(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/png' }), { userId: user.id });
    expect(svg.status).toBe(415);
    expect(await svg.json()).toMatchObject({ message: avatarErrors.type });
    expect((await getUser(user.id))?.avatar).toBeUndefined();
    expect(await avatarDocs(user.id)).toEqual([]);
});

test('uploading, replacing and removing keep one image; replaced and removed addresses stop working', async () => {
    const user = await findOrCreateUser(uniqueEmail('avatar-owner'));
    const viewer = await findOrCreateUser(uniqueEmail('avatar-viewer'));

    const first = await upload(new Blob([new Uint8Array(await image(500, 300, 'jpeg'))], { type: 'image/jpeg' }), { userId: user.id });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const { url } = await first.json() as { url: string };
    const saved = (await getUser(user.id))!;
    expect(saved.avatar).toMatchObject({ source: 'upload' });
    expect(url).toBe(avatarUrl(saved));
    expect(url).toMatch(new RegExp(`^/api/avatars/${user.id}/[A-Za-z0-9_-]{21}$`));

    // Any signed-in viewer the address was handed to can load it; the browser keeps it, shared caches never do
    for (const reader of [user.id, viewer.id]) {
        const response = await read(url, reader);
        expect(response.status).toBe(200);
        expect(Object.fromEntries(response.headers)).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' });
        expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    }
    expect((await read(url)).status).toBe(401);
    expect((await read(url, viewer.id)).headers.get('cache-control')).toContain('private');
    // Another version, another person's id or a malformed id
    expect((await read(`/api/avatars/${user.id}/${'A'.repeat(21)}`, viewer.id)).status).toBe(404);
    expect((await read(url.replace(user.id, viewer.id), viewer.id)).status).toBe(404);
    expect((await read(url.replace(user.id, 'not-a-user'), viewer.id)).status).toBe(404);

    const second = await upload(new Blob([new Uint8Array(await image(64, 64, 'webp'))]), { userId: user.id });
    const { url: replaced } = await second.json() as { url: string };
    expect(replaced).not.toBe(url);
    expect((await read(url, viewer.id)).status).toBe(404);
    expect((await read(replaced, viewer.id)).status).toBe(200);
    expect(await avatarDocs(user.id)).toHaveLength(1);

    const removed = await deleteAvatar(appRequest('/api/account/avatar', { method: 'DELETE', userId: user.id }));
    expect(removed.status).toBe(204);
    expect((await getUser(user.id))?.avatar).toBeUndefined();
    expect((await read(replaced, user.id)).status).toBe(404);
    expect(await avatarDocs(user.id)).toEqual([]);
    expect((await deleteAvatar(appRequest('/api/account/avatar', { method: 'DELETE', userId: user.id }))).status).toBe(204);
});

test('the user and the image change together, and other profile changes keep the picture', async () => {
    const user = await findOrCreateUser(uniqueEmail('avatar-batch'));
    const picture = await normalizeAvatar(await image(40, 40, 'png')) as AvatarImage;
    const stale = (await getAppStore().get(userPk(user.id), user.id))!;
    expect((await saveUserAvatar(user.id, picture, 'upload')).result).toBe('saved');
    // A write from before the picture loses instead of dropping the reference to it
    expect(await getAppStore().replace({ ...stale.doc, name: 'Stale' }, stale.etag)).toBe('conflict');
    await updateUserName(user.id, 'Renamed');
    const current = (await getUser(user.id))!;
    expect(current.name).toBe('Renamed');
    expect(await getAvatarImage(user.id, current.avatar!.version)).toMatchObject({ type: 'user-avatar', userId: user.id, contentType: 'image/webp', size: 40 });
    expect((await getAppStore().get(userPk(user.id), avatarDocId(current.avatar!.version)))?.doc).toMatchObject({ bytes: picture.data.length });
    expect(await saveUserAvatar('u_missing', picture, 'upload')).toEqual({ result: 'not_found' });
    expect(await removeUserAvatar(user.id)).toBe(true);
    expect(await removeUserAvatar(user.id)).toBe(false);
    expect((await getUser(user.id))?.name).toBe('Renamed');
});

test('a sign-in picture is imported only while the account has none, and never replaces one', async () => {
    const user = await findOrCreateUser(uniqueEmail('avatar-import'));
    const picture = await normalizeAvatar(await image(120, 120, 'png')) as AvatarImage;
    let loads = 0;
    const load = async () => { loads++; return picture; };

    await importProviderAvatar(user.id, 'google', load);
    const imported = (await getUser(user.id))!.avatar!;
    expect(imported.source).toBe('google');
    await importProviderAvatar(user.id, 'microsoft', load);
    expect((await getUser(user.id))!.avatar).toEqual(imported);
    expect(loads).toBe(1);

    await saveUserAvatar(user.id, picture, 'upload');
    const uploaded = (await getUser(user.id))!.avatar!;
    await importProviderAvatar(user.id, 'google', load);
    expect((await getUser(user.id))!.avatar).toEqual(uploaded);
    // Even when the upload lands while the provider's picture is on its way
    await removeUserAvatar(user.id);
    await importProviderAvatar(user.id, 'google', async () => {
        await saveUserAvatar(user.id, picture, 'upload');
        return picture;
    });
    expect((await getUser(user.id))!.avatar?.source).toBe('upload');
    expect(await avatarDocs(user.id)).toHaveLength(1);

    // A failed fetch or an unknown account leaves initials and throws nothing
    const other = await findOrCreateUser(uniqueEmail('avatar-import-fail'));
    await importProviderAvatar(other.id, 'google', async () => null);
    await importProviderAvatar(other.id, 'google', async () => { throw new Error('offline'); });
    await importProviderAvatar('u_missing', 'google', load);
    expect((await getUser(other.id))!.avatar).toBeUndefined();
});

test('comment views show the pictures of authors and assignees who can still review the project', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const author = { kind: 'member', userId: `u_avatar_author_${suffix}`, name: 'Ada', isAdmin: false } as const;
    const assignee = { ...author, userId: `u_avatar_assignee_${suffix}`, name: 'Grace' };
    const plain = { ...author, userId: `u_avatar_plain_${suffix}`, name: 'Linus' };
    const project = { id: `av${suffix}`.slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [author, assignee, plain]);
    // Someone with a picture who is not a member of the project (left, or never had access)
    const outsider = await findOrCreateUser(uniqueEmail('avatar-outsider'));
    const picture = await normalizeAvatar(await image(40, 40, 'png')) as AvatarImage;
    for (const userId of [author.userId, assignee.userId, outsider.id]) await saveUserAvatar(userId, picture, 'upload');
    const comment: DbComment = { id: `comment_${suffix}`, domain: `project:${project.id}`, projectId: project.id, path: '/', number: 1,
        position: { type: 'page' }, authorId: `user:${author.userId}`, assigneeId: assignee.userId, resolved: false, thread: { items: [
            { id: 'first', text: 'Feedback', authorId: `user:${author.userId}` },
            { id: 'plain', text: 'No picture', authorId: `user:${plain.userId}` },
            { id: 'outsider', text: 'Not a member', authorId: `user:${outsider.id}` },
            { id: 'guest', text: 'A guest', authorId: 'visitor-hash', authorName: 'Guest 3F2A' }
        ] } };
    await getMemoryCommentsStore().create(comment);

    const [view] = await loadProjectComments({ user: { id: plain.userId }, isAdmin: false } as AppContext, project);
    const url = async (userId: string) => avatarUrl(await getUser(userId));
    expect(view!.author.avatarUrl).toBe(await url(author.userId));
    expect(view!.assignee).toMatchObject({ id: assignee.userId, avatarUrl: await url(assignee.userId) });
    expect(view!.replies.map(reply => reply.author.avatarUrl)).toEqual([undefined, undefined, undefined]);
});

test.describe('provider pictures', () => {
    let server: Server;
    let base = '';
    test.beforeAll(async () => {
        const png = await image(300, 300, 'png');
        server = createServer((request, response) => {
            switch (request.url) {
                case '/ok': response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(png);
                case '/redirect': response.writeHead(302, { Location: '/ok' }); return response.end();
                case '/html': response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html>');
                case '/svg': response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return response.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
                case '/announced': response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(MAX_PROVIDER_PICTURE_BYTES + 1) });
                    return response.end();
                case '/streamed': {
                    // No length announced: reading stops at the limit
                    response.writeHead(200, { 'Content-Type': 'image/png' });
                    response.write(png);
                    return response.end(Buffer.alloc(MAX_PROVIDER_PICTURE_BYTES));
                }
                case '/lying': response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end('GIF89a not really');
                default: response.writeHead(404); return response.end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });
    test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

    test('are fetched without redirects, as images within the size limit, then normalized', async () => {
        expect(await fetchProviderPicture(`${base}/ok`)).toMatchObject({ size: AVATAR_SIZE });
        for (const path of ['/redirect', '/html', '/svg', '/announced', '/streamed', '/lying', '/missing'])
            expect(await fetchProviderPicture(`${base}${path}`), path).toBeNull();
        expect(await fetchProviderPicture('http://127.0.0.1:1/closed')).toBeNull();
    });
});

test('only Google profile picture addresses are fetched, at the avatar size', () => {
    expect(googlePictureUrl('https://lh3.googleusercontent.com/a/ACg8ocJ-example=s96-c'))
        .toBe('https://lh3.googleusercontent.com/a/ACg8ocJ-example=s256-c');
    expect(googlePictureUrl('https://lh3.googleusercontent.com/a-/AOh14Gexample')).toBe('https://lh3.googleusercontent.com/a-/AOh14Gexample');
    for (const value of [
        'http://lh3.googleusercontent.com/a/example', 'https://googleusercontent.com.attacker.example/a', 'https://attacker.example/lh3.googleusercontent.com',
        'https://lh3.googleusercontent.com:8443/a', 'https://user:pass@lh3.googleusercontent.com/a', 'https://lh3.googleusercontent.com/a#x',
        'https://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'not a url', `https://lh3.googleusercontent.com/${'a'.repeat(2048)}`, 42, undefined
    ]) expect(googlePictureUrl(value), String(value)).toBeUndefined();
});
