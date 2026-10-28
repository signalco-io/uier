import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import type { DbComment } from '../src/lib/db/schema';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { PUBLIC_PROJECT_ID } from '../src/lib/comments/publicProject';
import { pngImage } from './support/images';

test('public exports preserve exact saved element/text/page/rewrite feedback and discussion without private metadata', async ({ request }) => {
    const text = 'Please keep *this* exact.\n```\n[link](https://example.com)\n````';
    const positions = [
        { type: 'point', selector: '#hero', xNormal: 0.5, yNormal: 0.3 },
        { type: 'text', text: 'Original\nselected copy', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 12, endType: 'text' },
        { type: 'page' },
        { type: 'text', text: 'Old headline', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 12, endType: 'text' }
    ];
    for (const [index, position] of positions.entries()) {
        const response = await request.post('/api/comments', { data: {
            path: `/packet-${randomUUID()}`, position, text, kind: index === 3 ? 'rewrite' : index === 2 ? 'bug' : 'comment',
            ...(index === 3 ? { quotedText: 'Old headline' } : {}), ...(index === 0 ? { screenshot: pngImage } : {}),
            device: { size: 'desktop', windowSize: [1280, 720], browser: 'Private browser', os: 'Private OS', pixelRatio: 2, capturedAt: '2026-10-25T10:00:00.000Z' }
        } });
        expect(response.status()).toBe(201);
        const saved = await response.json();
        await request.post(`/api/comments/${saved.id}/replies`, { data: { text: 'Discussion\n*kept*' } });
        const exported = await request.get(`/api/comments/${saved.id}/context?uier-token=do-not-export&token=secret`);
        expect(exported.status()).toBe(200);
        expect(exported.headers()['cache-control']).toContain('no-store');
        const packet = await exported.json();
        expect(packet).toEqual(await (await request.get(`/api/comments/${saved.id}/context`)).json());
        expect(packet.context.identity).toMatchObject({ projectId: PUBLIC_PROJECT_ID, commentId: saved.id, itemId: saved.thread.items[0].id });
        expect(packet.markdown).toContain(`Project: ${PUBLIC_PROJECT_ID}`);
        expect(packet.context.feedback.text).toBe(saved.thread.items[0].text);
        expect(packet.context.discussion[0].text).toBe('Discussion\n*kept*');
        expect(packet.markdown).toContain(`\n${text}\n`);
        expect(packet.markdown).toContain('`````text');
        expect(packet.context.reproduction).toEqual({ device: 'desktop', windowSize: [1280, 720] });
        expect(JSON.stringify(packet)).not.toMatch(/Private browser|Private OS|capturedAt|pixelRatio|do-not-export|secret|authorId|isMe|ttl/);
        expect(packet.markdown).toBe(feedbackMarkdown(packet.context));
        if (index === 3) {
            expect(packet.context.feedback.quotedText).toBe('Old headline');
            expect(packet.markdown).toContain('Suggested rewrite (not original page copy)');
            expect(packet.markdown).toContain('Quoted original text:');
        }
        if (index === 0) {
            expect(packet.context.screenshot.state).toBe('protected');
            expect(packet.markdown).toContain('Private images cannot be viewed outside uier');
            expect((await request.get(packet.context.screenshot.url)).status()).toBe(200);
            expect(packet.markdown).not.toContain('data:image');
        } else expect(packet.context.screenshot.state).toBe('unavailable');
    }
});

test('isolated local feedback does not claim to belong to the uier project', async ({ playwright, baseURL }) => {
    const visitor = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Host: `packet-${randomUUID()}.localhost` } });
    try {
        const response = await visitor.post('/api/comments', { data: { path: '/', kind: 'feedback', position: { type: 'page' }, text: 'Local feedback' } });
        expect(response.status(), await response.text()).toBe(201);
        const saved = await response.json();
        const packet = await (await visitor.get(`/api/comments/${saved.id}/context`)).json();
        expect(packet.context.identity).not.toHaveProperty('projectId');
        expect(packet.markdown).not.toContain('Project:');
    } finally { await visitor.dispose(); }
});

test('deleted first messages omit old quote/anchor/device/image and missing threads fail freshly', async ({ request, playwright, baseURL }) => {
    const created = await request.post('/api/comments', { data: {
        path: `/deleted-${randomUUID()}`, position: { type: 'text', text: 'Secret old quote', startSelector: 'h1', startOffset: 0, startType: 'text', endOffset: 6, endType: 'text' },
        text: 'Removed text', quotedText: 'Removed quotation', screenshot: pngImage, device: { windowSize: [1280, 720] }
    } });
    const saved = await created.json();
    const stranger = await playwright.request.newContext({ baseURL });
    try {
        await stranger.post(`/api/comments/${saved.id}/replies`, { data: { text: 'Retained reply' } });
        await request.delete(`/api/comments/${saved.id}`);
        const packet = await (await request.get(`/api/comments/${saved.id}/context`)).json();
        expect(packet.context.feedback.deleted).toBe(true);
        expect(packet.context.anchor).toEqual({ type: 'text' });
        expect(packet.context.reproduction).toEqual({});
        expect(packet.context.screenshot.state).toBe('unavailable');
        expect(JSON.stringify(packet)).not.toMatch(/Removed text|Removed quotation|Secret old quote|1280/);
        expect(packet.context.discussion[0].text).toBe('Retained reply');
    } finally { await stranger.dispose(); }
    expect((await request.get('/api/comments/comment_missing/context')).status()).toBe(404);
    expect((await request.get('/api/comments/%24sequence_comments/context')).status()).toBe(404);
});

test('project export enforces private visibility, original allowed source and member-only browser context', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const origin = 'https://preview.example';
        const otherOrigin = 'https://production.example';
        const project = { id: `packet-${randomUUID()}`, urls: [otherOrigin, origin], environments: [{ origin, label: 'Preview' }] } as DbProject;
        const store = getMemoryCommentsStore();
        const comment: DbComment = {
            id: 'comment_packet', domain: `project:${project.id}`, origin, path: '/pricing?plan=team&token=secret&uier-token=proof#/details?plan=team&auth=hidden', pageStateVersion: 1,
            position: { type: 'point', selector: '#price', xNormal: 0.5, yNormal: 0.5 }, private: true, authorId: 'guest-owner',
            device: { browser: 'Original Browser', os: 'Original OS', windowSize: [800, 600], pixelRatio: 2, capturedAt: '2026-10-25T10:00:00.000Z' },
            screenshot: { contentType: 'image/png', width: 3, height: 2, bytes: 100 },
            thread: { items: [{ id: 'item_first', text: 'Saved feedback', authorId: 'guest-owner', authorName: 'Reviewer' }] }
        };
        await store.create(comment);
        const admin = { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true } as const;
        const guest = { kind: 'guest', visitorId: 'guest-owner' } as const;
        const base = 'https://uier.example';
        for (const actor of [{ kind: 'guest', visitorId: 'stranger' } as const, { ...admin, isAdmin: false }])
            await expect(projectFeedbackExport(project, actor, comment.id, origin, base)).rejects.toMatchObject({ code: 'not_found' });
        const memberPacket = await projectFeedbackExport(project, admin, comment.id, undefined, base);
        expect(memberPacket.context.reproduction).toMatchObject({ browser: 'Original Browser', os: 'Original OS', windowSize: [800, 600], pixelRatio: 2 });
        expect(memberPacket.context.links.page).toBe(`${origin}/pricing?plan=team#/details?plan=team`);
        expect(memberPacket.context.links.comment).toContain('/app/review/');
        expect(memberPacket.context.source.environment).toBe('Preview');
        expect(JSON.stringify(memberPacket)).not.toMatch(/secret|proof|hidden|uier-token|authorId|guest-owner/);
        // Metadata exists but the actual image is gone: report unavailable, never a broken promise.
        expect(memberPacket.context.screenshot.state).toBe('unavailable');
        const guestPacket = await projectFeedbackExport(project, guest, comment.id, origin, base);
        expect(guestPacket.context.reproduction).toEqual({ windowSize: [800, 600] });
        expect(guestPacket.context.source.environment).toBe('Preview');
        expect(guestPacket.context.links.comment).toContain(`${origin}/pricing?plan=team&review=true&uier-comment=comment_packet`);
        expect(JSON.stringify(guestPacket)).not.toMatch(/Original Browser|Original OS|pixelRatio|capturedAt/);
        expect((await projectFeedbackExport(project, guest, comment.id, otherOrigin, base)).context.links).toEqual({ page: undefined, comment: undefined });
        const removed = await projectFeedbackExport({ ...project, urls: [otherOrigin] }, admin, comment.id, undefined, base);
        expect(removed.context.links.page).toBeUndefined();
        expect(removed.context.links.comment).toBeUndefined();
        expect(removed.context.source.origin).toBeUndefined();
        expect(removed.context.source.environment).toBe('Removed address');
        expect((await projectFeedbackExport(project, guest, comment.id, otherOrigin, base)).context.source.environment).toBeUndefined();
        await expect(projectFeedbackExport(project, admin, 'comment_missing', undefined, base)).rejects.toMatchObject({ code: 'not_found' });
        await expect(projectFeedbackExport({ ...project, id: 'another-project' }, admin, comment.id, undefined, base)).rejects.toMatchObject({ code: 'not_found' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});

test('assignment export resolves a current project member name without exposing its account identity', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const id = randomUUID(); const workspaceId = `workspace-${id}`; const assigneeId = `u_${id}`;
        const app = getAppStore(); const comments = getMemoryCommentsStore();
        const project = { id, workspaceId, pk: workspacePk(workspaceId), urls: ['https://review.example'] } as DbProject;
        await app.create<DbUser>({ type: 'user', pk: userPk(assigneeId), id: assigneeId, email: `${id}@example.com`,
            name: 'Reviewer *name*', createdAt: '2026-10-28', updatedAt: '2026-10-28' });
        await app.create<DbMember>({ type: 'member', pk: project.pk, id: memberId(assigneeId), workspaceId,
            userId: assigneeId, email: `${id}@example.com`, role: 'commenter', projects: [id], createdAt: '2026-10-28' });
        const source: DbComment = { id: `comment_${id}`, domain: `project:${id}`, projectId: id, origin: project.urls[0], path: '/',
            assigneeId, authorId: 'guest', kind: 'feedback', position: { type: 'page' },
            thread: { items: [{ id: 'item_first', text: 'Feedback', authorId: 'guest', authorName: 'Guest' }] } };
        await comments.create(source);
        const actor = { kind: 'member', userId: 'admin', name: 'Admin', isAdmin: true } as const;
        const exported = await projectFeedbackExport(project, actor, source.id, undefined, 'https://uier.io');
        expect(exported.context.assignee).toEqual({ name: 'Reviewer *name*' });
        expect(exported.markdown).toContain('Assignee: Reviewer \\*name\\*');
        expect(JSON.stringify(exported)).not.toContain(assigneeId);
        const guest = await projectFeedbackExport(project, { kind: 'guest', visitorId: 'guest' }, source.id, project.urls[0], 'https://uier.io');
        expect(guest.context).not.toHaveProperty('assignee');
        await updateDoc<DbMember>(project.pk, memberId(assigneeId), current => ({ ...current, projects: [] }));
        expect((await projectFeedbackExport(project, actor, source.id, undefined, 'https://uier.io')).context.assignee)
            .toEqual({ name: 'Former member' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});
