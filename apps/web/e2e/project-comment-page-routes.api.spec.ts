import 'next/dist/server/node-environment.js';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server.js';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store.js';
import { createWorkStore } from 'next/dist/server/async-storage/work-store.js';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external.js';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import type { loadAppCommentsSnapshot } from '../src/lib/app/appCommentsSnapshot';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import type { DbProject } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { persistProjectAccess } from './support/projectAccess';
import { uniqueEmail } from './support/app';

const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (originalLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = originalLocal;
});

test('project page HTTP route enforces sessions, membership, origin, schema and cursor binding', async ({ baseURL }) => {
    // App modules use Next's bundler entry points; resolve their Node ESM filenames here.
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
        return nextResolve(/^next\/[^/.]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
    } });
    let POST: typeof import('../app/api/projects/[projectId]/comments/pages/route').POST;
    try { ({ POST } = await import('../app/api/projects/[projectId]/comments/pages/route')); }
    finally { hooks.deregister(); }
    const owner = await findOrCreateUser(uniqueEmail('paging-route-owner'));
    const member = await ensureOwnWorkspace(owner);
    const project = (await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12),
        workspaceId: member.workspaceId, aiTitles: 'off' } as DbProject, [])).id;
    const ownerCookie = `${cookieName(cookieNames.session)}=${sessionToken(owner.id, owner.email).token}`;
    const url = `${baseURL}/api/projects/${project}/comments/pages`, data = { params: { view: 'board' } };
    const post = (input: { data: unknown; headers?: Record<string, string> }, cookie = ownerCookie) => {
        const request = new NextRequest(url, { method: 'POST', headers: {
            'Content-Type': 'application/json', Host: new URL(url).host, Cookie: cookie, ...input.headers
        }, body: JSON.stringify(input.data) });
        // Supply the real request cookie/header scope used by the route's Next.js helpers.
        const store = createRequestStoreForAPI(request, new URL(url), { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined, undefined);
        const work = createWorkStore({ page: '/api/projects/[projectId]/comments/pages/route',
            buildId: 'test', deploymentId: '', previouslyRevalidatedTags: [], renderOpts: {
                waitUntil: undefined, onClose: () => {}, onAfterTaskError: undefined,
                cacheLifeProfiles: { default: { stale: 300, revalidate: 900, expire: 4294967294 } }, staticPageGenerationTimeout: 60, cacheComponents: true,
                validationLevel: 'warning', experimental: { authInterrupts: false, useCacheTimeout: 60, durableUseCacheEntries: false }, isBuildTimePrerendering: false
            } });
        return workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, () => POST(request, { params: Promise.resolve({ projectId: project }) })));
    };
    const unsigned = await post({ data }, '');
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get('cache-control')).toBe('private, no-store');
    expect(unsigned.headers.get('vary')).toContain('Cookie');
    const foreign = await post({ data, headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(foreign.status).toBe(403);
    const originOnly = await post({ data, headers: { Origin: 'https://attacker.example' } });
    expect(originOnly.status).toBe(403);
    const domain = `project:${project}`, store = getCommentsStore();
    for (let index = 0; index < 27; index++) {
        await store.create({ id: `route-${index}`, domain, projectId: project, origin: 'https://reviewed.example',
            path: '/paging', number: index + 1, authorId: 'visitor:reviewer', position: { type: 'page' },
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
            thread: { items: [{ id: 'first', text: `HTTP paging ${index}`, authorId: 'visitor:reviewer' }] } });
    }
    const first = await post({ data, headers: { Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' } });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    const snapshot = await first.json() as NonNullable<Awaited<ReturnType<typeof loadAppCommentsSnapshot>>>;
    expect(snapshot.comments).toHaveLength(25);
    expect(snapshot.paging.statusCounts.open).toBe(27);
    expect(snapshot.paging.statusUnread.open).toBe(27);
    expect(snapshot.paging.lanes.ready).toBeUndefined();
    const cursor = snapshot.paging.lanes.open!.nextCursor!;
    expect(cursor).toBeTruthy();
    for (const extra of [
        { lane: 'open', cursor: `${cursor}x` },
        { lane: 'done', cursor },
        { lane: 'open', cursor, depths: { open: 2 } },
        { depths: { open: 9 } },
        { depths: { foreign: 2 } },
        { unexpected: true }
    ]) {
        const invalid = await post({ data: { ...data, ...extra } });
        expect(invalid.status, await invalid.text()).toBe(400);
        expect(invalid.headers.get('cache-control')).toBe('private, no-store');
    }
    const refreshed = await post({ data: { ...data, depths: { open: 2 } } });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    expect(((await refreshed.json()) as { comments: unknown[] }).comments).toHaveLength(27);
    const nonmember = await findOrCreateUser(uniqueEmail('paging-route-nonmember'));
    const denied = await post({ data }, `${cookieName(cookieNames.session)}=${sessionToken(nonmember.id, nonmember.email).token}`);
    expect(denied.status).toBe(404);
    expect(denied.headers.get('cache-control')).toBe('private, no-store');
});
