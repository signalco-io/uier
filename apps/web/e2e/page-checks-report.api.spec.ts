import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

// One comment for several elements of a page check (the panels' "Comment on all",
// packages/toolbar/docs/page-checks-report.md): `check.count` on POST /api/comments against
// `next start` with the in-memory store. Every request context is an anonymous visitor of its own.

const position = { type: 'point', selector: 'body>main>h1', xNormal: 0.5, yNormal: 0.5 };

type Comment = { id: string; check?: unknown };

async function createComment(visitor: APIRequestContext, path: string, check: unknown) {
    return await visitor.post('/api/comments', { data: { path, position, text: 'Accessibility (serious): Targets are too small.', check } });
}

async function created(response: APIResponse) {
    expect(response.status(), await response.text()).toBe(201);
    return await response.json() as Comment;
}

test('a comment for several elements of a check keeps how many, and other counts are refused', async ({ playwright, baseURL }) => {
    const visitor = await playwright.request.newContext({ baseURL });
    try {
        const path = `/e2e/${randomUUID()}`;
        const check = { type: 'accessibility', id: 'target-size', count: 5 };
        const comment = await created(await createComment(visitor, path, check));
        expect(comment.check).toEqual(check);
        const listed = await (await visitor.get('/api/comments', { params: { path } })).json() as Comment[];
        expect(listed.find(item => item.id === comment.id)?.check).toEqual(check);

        // The packet names it for whoever fixes it
        const packet = await (await visitor.get(`/api/comments/${comment.id}/context`)).json();
        expect(packet.context.check).toEqual(check);
        expect(packet.markdown).toContain('Page check: Accessibility (` target-size `) · 5 elements');

        // A check without a count (one element, an older toolbar) is as before
        const single = await created(await createComment(visitor, path, { type: 'seo', id: 'alt' }));
        expect(single.check).toEqual({ type: 'seo', id: 'alt' });
        const singlePacket = await (await visitor.get(`/api/comments/${single.id}/context`)).json();
        expect(singlePacket.markdown).toContain('Page check: SEO (` alt `)\n');

        // Bounded: a whole number of elements from 2 to 10,000
        expect((await created(await createComment(visitor, path, { type: 'seo', id: 'alt', count: 10_000 }))).check).toEqual({ type: 'seo', id: 'alt', count: 10_000 });
        for (const count of [1, 0, -2, 10_001, 2.5, '3', null, true, { value: 3 }]) {
            const response = await createComment(visitor, path, { type: 'seo', id: 'alt', count });
            expect(response.status(), `count ${JSON.stringify(count)}`).toBe(400);
            expect((await response.json()).error).toBe('invalid_request');
        }
        // Nothing else beside it
        const extra = await createComment(visitor, path, { type: 'seo', id: 'alt', count: 3, elements: ['img'] });
        expect(extra.status()).toBe(400);
    } finally {
        await visitor.dispose();
    }
});
