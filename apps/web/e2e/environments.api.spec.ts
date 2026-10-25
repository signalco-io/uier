import { reattachReviewAnchor } from '../src/lib/review/anchorRoutes';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { environmentFilter, environmentOptions, environmentSelection, feedbackSource } from '../src/lib/app/environments';
import { getAppStore } from '../src/lib/app/store';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { memberReviewTarget } from '../src/lib/app/review';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { listReviewComments, reviewActivitySummary } from '../src/lib/review/readRoutes';
import type { DbComment } from '../src/lib/db/schema';
import { withThreadActivity } from '../src/lib/comments/activity';

const production = 'https://www.example.com';
const staging = 'https://staging.example.com';
const alias = 'https://example.com';
const removed = 'https://old-preview.example.com';
let previous: string | undefined;
test.beforeAll(() => { previous = process.env.UIER_LOCAL; process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous; });

function project(): DbProject {
    const id = randomBytes(6).toString('hex');
    return { type: 'project', id, pk: workspacePk(id), workspaceId: id, name: 'Environments', urls: [production, staging, alias],
        access: 'guests', status: 'active', createdBy: 'owner', createdAt: '', updatedAt: '',
        environments: [{ origin: production, label: 'Production' }, { origin: staging, label: 'Staging' }, { origin: alias, label: 'Production alias' }] };
}

function comment(project: DbProject, origin: string | undefined, id: string = randomUUID()): DbComment {
    return withThreadActivity({ id: `comment_${id}`, domain: `project:${project.id}`, projectId: project.id, origin,
        path: '/same?tab=details#/view', pageStateVersion: 1, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 },
        authorId: 'other', createdAt: '2026-10-25T10:00:00.000Z', thread: { items: [{ id: 'first', text: origin ?? 'Legacy', authorId: 'other' }] } }, 'other');
}

test('origins isolate identical page state by default; explicit alias groups and history never rewrite sources', async () => {
    const p = project();
    const store = getMemoryCommentsStore();
    for (const origin of [production, staging, alias, removed, undefined]) await store.create(comment(p, origin));
    const select = (origin: string) => environmentFilter(p, environmentSelection(p, undefined, origin));
    expect((await store.list(`project:${p.id}`, '/same?tab=details#/view', 10, select(production))).map(item => item.origin)).toEqual([production]);
    p.environments![0]!.group = 'Live'; p.environments![2]!.group = 'Live';
    expect(environmentOptions(p).map(item => item.id)).toEqual(['group:Live', `origin:${staging}`]);
    expect((await store.listAll(`project:${p.id}`, 10, select(alias))).map(item => item.origin)).toEqual([production, alias]);
    expect((await store.listAll(`project:${p.id}`, 10, environmentFilter(p, 'unknown'))).map(item => item.origin)).toEqual([undefined]);
    expect((await store.listAll(`project:${p.id}`, 10, environmentFilter(p, 'removed'))).map(item => item.origin)).toEqual([removed]);
    expect(await store.listAll(`project:${p.id}`, 10, environmentFilter(p, 'all'))).toHaveLength(5);
    expect(feedbackSource(p, undefined)).toEqual({ environment: 'unknown', label: 'Source not recorded', available: false });
    expect(feedbackSource(p, removed)).toMatchObject({ environment: 'removed', origin: removed, available: false });
    expect(feedbackSource(p, 'javascript:alert(1)').origin).toBeUndefined();
    expect(environmentSelection(p, 'origin:https://unconfigured.example', staging)).toBe(`origin:${staging}`);
});

test('origin filtering precedes storage result limits', async () => {
    const p = project(); const store = getMemoryCommentsStore();
    await store.create({ ...comment(p, production, 'older'), createdAt: '2020-01-01T00:00:00Z' });
    await store.create(comment(p, staging, 'newer'));
    const filter = environmentFilter(p, `origin:${production}`);
    expect((await store.listAll(`project:${p.id}`, 1, filter)).map(item => item.origin)).toEqual([production]);
    expect((await store.list(`project:${p.id}`, '/same?tab=details#/view', 1, filter)).map(item => item.origin)).toEqual([production]);
});

test('filtered lists and activity share visibility, source and unread rules', async () => {
    const p = project(); const store = getMemoryCommentsStore();
    const publicA = comment(p, production); const privateA = { ...comment(p, production), private: true }; const publicB = comment(p, staging);
    for (const item of [publicA, privateA, publicB]) await store.create(item);
    const actor = { kind: 'guest', visitorId: 'reader' } as const;
    const context = (environment: string) => ({ project: p, actor, siteOrigin: production,
        request: new Request(`https://uier.io/api/review/${p.id}/comments?scope=site&environment=${encodeURIComponent(environment)}`) });
    const a = await (await listReviewComments(context(`origin:${production}`))).json() as import('../src/lib/review/dto').ReviewCommentDto[];
    expect(a.map((item: { id: string }) => item.id)).toEqual([publicA.id]);
    expect(a[0]!.source).toEqual({ environment: `origin:${production}`, label: 'Production', origin: production, available: true });
    expect(a[0]).not.toHaveProperty('reproduction');
    expect(await (await reviewActivitySummary(context('all'))).json()).toMatchObject({ total: 2, unread: 2 });
    expect(await (await reviewActivitySummary(context(`origin:${staging}`))).json()).toMatchObject({ total: 1, unread: 1 });
    expect((await (await listReviewComments({ ...context('all'), request: new Request(`https://uier.io/api/review/${p.id}/comments?scope=site&unread=true&environment=all`) })).json())).toHaveLength(2);
});

test('member direct links use the stored permitted origin and safe saved state, then fail honestly after removal', async () => {
    const p = project(); const store = getMemoryCommentsStore(); const app = getAppStore();
    await app.create(p);
    await app.create<DbProjectRef>({ type: 'project-ref', id: p.id, pk: projectRefPk(p.id), workspaceId: p.workspaceId });
    const member: DbMember = { type: 'member', id: memberId('owner'), pk: p.pk, workspaceId: p.workspaceId, userId: 'owner', email: 'owner@example.com', role: 'admin', projects: 'all', createdAt: '' };
    await app.create(member);
    const item = comment(p, staging); await store.create(item);
    const target = new URL((await memberReviewTarget('owner', p.id, `${production}/wrong`, item.id))!);
    expect(target.origin).toBe(staging);
    expect(target.pathname).toBe('/same'); expect(target.searchParams.get('tab')).toBe('details'); expect(target.hash).toBe('#/view');
    expect(target.searchParams.get('uier-comment')).toBe(item.id);
    expect(await memberReviewTarget('outsider', p.id, null, item.id)).toBeNull();
    await app.replace({ ...p, urls: [production] }, (await app.get<DbProject>(p.pk, p.id))!.etag);
    expect(await memberReviewTarget('owner', p.id, `${production}/wrong`, item.id)).toBeNull();
    expect((await store.get(item.domain, item.id))!.comment.origin).toBe(staging);
});


test('reattachment responses retain the original source and grouped aliases cannot change its origin', async () => {
    const p = project(); p.pageState = { queryParameters: ['tab'], hashRouting: true };
    p.environments![0]!.group = 'Shared'; p.environments![1]!.group = 'Shared';
    const item = comment(p, staging); const store = getMemoryCommentsStore(); await store.create(item);
    const request = (expectedRevision: string | null) => new Request(`https://uier.io/api/review/${p.id}/comments/${item.id}/anchor`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.path,
            expectedRevision, position: { type: 'point', selector: 'h2', xNormal: 0.5, yNormal: 0.5 } })
    });
    const context = { project: p, actor: { kind: 'guest', visitorId: 'other' } as const, siteOrigin: staging, request: request(null) };
    const updated = await (await reattachReviewAnchor(context, { id: item.id })).json() as import('../src/lib/review/dto').ReviewCommentDto;
    expect(updated.source).toMatchObject({ origin: staging, available: true, environment: 'group:Shared' });
    expect((await store.get(item.domain, item.id))!.comment.origin).toBe(staging);
    await expect(reattachReviewAnchor({ ...context, siteOrigin: production, request: request(updated.anchorContext!.revision) }, { id: item.id }))
        .rejects.toMatchObject({ code: 'forbidden' });
});


test('same-origin reads and activity use the actual origin even when it is not the main address', async () => {
    const p = project(); const own = 'https://uier.io'; p.urls.push(own);
    const store = getMemoryCommentsStore();
    await store.create(comment(p, production)); await store.create(comment(p, own));
    const actor = { kind: 'guest', visitorId: 'same-origin-reviewer' } as const;
    const read = { project: p, actor, request: new Request(`https://uier.io/api/review/${p.id}/comments?scope=site`) };
    const list = await (await listReviewComments(read)).json() as import('../src/lib/review/dto').ReviewCommentDto[];
    expect(list).toHaveLength(1); expect(list[0]!.source?.origin).toBe(own);
    expect(await (await reviewActivitySummary(read)).json()).toMatchObject({ total: 1 });
});
