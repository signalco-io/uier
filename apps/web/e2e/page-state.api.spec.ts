import { expect, test } from '@playwright/test';
import { pageQueryKeys, pagePath, pageStatePolicy, sourcePagePath, storedPagePath, storedSourcePath } from '../../../packages/toolbar/src/pageState';
import { queryFieldSuggestions } from '../src/lib/app/pageStateSuggestions';
import { projectPageStateSchema } from '../src/lib/app/projects';
import { newSourcePath, toCommentDto } from '../src/lib/comments/dto';
import { toReproductionContext } from '../src/lib/comments/reproduction';
import type { DbComment } from '../src/lib/db/schema';
import { randomBytes, randomUUID } from 'node:crypto';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { persistProjectAccess } from './support/projectAccess';
import { createReviewComment } from '../src/lib/review/routes';
import { listReviewComments } from '../src/lib/review/readRoutes';
import { memberReviewTarget } from '../src/lib/app/review';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { projectRefPk, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import type { ReviewCommentDto } from '../src/lib/review/dto';

const policy = { queryParameters: ['tab', 'category'], hashRouting: true };
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });

test('page identity normalizes selected state and preserves working hash-route prefixes', () => {
    const first = pagePath('/search/?tab=details&category=caf%C3%A9&category=a&category=a&utm_source=email&uier-token=secret#/items/?tab=reviews', policy);
    expect(first).toBe('/search?category=a&category=caf%C3%A9&tab=details#/items?tab=reviews');
    expect(pagePath('/search?category=caf%C3%A9&category=a&tab=details#/items?tab=reviews', policy)).toBe(first);
    expect(pagePath('/search?category=a#!/items/?tab=reviews', policy)).toBe('/search?category=a#!/items?tab=reviews');
    expect(pagePath('/search?category=a#section', policy)).toBe('/search?category=a');
    expect(pagePath('/search/?category=a#/items')).toBe('/search');
    expect(pagePath('/path?tab=user%40example.com', policy)).toBe('/path');
    expect(pagePath(`/path?tab=${'a'.repeat(48)}`, policy)).toBe('/path');
    expect(pagePath('/path?tab=https%3A%2F%2Fsecret.example', policy)).toBe('/path');
    expect(pagePath('/path#/token/private-value', policy)).toBe('/path');
    expect(pagePath('/path#/users/user%40example.com', policy)).toBe('/path');
    for (const input of ['//evil.example', '/\\evil.example', '/path#//evil.example'])
        expect(pagePath(input, policy)).not.toContain('evil.example');
});

test('projects cannot allowlist tracking, activation, identity or credential fields', () => {
    for (const key of ['utm_source', 'fbclid', 'gclid', 'toolbar-code', 'review', 'uier-comment', 'uier-token', 'uier-check', 'token', 'sessionId', 'email', 'api_key', 'code', 'key', 'state', 'uid', 'username']) {
        expect(projectPageStateSchema.safeParse({ queryParameters: [key], hashRouting: false }).success).toBe(false);
        expect(pageStatePolicy({ queryParameters: [key, 'tab'], hashRouting: false }).queryParameters).toEqual(['tab']);
    }
});

test('old comments keep path-only links; v1 DTOs and reproduction links retain only safe stored state', () => {
    const comment: DbComment = { id: 'comment_view', domain: 'project:test', origin: 'https://reviewed.example', path: '/search?category=a&token=secret#/items?tab=reviews',
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'A view' }] } };
    expect(storedPagePath(comment.path)).toBe('/search');
    expect(toCommentDto(comment, undefined)?.path).toBe('/search');
    comment.pageStateVersion = 1;
    expect(toCommentDto(comment, undefined)?.path).toBe('/search?category=a#/items?tab=reviews');
    const reproduction = toReproductionContext(comment, ['https://reviewed.example']);
    expect(reproduction.url).toBe('https://reviewed.example/search?category=a#/items?tab=reviews');
    expect(reproduction.text).not.toContain('secret');
});

test('page queries separate v1 views and retain the legacy query-string fallback only for base pages', async () => {
    const store = getMemoryCommentsStore();
    const base: DbComment = { id: 'old', domain: `views-${randomUUID()}`, path: '/search?old-tracking=yes', position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Old comment' }] } };
    await store.create(base);
    await store.create({ ...base, id: 'a', path: '/search?category=a', pageStateVersion: 1 });
    await store.create({ ...base, id: 'b', path: '/search?category=b', pageStateVersion: 1 });
    expect((await store.list(base.domain, '/search', 20)).map(comment => comment.id)).toEqual(['old']);
    expect((await store.list(base.domain, '/search?category=a', 20)).map(comment => comment.id)).toEqual(['a']);
    expect((await store.list(base.domain, '/search?category=b', 20)).map(comment => comment.id)).toEqual(['b']);
});

test('settings suggest unapproved query field names from recent comments, never values or sensitive names', () => {
    expect(pageQueryKeys('/search?sort=new&tab=a&utm_source=mail&token=x&next=https%3A%2F%2Fevil.example#/items?view=grid')).toEqual(['sort', 'tab', 'view']);
    expect(pageQueryKeys('/search?filter=user%40example.com&page=')).toEqual(['page']);
    expect(pageQueryKeys('/search?sort=a#section?ignored=1')).toEqual(['sort']);
    const suggestions = queryFieldSuggestions([
        { path: '/search', queryKeys: ['sort', 'view'] },
        { path: '/search?category=a', queryKeys: ['sort', 'email'] },
        { path: '/old?sort=b&page=2' }
    ], policy);
    expect(suggestions).toEqual([{ key: 'sort', comments: 3 }, { key: 'page', comments: 1 }, { key: 'view', comments: 1 }]);
    const comment: DbComment = { id: 'comment_keys', domain: 'project:test', path: '/search', pageStateVersion: 1, queryKeys: ['sort'],
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'A view' }] } };
    expect(JSON.stringify(toCommentDto(comment, undefined))).not.toContain('queryKeys');
});

test('source paths keep trailing slashes with exactly the page key\'s filtering', () => {
    const input = '/search//?tab=details&utm_source=email&uier-token=secret&token=x#/items/?tab=reviews';
    const source = sourcePagePath(input, policy);
    expect(source).toBe('/search/?tab=details#/items/?tab=reviews');
    expect(pagePath(source, policy)).toBe(pagePath(input, policy));
    expect(sourcePagePath('/plans/')).toBe('/plans/');
    expect(sourcePagePath('/plans')).toBe('/plans');
    expect(sourcePagePath('/')).toBe('/');
    for (const unsafe of ['//evil.example/', '/\\evil.example/', '/path/#//evil.example/'])
        expect(sourcePagePath(unsafe, policy)).not.toContain('evil.example');
    expect(newSourcePath('/plans', '/plans/')).toBe('/plans/');
    expect(newSourcePath('/plans', '/plans')).toBeUndefined();
    expect(newSourcePath('/plans', '/pricing/')).toBeUndefined();
    expect(newSourcePath('/plans', undefined)).toBeUndefined();
    expect(newSourcePath('/plans?tab=a', '/plans/?tab=a&token=secret', policy)).toBe('/plans/?tab=a');
    // Read side: a stored source path can only add slashes to its key
    expect(storedSourcePath('/plans', '/plans/')).toBe('/plans/');
    expect(storedSourcePath('/plans', undefined)).toBe('/plans');
    expect(storedSourcePath('/plans', 42)).toBe('/plans');
    expect(storedSourcePath('/plans', '/pricing/')).toBe('/plans');
    expect(storedSourcePath('/plans', '/plans/?tab=a')).toBe('/plans');
    expect(storedSourcePath('/plans', '//evil.example/plans/')).toBe('/plans');
    expect(storedSourcePath('/plans', '/plans/?token=secret')).toBe('/plans/');
});

test('DTOs and reproduction links use a valid stored source path; old and tampered documents keep the key', () => {
    const comment: DbComment = { id: 'comment_slash', domain: 'project:test', origin: 'https://reviewed.example', path: '/plans?tab=a', pageStateVersion: 1,
        position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Plans' }] } };
    expect(toCommentDto(comment, undefined)).not.toHaveProperty('sourcePath');
    expect(toReproductionContext(comment, ['https://reviewed.example']).url).toBe('https://reviewed.example/plans?tab=a');
    comment.sourcePath = '/plans/?tab=a';
    expect(toCommentDto(comment, undefined)).toMatchObject({ path: '/plans?tab=a', sourcePath: '/plans/?tab=a' });
    expect(toReproductionContext(comment, ['https://reviewed.example']).url).toBe('https://reviewed.example/plans/?tab=a');
    for (const tampered of ['/other/', '//evil.example/plans/', 'https://evil.example/plans/', '/plans/?tab=b']) {
        comment.sourcePath = tampered;
        expect(toCommentDto(comment, undefined)).not.toHaveProperty('sourcePath');
        expect(toReproductionContext(comment, ['https://reviewed.example']).url).toBe('https://reviewed.example/plans?tab=a');
    }
});

test('public comments store a validated source path and group with the page key', async ({ request }) => {
    const base = `/slash-${randomUUID()}`;
    for (const sourcePath of ['//evil.example/', 'https://evil.example/', `${base}\\x/`, 'relative/', `/${'a'.repeat(2049)}`]) {
        const refused = await request.post('/api/comments', { data: { path: `${base}/`, sourcePath, kind: 'feedback', position: { type: 'page' }, text: 'Invalid source' } });
        expect(refused.status(), sourcePath).toBe(400);
    }
    const created = await request.post('/api/comments', { data: { path: `${base}/`, sourcePath: `${base}/?token=secret`, kind: 'feedback', position: { type: 'page' }, text: 'Slash page' } });
    expect(created.status()).toBe(201);
    const saved = await created.json();
    expect(saved).toMatchObject({ path: base, sourcePath: `${base}/` });
    expect(JSON.stringify(saved)).not.toContain('secret');
    const other = await (await request.post('/api/comments', { data: { path: base, sourcePath: '/elsewhere/', kind: 'feedback', position: { type: 'page' }, text: 'Other page' } })).json();
    expect(other.path).toBe(base);
    expect(other).not.toHaveProperty('sourcePath');
    const old = await (await request.post('/api/comments', { data: { path: base, kind: 'feedback', position: { type: 'page' }, text: 'Older toolbar' } })).json();
    expect(old).not.toHaveProperty('sourcePath');
    const listed = await (await request.get(`/api/comments?path=${encodeURIComponent(`${base}/`)}`)).json() as { id: string; sourcePath?: string }[];
    expect(listed.map(item => item.id).sort()).toEqual([saved.id, other.id, old.id].sort());
    const context = await (await request.get(`/api/comments/${saved.id}/context`)).json();
    expect(new URL(context.context.links.page).pathname).toBe(`${base}/`);
    expect(new URL(context.context.links.comment).pathname).toBe(`${base}/`);
});

test('project comments keep the source path on the authorized origin for lists, Copy issue and app links', async () => {
    const staging = 'https://staging.example';
    const project = { id: randomBytes(6).toString('hex'), urls: ['https://reviewed.example', staging], pageState: { queryParameters: ['tab'], hashRouting: false } } as DbProject;
    await persistProjectAccess(project, [{ userId: 'owner', name: 'Owner', isAdmin: true }]);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id: project.id, pk: projectRefPk(project.id), workspaceId: project.workspaceId });
    const actor = { kind: 'guest', visitorId: `slash-${randomUUID()}` } as const;
    const create = (body: object, siteOrigin = staging) => createReviewComment({ project, actor, siteOrigin, request: new Request(`https://uier.io/api/review/${project.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'feedback', position: { type: 'page' }, text: 'Plans', authorName: 'Guest', ...body })
    }) });
    await expect(create({ path: '/plans/', sourcePath: '//evil.example/plans/' })).rejects.toMatchObject({ code: 'invalid_request' });
    const saved = await (await create({ path: '/plans?tab=yearly&token=secret', sourcePath: '/plans/?tab=yearly&token=secret&utm_source=mail' })).json() as ReviewCommentDto;
    expect(saved).toMatchObject({ path: '/plans?tab=yearly', sourcePath: '/plans/?tab=yearly', source: { origin: staging, available: true } });
    const stored = (await getMemoryCommentsStore().get(`project:${project.id}`, saved.id))!.comment;
    expect(stored).toMatchObject({ path: '/plans?tab=yearly', sourcePath: '/plans/?tab=yearly', origin: staging });
    expect(JSON.stringify(stored)).not.toMatch(/secret|utm_source/);
    // A source path for another page view is ignored: links use the page key
    const mismatched = await (await create({ path: '/plans?tab=yearly', sourcePath: '/plans/?tab=monthly' })).json() as ReviewCommentDto;
    expect(mismatched).not.toHaveProperty('sourcePath');
    const listed = await (await listReviewComments({ project, actor, siteOrigin: staging,
        request: new Request(`https://uier.io/api/review/${project.id}/comments?path=${encodeURIComponent('/plans?tab=yearly')}`) })).json() as ReviewCommentDto[];
    expect(listed.map(item => [item.id, item.sourcePath])).toEqual(expect.arrayContaining([[saved.id, '/plans/?tab=yearly'], [mismatched.id, undefined]]));
    const exported = await projectFeedbackExport(project, actor, saved.id, staging, 'https://uier.io');
    expect(exported.context.links.page).toBe(`${staging}/plans/?tab=yearly`);
    expect(await projectFeedbackExport(project, actor, saved.id, 'https://reviewed.example', 'https://uier.io')).toMatchObject({ context: { links: { page: undefined } } });
    const target = new URL((await memberReviewTarget('owner', project.id, 'https://reviewed.example/wrong', saved.id))!);
    expect(`${target.origin}${target.pathname}`).toBe(`${staging}/plans/`);
    expect(target.searchParams.get('tab')).toBe('yearly');
    expect(await memberReviewTarget('outsider', project.id, null, saved.id)).toBeNull();
});
