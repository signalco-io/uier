import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { commentCheck } from '@uier/toolbar/feedback-types';
import { resolveToolbarFeatures } from '@uier/toolbar/toolbar-features';
import { toolbarFeatureVisibilitySchema } from '../src/lib/app/toolbarFeatures';

test('consent comments preserve their check and packet label, without accepting extra inventory fields', async ({ playwright, baseURL }) => {
    const visitor = await playwright.request.newContext({ baseURL });
    try {
        const path = `/e2e/${randomUUID()}`;
        const check = { type: 'consent', id: 'consent-storage-name' };
        const data = { path, position: { type: 'page' }, kind: 'feedback', text: 'Consent and cookies: Review the cookie name `_ga`. Timing unknown.', check };
        const response = await visitor.post('/api/comments', { data });
        expect(response.status(), await response.text()).toBe(201);
        const comment = await response.json();
        expect(comment.check).toEqual(check);
        const packet = await (await visitor.get(`/api/comments/${comment.id}/context`)).json();
        expect(packet.context.check).toEqual(check);
        expect(packet.markdown).toContain('Page check: Consent and cookies (` consent-storage-name `)');
        expect(commentCheck(check)).toEqual(check);
        const extra = await visitor.post('/api/comments', { data: { ...data, check: { ...check, cookieValue: 'not-accepted' } } });
        expect(extra.status()).toBe(400);
    } finally { await visitor.dispose(); }
});

test('consent is independently configurable and explicit older feature lists keep it hidden', () => {
    expect(toolbarFeatureVisibilitySchema.parse({ enabled: ['consent'], signedOut: ['consent'] })).toEqual({ enabled: ['consent'], signedOut: ['consent'] });
    expect(resolveToolbarFeatures(undefined, true)).toContain('consent');
    expect(resolveToolbarFeatures({ enabled: ['seo'] }, true)).not.toContain('consent');
    expect(resolveToolbarFeatures({ enabled: ['consent'], signedOut: [] }, false)).toEqual([]);
    expect(resolveToolbarFeatures({ enabled: ['consent'], signedOut: [] }, true)).toEqual(['consent']);
});
