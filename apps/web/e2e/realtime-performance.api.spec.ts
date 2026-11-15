import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import type { WebSocket } from 'ws';
import { expect, test } from '@playwright/test';
import { createRealtimeAuthorizer, issueRealtimeTicket, type RealtimeClaims } from '../src/lib/realtime/tickets';
import { acceptRealtimeSocket } from '../src/lib/realtime/socket';
import { getAppStore } from '../src/lib/app/store';
import type { DbProject } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { ProjectActor } from '../src/lib/review/actor';
import { persistProjectAccess } from './support/projectAccess';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const claims: RealtimeClaims = {
    domain: 'project:fixture', projectId: 'fixture', workspaceId: 'workspace',
    origin: 'https://reviewed.example', apiOrigin: 'https://uier.example', audience: 'review',
    identity: { kind: 'member', userId: 'member' }
};
const member: ProjectActor = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false };

test('overlapping identical authorization reads share work, while settled and rejected reads are fresh', async ({}, testInfo) => {
    let reads = 0;
    let allowed = true;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const authorize = createRealtimeAuthorizer(async () => {
        reads++;
        await blocked;
        if (!allowed) throw new Error('Access revoked');
        return member;
    });
    const firstTick = Array.from({ length: 20 }, () => authorize({ ...claims, identity: { ...claims.identity } }));
    await Promise.resolve();
    expect(reads).toBe(1);
    release();
    expect(await Promise.all(firstTick)).toEqual(Array(20).fill(member));
    allowed = false;
    await expect(authorize(claims)).rejects.toThrow('Access revoked');
    expect(reads).toBe(2);
    allowed = true;
    expect(await authorize(claims)).toEqual(member);
    expect(reads).toBe(3);
    await testInfo.attach('realtime-overlapping-authorization-reads', { contentType: 'application/json', body: JSON.stringify({
        concurrentIdenticalRequests: firstTick.length, beforeReadOperations: firstTick.length, afterReadOperations: 1,
        nextRevokedReadWasFresh: true, subsequentRestoredReadWasFresh: true,
        productionSavingsMeasured: false
    }) });
});

test('authorization work never crosses the identity, project, workspace, audience or origin boundary', async () => {
    let reads = 0;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const authorize = createRealtimeAuthorizer(async () => { reads++; await blocked; return member; });
    const independent: RealtimeClaims[] = [claims,
        { ...claims, identity: { kind: 'member', userId: 'another-member' } },
        { ...claims, identity: { kind: 'guest', visitorId: 'member' } },
        { ...claims, projectId: 'another-project' },
        { ...claims, workspaceId: 'another-workspace' },
        { ...claims, domain: 'project:another-partition' },
        { ...claims, audience: 'showcase' },
        { ...claims, origin: 'https://another.example' },
        { ...claims, apiOrigin: 'https://another-api.example' }];
    const requests = independent.map(scope => authorize(scope));
    await Promise.resolve();
    expect(reads).toBe(independent.length);
    release();
    await Promise.all(requests);
});

test('idle sockets reduce storage reads, keep private changes hidden and promptly resume after visible changes', async ({}, testInfo) => {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12),
        publicId: randomUUID().replaceAll('-', '').slice(0, 21) } as DbProject);
    const domain = `project:${project.id}`, store = getMemoryCommentsStore();
    const comment = (privateThread: boolean): DbComment => ({ id: `comment_${randomUUID()}`, domain, path: '/',
        authorId: 'another-guest', private: privateThread, position: { type: 'page' }, createdAt: new Date().toISOString(),
        thread: { items: [{ id: 'first', text: 'Never sent over the socket', authorId: 'another-guest' }] } });
    // Seed the partition before observing reads. No production dependency is replaced.
    const hidden = comment(true);
    await store.create(hidden);
    const comments = (globalThis as unknown as { __uierCommentsMemoryStore2: { domains: Map<string, Map<unknown, unknown>> } })
        .__uierCommentsMemoryStore2.domains.get(domain)!;
    const projects = (globalThis as unknown as { __uierAppMemoryStore: { partitions: Map<string, Map<unknown, unknown>> } })
        .__uierAppMemoryStore.partitions.get(project.pk)!;
    const get = Map.prototype.get, values = Map.prototype.values;
    let authorizationReads = 0, metadataReads = 0;
    const gets = mock.method(Map.prototype, 'get', function(this: Map<unknown, unknown>, key: unknown) {
        if (this === projects && key === project.id) authorizationReads++;
        return get.call(this, key);
    });
    const scans = mock.method(Map.prototype, 'values', function(this: Map<unknown, unknown>) {
        if (this === comments) metadataReads++;
        return values.call(this);
    });
    class Socket extends EventEmitter {
        bufferedAmount = 0;
        frames: string[] = [];
        closed: number[] = [];
        send(frame: string) { this.frames.push(frame); }
        close(code = 1000) { this.closed.push(code); this.emit('close'); }
    }
    const socket = new Socket();
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    const advance = async (ms: number) => { mock.timers.tick(ms); await flush(); };
    try {
        const ticket = issueRealtimeTicket(new Request(`${claims.apiOrigin}/ticket`, { headers: { Origin: claims.origin } }),
            domain, { kind: 'guest', visitorId: 'viewer' }, 'review', project);
        acceptRealtimeSocket(socket as unknown as WebSocket, claims.origin, claims.apiOrigin);
        socket.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', token: ticket.token })), false);
        await flush();
        expect(socket.frames).toEqual(['{"type":"ready"}']);
        expect([authorizationReads, metadataReads]).toEqual([1, 1]);
        for (let i = 0; i < 5; i++) await advance(2_000);
        expect([authorizationReads, metadataReads]).toEqual([6, 6]);
        await advance(4_999);
        expect([authorizationReads, metadataReads]).toEqual([6, 6]);
        const saved = (await store.get(domain, hidden.id))!;
        await store.replace({ ...saved.comment, resolved: true }, saved.etag);
        await advance(1);
        expect([authorizationReads, metadataReads]).toEqual([7, 7]);
        expect(socket.frames).toEqual(['{"type":"ready"}']);
        await advance(2_000);
        expect([authorizationReads, metadataReads]).toEqual([7, 7]);
        const visible = comment(false);
        await store.create(visible);
        await advance(3_000);
        expect([authorizationReads, metadataReads]).toEqual([8, 8]);
        expect(socket.frames).toEqual(['{"type":"ready"}', '{"type":"comments.changed"}']);
        await advance(2_000);
        expect([authorizationReads, metadataReads]).toEqual([9, 9]);
        // Hard deletion is also a visible change; do not depend on write-side signals.
        const current = (await store.get(domain, visible.id))!;
        await store.delete(domain, visible.id, current.etag);
        await advance(2_000);
        expect(socket.frames).toEqual(['{"type":"ready"}', '{"type":"comments.changed"}', '{"type":"comments.changed"}']);
        const readsBeforeClose = [authorizationReads, metadataReads];
        socket.close();
        await advance(10_000);
        expect([authorizationReads, metadataReads]).toEqual(readsBeforeClose);
        await testInfo.attach('realtime-idle-polling', { contentType: 'application/json', body: JSON.stringify({
            activeIntervalMs: 2_000, idleAfterMs: 10_000, idleIntervalMs: 5_000,
            idlePollReduction: 0.6, privateChangesResetCadence: false, authorizationPerPoll: true,
            productionSavingsMeasured: false
        }) });
    } finally {
        if (!socket.closed.length) socket.close();
        mock.timers.reset();
        gets.mock.restore();
        scans.mock.restore();
    }
});

test('an idle socket rechecks revoked access before reading or notifying', async () => {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12),
        publicId: randomUUID().replaceAll('-', '').slice(0, 21) } as DbProject);
    const domain = `project:${project.id}`;
    class Socket extends EventEmitter {
        bufferedAmount = 0;
        frames: string[] = [];
        closed: number[] = [];
        send(frame: string) { this.frames.push(frame); }
        close(code = 1000) { this.closed.push(code); this.emit('close'); }
    }
    const socket = new Socket();
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    try {
        const ticket = issueRealtimeTicket(new Request(`${claims.apiOrigin}/ticket`, { headers: { Origin: claims.origin } }),
            domain, { kind: 'guest', visitorId: 'viewer' }, 'review', project);
        acceptRealtimeSocket(socket as unknown as WebSocket, claims.origin, claims.apiOrigin);
        socket.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', token: ticket.token })), false);
        await flush();
        for (let i = 0; i < 5; i++) { mock.timers.tick(2_000); await flush(); }
        await getAppStore().delete(project.pk, project.id);
        await getMemoryCommentsStore().create({ id: `comment_${randomUUID()}`, domain, path: '/', position: { type: 'page' },
            thread: { items: [{ id: 'first', text: 'No notification after access is revoked' }] }, createdAt: new Date().toISOString() });
        mock.timers.tick(4_999);
        await flush();
        expect(socket.closed).toEqual([]);
        mock.timers.tick(1);
        await flush();
        expect(socket.closed).toEqual([1008]);
        expect(socket.frames).toEqual(['{"type":"ready"}']);
    } finally {
        if (!socket.closed.length) socket.close();
        mock.timers.reset();
    }
});
