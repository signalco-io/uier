import type { ReattachAnchorInput } from '../src/lib/comments/validation';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pngImage } from './support/images';
import { reattachAnchor } from '../src/lib/comments/reattachAnchor';
import { reattachProjectAnchor } from '../src/lib/review/comments';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { toCommentDto } from '../src/lib/comments/dto';

const point = { type: 'point' as const, selector: 'h1', xNormal: 0.5, yNormal: 0.5 };
const text = { type: 'text' as const, startSelector: 'p', startType: 'text' as const, startOffset: 0, endType: 'text' as const, endOffset: 11, text: 'New wording' };
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });

async function saved() {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), urls: ['https://reviewed.example', 'https://preview.example'] } as DbProject;
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        origin: project.urls[0], path: '/page?tab=one', pageStateVersion: 1, position: point, kind: 'rewrite',
        authorId: 'owner', resolved: true, createdAt: '2026-10-25T10:00:00Z',
        device: { windowSize: [1000, 700], browser: 'Private browser' },
        screenshot: { width: 1, height: 1, bytes: 1, contentType: 'image/png' },
        thread: { items: [{ id: 'first', text: 'Keep me', quotedText: 'Original words', authorId: 'owner' }, { id: 'reply', text: 'Reply', authorId: 'other' }] } };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    return { store, comment, project, input: { path: comment.path, position: text, expectedRevision: null } };
}

test('public reattachment validates selectors, page and ownership, preserving the complete thread and evidence', async ({ request, playwright, baseURL }) => {
    const path = `/reattach-${randomUUID()}`;
    const result = await request.post('/api/comments', { data: { path, position: point, text: 'Keep this', quotedText: 'Original quote', screenshot: pngImage } });
    expect(result.status()).toBe(201);
    const comment = await result.json();
    await request.post(`/api/comments/${comment.id}/replies`, { data: { text: 'Keep reply' } });
    const originalImage = await (await request.get(`/api/comments/${comment.id}/screenshot`)).body();
    const before = await (await request.patch(`/api/comments/${comment.id}`, { data: { resolved: true } })).json();
    const url = `/api/comments/${comment.id}/anchor`;
    const input = { path, position: text, expectedRevision: null };
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        expect((await stranger.patch(url, { data: input })).status()).toBe(403);
        for (const invalid of [
            { ...input, path: '/other' }, { ...input, path: '//other.example/path' },
            { ...input, position: { ...text, startSelector: 'p[title=bad]' } },
            { ...input, position: { ...text, startSelector: 'p:has(a)' } },
            { ...input, position: { ...text, startOffset: -1 } }, { ...input, position: { type: 'page' } },
            { path, position: point }
        ]) expect((await request.patch(url, { data: invalid })).status()).toBe(400);
        expect((await request.patch(url, { headers: { Origin: 'https://other.example' }, data: input })).status()).toBe(403);
        const changed = await request.patch(url, { data: input });
        expect(changed.status()).toBe(200);
        const after = await changed.json();
        expect(after).toMatchObject({ ...before, position: text,
            anchorContext: { original: point, previous: point, revision: expect.any(String), changedAt: expect.any(String), changes: 1 } });
        expect(await (await request.get(`/api/comments/${comment.id}/screenshot`)).body()).toEqual(originalImage);
        expect((await request.patch(url, { data: input })).status()).toBe(409);
        const again = await request.patch(url, { data: { ...input, position: point, expectedRevision: after.anchorContext.revision } });
        expect((await again.json()).anchorContext).toMatchObject({ original: point, previous: text, changes: 2 });
        const listed = await (await request.get(`/api/comments?path=${path}`)).json();
        expect(listed[0].id).toBe(before.id);
        expect(listed[0].thread).toEqual(before.thread);
    } finally { await stranger.dispose(); }
});

test('project reattachment checks author/admin, project partition, original origin, exact view and private access', async () => {
    const { comment, project, input, store } = await saved();
    const owner = { kind: 'guest', visitorId: 'owner' } as const;
    const outsider = { kind: 'guest', visitorId: 'stranger' } as const;
    const member = { kind: 'member', userId: 'member', name: 'Member', isAdmin: false } as const;
    const admin = { ...member, userId: 'admin', isAdmin: true };
    const apply = (actor: Parameters<typeof reattachProjectAnchor>[1], origin = comment.origin!, body = input, targetProject = project) => reattachProjectAnchor(targetProject, actor, comment.id, origin, body);
    for (const actor of [outsider, member]) await expect(apply(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(apply({ kind: 'anonymous' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(apply(owner, 'https://elsewhere.example')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(apply(owner, project.urls[1])).rejects.toMatchObject({ code: 'forbidden' });
    await expect(apply(owner, comment.origin, { ...input, path: '/page?tab=two' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(apply(owner, comment.origin, input, { ...project, id: randomUUID() })).rejects.toMatchObject({ code: 'not_found' });
    const changed = await apply(owner);
    expect(changed).toMatchObject({ ...comment, position: text, anchorContext: expect.any(Object) });
    const current = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...current.comment, private: true }, current.etag);
    await expect(apply(outsider)).rejects.toMatchObject({ code: 'not_found' });
    const revised = await reattachProjectAnchor(project, admin, comment.id, comment.origin!, { ...input, position: point, expectedRevision: changed.anchorContext!.revision });
    expect(revised.anchorContext).toMatchObject({ original: point, previous: text, changes: 2 });
    expect(JSON.stringify(toCommentDto(revised, undefined))).not.toContain('Private browser');
    expect(JSON.stringify(toCommentDto(revised, undefined)?.anchorContext)).not.toContain('owner');
});

test('concurrent anchors have one winner; racing replies are preserved and lost visibility is rechecked', async () => {
    const { store, comment, input } = await saved();
    const results = await Promise.allSettled([point, text].map(position => reattachAnchor(store, comment.domain, comment.id, { ...input, position }, () => {})));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    const second = await saved();
    let race = true;
    const racingStore = { ...second.store, replace: async (...args: Parameters<typeof store.replace>) => {
        if (race) {
            race = false;
            const current = (await store.get(second.comment.domain, second.comment.id))!;
            await store.replace({ ...current.comment, resolved: false, thread: { items: [...current.comment.thread.items, { id: 'racing', text: 'Keep concurrent reply' }] } }, current.etag);
        }
        return store.replace(...args);
    } };
    const updated = await reattachAnchor(racingStore, second.comment.domain, second.comment.id, second.input, () => {});
    expect(updated.thread.items.at(-1)?.text).toBe('Keep concurrent reply');
    expect(updated.resolved).toBe(false);
    const third = await saved();
    const revoked = { ...store, replace: async (...args: Parameters<typeof store.replace>) => {
        const current = (await store.get(third.comment.domain, third.comment.id))!;
        await store.replace({ ...current.comment, private: true }, current.etag);
        return store.replace(...args);
    } };
    await expect(reattachAnchor(revoked, third.comment.domain, third.comment.id, third.input, c => {
        if (c.private) throw new Error('Access lost');
    })).rejects.toThrow('Access lost');
    expect((await store.get(third.comment.domain, third.comment.id))?.comment.position).toEqual(point);
});

test('review anchor route rechecks membership and comments-off state, rejects foreign origins and applies page policy', async () => {
    const { getAppStore } = await import('../src/lib/app/store');
    const { signToken } = await import('../src/lib/app/tokens');
    const { reviewApiHandler, reviewPreflight } = await import('../src/lib/review/http');
    const { reattachReviewAnchor } = await import('../src/lib/review/anchorRoutes');
    const { project, comment, store, input } = await saved();
    const app = getAppStore();
    const workspaceId = randomUUID();
    const pk = `workspace:${workspaceId}` as const;
    const now = new Date().toISOString();
    const realProject: DbProject = { ...project, type: 'project', pk, workspaceId, name: 'Anchor access', access: 'invited',
        status: 'active', createdBy: 'alice', createdAt: now, updatedAt: now, pageState: { queryParameters: ['tab'], hashRouting: false } };
    await app.create(realProject);
    await app.create({ type: 'project-ref', id: project.id, pk: `project:${project.id}`, workspaceId });
    await app.create({ type: 'user', id: 'alice', pk: 'user:alice', name: 'Alice', email: 'alice@example.com', createdAt: now, updatedAt: now });
    await app.create({ type: 'member', id: 'member_alice', pk, workspaceId, userId: 'alice', email: 'alice@example.com', role: 'commenter', projects: 'all', createdAt: now });
    const original = (await store.get(comment.domain, comment.id))!;
    await store.replace({ ...comment, authorId: 'user:alice' }, original.etag);
    const headers = { Authorization: `Bearer ${signToken('review', { uid: 'alice', pid: project.id }, 3600)}`, Origin: comment.origin!, 'Content-Type': 'application/json' };
    const handler = reviewApiHandler<{ projectId: string; id: string }>(reattachReviewAnchor, { verifyWrites: false });
    const call = (body: ReattachAnchorInput = input, extra = {}) => handler(new Request(`https://uier.io/api/review/${project.id}/comments/${comment.id}/anchor`, {
        method: 'PATCH', headers: { ...headers, ...extra }, body: JSON.stringify(body)
    }), { params: Promise.resolve({ projectId: project.id, id: comment.id }) });
    expect((await call({ ...input, path: '/page?tab=one&token=secret' })).status).toBe(400);
    expect((await call(input, { Origin: 'https://other.example' })).status).toBe(403);
    expect((await call(input, { Origin: project.urls[1] })).status).toBe(403);
    const preflight = await reviewPreflight('PATCH')(new Request(`https://uier.io/api/review/${project.id}/comments/${comment.id}/anchor`, { method: 'OPTIONS', headers }), { params: Promise.resolve({ projectId: project.id }) });
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('PATCH');
    const changed = await call();
    expect(changed.status).toBe(200);
    const dto = await changed.json() as { anchorContext: { revision: string } };
    const storedProject = (await app.get<DbProject>(pk, project.id))!;
    await app.replace({ ...realProject, access: 'disabled' }, storedProject.etag);
    expect((await call()).status).toBe(403);
    const disabledProject = (await app.get<DbProject>(pk, project.id))!;
    await app.replace(realProject, disabledProject.etag);
    await app.delete(pk, 'member_alice');
    expect((await call({ ...input, expectedRevision: dto.anchorContext.revision })).status).toBe(401);
    expect((await store.get(comment.domain, comment.id))!.comment.anchorContext?.changes).toBe(1);
});
