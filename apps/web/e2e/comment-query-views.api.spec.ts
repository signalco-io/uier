import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { type QueryDocument } from '@uier/comments-query';
import { memberId, projectRefPk, userPk, workspacePk, type DbMember, type DbProject, type DbUser, type DbWorkspace } from '../src/lib/app/model';
import { createMemoryAppStore, type AppStore } from '../src/lib/app/store';
import { signToken } from '../src/lib/app/tokens';
import { reviewCommentViewHandler, workspaceCommentViewHandler } from '../src/lib/commentQuery/viewRoutes';
import {
    COMMENT_QUERY_LINK_TTL_SECONDS, createCommentQueryLink, createCommentView, deleteCommentView,
    duplicateCommentView, getCommentQueryLink, getCommentView, listCommentViews, updateCommentView,
    type CommentViewPrincipal, type DbCommentQueryLink, type DbCommentView
} from '../src/lib/commentQuery/views';
import { reviewPreflight } from '../src/lib/review/http';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET ??= 'saved-query-local-authorization-secret';
});

async function fixture() {
    const store = createMemoryAppStore(), suffix = randomUUID().replaceAll('-', ''), workspaceId = `w_${suffix}`,
        pk = workspacePk(workspaceId), now = new Date().toISOString();
    const users: DbUser[] = ['admin', 'person', 'other'].map(name => ({
        type: 'user', id: `u_${name}_${suffix}`, pk: userPk(`u_${name}_${suffix}`),
        email: `${name}-${suffix}@example.test`, name, createdAt: now, updatedAt: now
    }));
    for (const user of users) await store.create(user);
    const workspace: DbWorkspace = { type: 'workspace', id: workspaceId, pk, name: 'Saved views', createdBy: users[0]!.id, createdAt: now };
    await store.create(workspace);
    const projects: DbProject[] = ['a', 'b'].map((name, i) => ({
        type: 'project', id: suffix.slice(0, 11) + String(i), pk, workspaceId, name,
        publicId: `${suffix.slice(0, 20)}${name}`, urls: ['https://review.example.test'], status: 'active', access: 'guests',
        createdBy: users[0]!.id, createdAt: now, updatedAt: now
    }));
    for (const project of projects) {
        await store.create(project);
        await store.create({ type: 'project-ref', id: project.id, pk: projectRefPk(project.id), workspaceId });
    }
    const members: DbMember[] = users.map((user, i) => ({
        type: 'member', id: memberId(user.id), pk, workspaceId, userId: user.id, email: user.email,
        role: i === 0 ? 'admin' : 'commenter', projects: i === 0 ? 'all' : [projects[0]!.id], createdAt: now
    }));
    for (const member of members) await store.create(member);
    const principal = (i: number, projectId?: string): CommentViewPrincipal => ({ workspaceId, userId: users[i]!.id, ...(projectId ? { projectId } : {}) });
    const query: QueryDocument = { version: 1, scope: { kind: 'project', projectId: projects[0]!.id }, collection: 'ordinary', order: [{ field: 'created', direction: 'desc' }], timezone: 'Europe/Zagreb' };
    return { store, workspace, users, projects, members, principal, query };
}

async function changeMember(f: Awaited<ReturnType<typeof fixture>>, index: number, change: Partial<DbMember>) {
    const member = (await f.store.get<DbMember>(f.workspace.pk, f.members[index]!.id))!;
    expect(await f.store.replace({ ...member.doc, ...change }, member.etag)).toBe('ok');
}

test('personal views belong only to their owner; metadata lists never return the query or its ETag', async () => {
    const f = await fixture(), owner = f.principal(1);
    const view = await createCommentView(owner, { name: '  My queue  ', query: f.query }, f.store);
    expect(view.name).toBe('My queue');
    expect(view.sharing).toBe('personal');
    expect(view.scope).toEqual(f.query.scope);
    expect(await getCommentView(owner, view.id, f.store)).toEqual(view);
    const listed = await listCommentViews(owner, f.store);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('query');
    expect(listed[0]).not.toHaveProperty('version');
    for (const other of [f.principal(0), f.principal(2)]) {
        expect(await listCommentViews(other, f.store)).toEqual([]);
        await expect(getCommentView(other, view.id, f.store)).rejects.toMatchObject({ status: 404 });
        await expect(updateCommentView(other, view.id, { name: 'Take over', version: view.version }, f.store)).rejects.toMatchObject({ status: 404 });
        await expect(deleteCommentView(other, view.id, { version: view.version }, f.store)).rejects.toMatchObject({ status: 404 });
    }
});

test('admins explicitly share views; members can duplicate a shared view into a personal view', async () => {
    const f = await fixture(), shared = await createCommentView(f.principal(0), { name: 'Triage', sharing: 'shared', query: f.query }, f.store);
    expect((await listCommentViews(f.principal(1), f.store)).map(view => view.id)).toEqual([shared.id]);
    await expect(createCommentView(f.principal(1), { name: 'Shared', sharing: 'shared', query: f.query }, f.store)).rejects.toMatchObject({ status: 403 });
    await expect(updateCommentView(f.principal(1), shared.id, { name: 'Overwrite', version: shared.version }, f.store)).rejects.toMatchObject({ status: 403 });
    await expect(deleteCommentView(f.principal(1), shared.id, { version: shared.version }, f.store)).rejects.toMatchObject({ status: 403 });
    const copy = await duplicateCommentView(f.principal(1), shared.id, {}, f.store);
    expect(copy).toMatchObject({ name: 'Triage (copy)', sharing: 'personal', ownerId: f.users[1]!.id, query: f.query });
    expect(copy.id).not.toBe(shared.id);
    const madePersonal = await updateCommentView(f.principal(0), shared.id, { sharing: 'personal', version: shared.version }, f.store);
    expect(madePersonal.sharing).toBe('personal');
    await expect(getCommentView(f.principal(1), shared.id, f.store)).rejects.toMatchObject({ status: 404 });
});

test('concurrent updates and deletes require the current version and never overwrite a newer definition', async () => {
    const f = await fixture(), principal = f.principal(1), view = await createCommentView(principal, { name: 'Start', query: f.query }, f.store);
    const results = await Promise.allSettled([
        updateCommentView(principal, view.id, { version: view.version, name: 'First' }, f.store),
        updateCommentView(principal, view.id, { version: view.version, name: 'Second' }, f.store)
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const current = await getCommentView(principal, view.id, f.store);
    expect(current.version).not.toBe(view.version);
    await expect(deleteCommentView(principal, view.id, { version: view.version }, f.store)).rejects.toMatchObject({ status: 409 });
    await deleteCommentView(principal, view.id, { version: current.version }, f.store);
    await expect(getCommentView(principal, view.id, f.store)).rejects.toMatchObject({ status: 404 });
});

test('scope and owner cannot be forged through creation, mutation, review adapters or another workspace', async () => {
    const f = await fixture(), foreign = await fixture(), review = f.principal(1, f.projects[0]!.id);
    for (const input of [
        { ...f.query, scope: { kind: 'workspace', workspaceId: foreign.workspace.id } },
        { ...f.query, scope: { kind: 'project', projectId: foreign.projects[0]!.id } },
        { ...f.query, scope: { kind: 'public' } }
    ]) await expect(createCommentView(f.principal(1), { name: 'Forged', query: input }, f.store)).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(createCommentView(f.principal(1), { name: 'Forged', query: f.query, ownerId: f.users[0]!.id }, f.store)).rejects.toMatchObject({ status: 400 });
    await expect(createCommentView(review, { name: 'Other scope', query: { ...f.query, scope: { kind: 'workspace', workspaceId: f.workspace.id } } }, f.store)).rejects.toMatchObject({ status: 400 });
    await expect(createCommentView(review, { name: 'Other project', query: { ...f.query, scope: { kind: 'project', projectId: f.projects[1]!.id } } }, f.store)).rejects.toMatchObject({ status: 400 });
    const view = await createCommentView(f.principal(0), { name: 'Project', sharing: 'shared', query: f.query }, f.store);
    await expect(updateCommentView(f.principal(0), view.id, { version: view.version, query: { ...f.query, scope: { kind: 'project', projectId: f.projects[1]!.id } } }, f.store)).rejects.toMatchObject({ status: 400 });
    await expect(getCommentView(foreign.principal(0), view.id, foreign.store)).rejects.toMatchObject({ status: 404 });
    await expect(getCommentView(f.principal(0, f.projects[1]!.id), view.id, f.store)).rejects.toMatchObject({ status: 404 });
    const alias = await createCommentView(review, { name: 'Review URL', query: { ...f.query, scope: { kind: 'project', projectId: f.projects[0]!.publicId! } } }, f.store);
    expect(alias.query.scope).toEqual(f.query.scope);
});

test('nested restricted filters and ordering recheck current capability, including existing shared definitions', async () => {
    const f = await fixture(), principal = f.principal(1);
    for (const query of [
        { ...f.query, where: { not: { any: [{ field: 'author', operator: 'includesAny', value: [`user:${f.users[0]!.id}`] }] } } },
        { ...f.query, where: { field: 'device', operator: 'isAnyOf', value: ['mobile'] } },
        { ...f.query, order: [{ field: 'width', direction: 'asc' }] }
    ]) await expect(createCommentView(principal, { name: 'Restricted', query }, f.store)).rejects.toMatchObject({ status: 403 });
    const mine = await createCommentView(principal, { name: 'Mine', query: { ...f.query, where: { field: 'openedBy', operator: 'isAnyOf', value: [{ relative: 'me' }] } } }, f.store);
    expect(mine.query.where).toEqual({ field: 'openedBy', operator: 'isAnyOf', value: [{ relative: 'me' }] });
    const restricted = await createCommentView(f.principal(0), { name: 'Admin view', sharing: 'shared', query: { ...f.query, where: { field: 'browser', operator: 'isAnyOf', value: ['Chrome'] } } }, f.store);
    expect((await listCommentViews(principal, f.store)).map(view => view.id)).toEqual([mine.id]);
    await expect(getCommentView(principal, restricted.id, f.store)).rejects.toMatchObject({ status: 403 });
    await changeMember(f, 0, { role: 'commenter' });
    await expect(getCommentView(f.principal(0), restricted.id, f.store)).rejects.toMatchObject({ status: 403 });
    await expect(updateCommentView(f.principal(0), restricted.id, { name: 'Stale admin', version: restricted.version }, f.store)).rejects.toMatchObject({ status: 403 });
});

test('current project access and membership apply to saved views and copied links; expiry is checked before Cosmos TTL removal', async () => {
    const f = await fixture(), shared = await createCommentView(f.principal(0), { name: 'Shared', sharing: 'shared', query: f.query }, f.store);
    const link = await createCommentQueryLink(f.principal(0), { sharing: 'shared', query: f.query }, f.store);
    expect((Date.parse(link.expiresAt) - Date.parse(link.createdAt)) / 1000).toBe(COMMENT_QUERY_LINK_TTL_SECONDS);
    expect((await getCommentQueryLink(f.principal(1), link.id, f.store)).query).toEqual(f.query);
    const personal = await createCommentQueryLink(f.principal(1), { query: f.query }, f.store);
    await expect(getCommentQueryLink(f.principal(0), personal.id, f.store)).rejects.toMatchObject({ status: 404 });
    await changeMember(f, 1, { projects: [] });
    expect(await listCommentViews(f.principal(1), f.store)).toEqual([]);
    await expect(getCommentView(f.principal(1), shared.id, f.store)).rejects.toMatchObject({ status: 404 });
    await expect(getCommentQueryLink(f.principal(1), link.id, f.store)).rejects.toMatchObject({ status: 404 });
    const stored = (await f.store.get<DbCommentQueryLink>(f.workspace.pk, link.id))!;
    await f.store.replace({ ...stored.doc, expiresAt: new Date(Date.now() - 1000).toISOString() }, stored.etag);
    await expect(getCommentQueryLink(f.principal(0), link.id, f.store)).rejects.toMatchObject({ status: 404 });
    await f.store.delete(f.workspace.pk, f.members[2]!.id);
    await expect(listCommentViews(f.principal(2), f.store)).rejects.toMatchObject({ status: 404 });
});

test('a role or project revocation during a saved-view write invalidates the transaction and retry', async () => {
    for (const revoke of ['member', 'project'] as const) {
        const f = await fixture();
        let raced = false;
        const store: AppStore = { ...f.store, async transact(operations) {
            if (!raced) {
                raced = true;
                if (revoke === 'member') {
                    const workspace = (await f.store.get<DbWorkspace>(f.workspace.pk, f.workspace.id))!;
                    const member = (await f.store.get<DbMember>(f.workspace.pk, f.members[1]!.id))!;
                    expect(await f.store.transact([
                        { kind: 'replace', doc: { ...workspace.doc, accessRevision: 1 }, etag: workspace.etag },
                        { kind: 'replace', doc: { ...member.doc, projects: [] }, etag: member.etag }
                    ])).toBe(true);
                } else await f.store.delete(f.workspace.pk, f.projects[0]!.id);
            }
            return f.store.transact(operations);
        } };
        await expect(createCommentView(f.principal(1), { name: 'Raced', query: f.query }, store)).rejects.toMatchObject({ status: 404 });
        expect(await f.store.count<DbCommentView>({ type: 'comment-query-view', pk: f.workspace.pk })).toBe(0);
    }
});

test('concurrent creates cannot exceed the per-owner saved-view quota', async () => {
    const f = await fixture(), principal = f.principal(1), first = await createCommentView(principal, { name: 'Template', query: f.query }, f.store);
    const template = (await f.store.get<DbCommentView>(f.workspace.pk, first.id))!.doc;
    for (let i = 0; i < 98; i++) await f.store.create({ ...template, id: `seed_${i}` });
    const results = await Promise.allSettled([
        createCommentView(principal, { name: 'One', query: f.query }, f.store),
        createCommentView(principal, { name: 'Two', query: f.query }, f.store)
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await f.store.count({ type: 'comment-query-view', pk: f.workspace.pk, where: { ownerId: principal.userId } })).toBe(100);
});

test('review routes preserve CORS and verified writes and require a current member for saved definitions', async () => {
    const f = await fixture(), project = f.projects[0]!, principal = f.principal(1, project.id),
        token = signToken('review', { uid: principal.userId, pid: project.id }, 3600),
        params = { params: Promise.resolve({ projectId: project.id }) }, origin = 'https://review.example.test',
        endpoint = `https://uier.example.test/api/review/${project.id}/comment-views`;
    const list = reviewCommentViewHandler<{ projectId: string }>('list'), create = reviewCommentViewHandler<{ projectId: string }>('create');
    const guest = await list(new Request(endpoint, { headers: { origin } }), params);
    expect(guest.status).toBe(401);
    expect(guest.headers.get('cache-control')).toBe('no-store');
    expect(guest.headers.get('access-control-allow-origin')).toBe(origin);
    const badSite = await list(new Request(endpoint, { headers: { origin: 'https://attacker.example.test', authorization: `Bearer ${token}` } }), params);
    expect(badSite.status).toBe(403);
    expect(badSite.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await reviewPreflight('GET, POST, OPTIONS')(new Request(endpoint, { method: 'OPTIONS', headers: { origin } }), params);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('X-Uier-Verification');
    const headers = { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body = JSON.stringify({ name: 'Toolbar', query: f.query });
    const unverified = await create(new Request(endpoint, { method: 'POST', headers, body }), params);
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({ error: 'bot_detected' });
    const verification = signToken('review-verification', { projectId: project.id, origin, authorId: `user:${principal.userId}` }, 300);
    const created = await create(new Request(endpoint, { method: 'POST', headers: { ...headers, 'X-Uier-Verification': verification }, body }), params);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ view: { name: 'Toolbar', ownerId: principal.userId } });
    await changeMember(f, 1, { projects: [] });
    expect((await list(new Request(endpoint, { headers }), params)).status).toBe(401);
});

test('workspace routes reject cross-site cookie requests before session access', async () => {
    const handler = workspaceCommentViewHandler<{ workspaceId: string }>('list'),
        context = { params: Promise.resolve({ workspaceId: 'w_test' }) };
    const cases: Record<string, string>[] = [{ origin: 'https://attacker.example.test' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of cases) {
        const response = await handler(new Request('https://uier.example.test/api/workspaces/w_test/comment-views', { headers }), context);
        expect(response.status).toBe(403);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('vary')).toContain('Cookie');
    }
});
