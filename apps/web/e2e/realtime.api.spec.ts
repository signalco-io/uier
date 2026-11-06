import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, test } from '@playwright/test';
import { createRealtimeSources, visibleRevision } from '../src/lib/realtime/source';
import { issueRealtimeTicket, readRealtimeTicket, authorizeRealtime } from '../src/lib/realtime/tickets';
import { acceptRealtimeSocket } from '../src/lib/realtime/socket';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import { signToken } from '../src/lib/app/tokens';
import { canSeeComment } from '../src/lib/review/comments';
import type { AppContext } from '../src/lib/app/context';
import type { DbComment } from '../src/lib/db/schema';
import type { ProjectActor } from '../src/lib/review/actor';
import { GET as appTicket } from '../app/api/realtime/ticket/route';
import { GET as reviewTicket } from '../app/api/review/[projectId]/realtime/route';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const apiOrigin = 'http://realtime.localhost';
const siteOrigin = 'https://reviewed.example';
let server: WebSocketServer;
let address: string;
test.beforeAll(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 2048 });
    server.on('connection', (socket, request) => acceptRealtimeSocket(socket, request.headers.origin!, apiOrigin));
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    address = `ws://127.0.0.1:${port}`;
});
test.afterAll(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

async function fixture() {
    const user = await findOrCreateUser(`realtime-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Realtime test', urls: [siteOrigin] });
    const stored = (await getAppStore().get<typeof project>(project.pk, project.id))!;
    project.access = 'guests';
    await getAppStore().replace(project, stored.etag);
    return { user, member, project, domain: `project:${project.id}` };
}

function comment(domain: string, authorId?: string, isPrivate = false): DbComment {
    return { id: `comment_${randomUUID()}`, domain, path: '/', authorId, private: isPrivate, position: { type: 'page' },
        thread: { items: [{ id: `item_${randomUUID()}`, text: 'Private content never goes over the socket' }] }, createdAt: new Date().toISOString() };
}

async function connect(f: Awaited<ReturnType<typeof fixture>>, actor: ProjectActor, origin = siteOrigin) {
    const ticket = issueRealtimeTicket(new Request(`${apiOrigin}/ticket`, { headers: { Origin: origin } }), f.domain, actor, 'review', f.project);
    const client = new WebSocket(address, { origin });
    const frames: string[] = [];
    const closed: number[] = [];
    client.on('message', data => frames.push(data.toString()));
    client.on('close', code => closed.push(code));
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'subscribe', token: ticket.token }));
    await expect.poll(() => frames.length).toBe(1);
    expect(frames).toEqual(['{"type":"ready"}']);
    return { client, frames, closed };
}

test('tickets require the correct purpose, origin, deployment and current project membership', async () => {
    const f = await fixture();
    const actor: ProjectActor = { kind: 'member', userId: f.user.id, name: f.user.name, isAdmin: true };
    const ticket = issueRealtimeTicket(new Request(`${apiOrigin}/ticket`), f.domain, actor, 'app', f.project);
    const claims = readRealtimeTicket(ticket.token, apiOrigin, apiOrigin)!;
    expect(await authorizeRealtime(claims)).toMatchObject({ kind: 'member', userId: f.user.id });
    expect(readRealtimeTicket(ticket.token, siteOrigin, apiOrigin)).toBeNull();
    expect(readRealtimeTicket(ticket.token, apiOrigin, 'https://another-deployment.example')).toBeNull();
    expect(readRealtimeTicket(`${ticket.token}x`, apiOrigin, apiOrigin)).toBeNull();
    expect(readRealtimeTicket(signToken('session', claims, 300), apiOrigin, apiOrigin)).toBeNull();
    expect(readRealtimeTicket(signToken('realtime', claims, -1), apiOrigin, apiOrigin)).toBeNull();
    await getAppStore().delete(f.member.pk, f.member.id);
    await expect(authorizeRealtime(claims)).rejects.toThrow();
});

test('ticket endpoints apply app authentication, project access and exact embed CORS', async () => {
    const f = await fixture();
    expect((await appTicket(new Request(`${apiOrigin}/api/realtime/ticket?projectId=${f.project.id}`))).status).toBe(401);
    const session = signToken('session', { uid: f.user.id }, 300);
    const response = await appTicket(new Request(`${apiOrigin}/api/realtime/ticket?projectId=${f.project.id}`, { headers: { Cookie: `uier_session=${session}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const good = await reviewTicket(new Request(`${apiOrigin}/api/review/${f.project.publicId}/realtime`, { headers: { Origin: siteOrigin } }), { params: Promise.resolve({ projectId: f.project.publicId }) });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe(siteOrigin);
    const bad = await reviewTicket(new Request(`${apiOrigin}/api/review/${f.project.publicId}/realtime`, { headers: { Origin: 'https://unrelated.example' } }), { params: Promise.resolve({ projectId: f.project.publicId }) });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
});

test('real sockets detect create, reply, edit, resolution and hard deletion from committed storage', async () => {
    const f = await fixture();
    const connection = await connect(f, { kind: 'guest', visitorId: 'guest-a' });
    try {
        const store = getMemoryCommentsStore();
        const thread = comment(f.domain, 'guest-a');
        await store.create(thread);
        await expect.poll(() => connection.frames.length).toBe(2);
        await store.appendThreadItem(f.domain, thread.id, { id: 'reply', text: 'Another reviewer replied', authorId: 'guest-b' }, 100, new Date().toISOString());
        await expect.poll(() => connection.frames.length).toBe(3);
        const saved = (await store.get(f.domain, thread.id))!;
        await store.replace({ ...saved.comment, resolved: true, priority: 'high' }, saved.etag);
        await expect.poll(() => connection.frames.length).toBe(4);
        const resolved = (await store.get(f.domain, thread.id))!;
        await store.replace({ ...resolved.comment, thread: { items: [{ id: 'edited', text: 'Edited text' }] } }, resolved.etag);
        await expect.poll(() => connection.frames.length).toBe(5);
        const edited = (await store.get(f.domain, thread.id))!;
        await store.delete(f.domain, thread.id, edited.etag);
        await expect.poll(() => connection.frames.length).toBe(6);
        expect(connection.frames.slice(1)).toEqual(Array(5).fill('{"type":"comments.changed"}'));
    } finally { connection.client.close(); }
});

test('private changes notify only their author and current admins; revoked sockets close', async () => {
    const f = await fixture();
    const author = await connect(f, { kind: 'guest', visitorId: 'author' });
    const other = await connect(f, { kind: 'guest', visitorId: 'other' });
    const admin = await connect(f, { kind: 'member', userId: f.user.id, name: f.user.name, isAdmin: true });
    try {
        const store = getMemoryCommentsStore();
        await store.create(comment(f.domain, 'author', true));
        await expect.poll(() => author.frames.length).toBe(2);
        await expect.poll(() => admin.frames.length).toBe(2);
        expect(other.frames).toEqual(['{"type":"ready"}']);
        await store.create(comment(f.domain, 'author'));
        await expect.poll(() => other.frames.length).toBe(2);
        expect(other.frames[1]).toBe('{"type":"comments.changed"}');
        await getAppStore().delete(f.member.pk, f.member.id);
        await expect.poll(() => admin.closed).toEqual([1008]);
    } finally { author.client.close(); other.client.close(); admin.client.close(); }
});

test('the shared source coalesces reads, releases state and observes changes across independent instances', async () => {
    const f = await fixture();
    let now = 0;
    let reads = 0;
    const read = async (domain: string) => { reads++; return getMemoryCommentsStore().listRealtime(domain); };
    const firstInstance = createRealtimeSources(read, () => now);
    const secondInstance = createRealtimeSources(read, () => now);
    const first = firstInstance(f.domain), shared = firstInstance(f.domain), second = secondInstance(f.domain);
    try {
        await Promise.all([first.read(), shared.read(), second.read()]);
        expect(reads).toBe(2);
        const before = visibleRevision(await first.read(), () => true);
        await getMemoryCommentsStore().create(comment(f.domain));
        now += 2_001;
        const [a, b] = await Promise.all([first.read(), second.read()]);
        expect(visibleRevision(a, () => true)).not.toBe(before);
        expect(visibleRevision(a, () => true)).toBe(visibleRevision(b, () => true));
        expect(a[0]).not.toHaveProperty('thread');
        expect(a[0]).not.toHaveProperty('text');
        const hidden = { ...a[0]!, private: true, authorId: 'another-person' };
        expect(visibleRevision([hidden], c => canSeeComment(c, { kind: 'anonymous' }))).toBe(visibleRevision([], () => true));
    } finally { first.release(); shared.release(); second.release(); }
    await expect(first.read()).rejects.toThrow('ended');
});

test('socket authentication rejects foreign origins and arbitrary client frames without data', async () => {
    const f = await fixture();
    const ticket = issueRealtimeTicket(new Request(`${apiOrigin}/ticket`, { headers: { Origin: siteOrigin } }), f.domain,
        { kind: 'guest', visitorId: 'guest' }, 'review', f.project);
    for (const [origin, frame] of [
        ['https://unrelated.example', JSON.stringify({ type: 'subscribe', token: ticket.token })],
        [siteOrigin, '{broken'],
        [siteOrigin, JSON.stringify({ type: 'write', projectId: f.project.id, resolved: true })]
    ]) {
        const socket = new WebSocket(address, { origin });
        const frames: string[] = [];
        socket.on('message', data => frames.push(data.toString()));
        await once(socket, 'open');
        const close = once(socket, 'close');
        socket.send(frame!);
        expect((await close)[0]).toBe(1008);
        expect(frames).toEqual([]);
    }
});
