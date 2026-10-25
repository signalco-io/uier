import { expect, test } from '@playwright/test';
import { pagePath, pageStatePolicy, storedPagePath } from '../../../packages/toolbar/src/pageState';
import { projectPageStateSchema } from '../src/lib/app/projects';
import { toCommentDto } from '../src/lib/comments/dto';
import { toReproductionContext } from '../src/lib/comments/reproduction';
import type { DbComment } from '../src/lib/db/schema';
import { randomUUID } from 'node:crypto';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';

const policy = { queryParameters: ['tab', 'category'], hashRouting: true };

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
