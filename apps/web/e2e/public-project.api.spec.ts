import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { HEADLINE_COMMENT_ID, PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION, PUBLIC_WORKSPACE_ID, provisionPublicProject, joinPublicProject } from '../src/lib/comments/publicProject';
import { memberId, userPk, workspacePk, type DbMember, type DbUser } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';

test('public project provisioning is concurrent, permanent and preserves existing feedback and replies', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const app = getAppStore();
        const store = getMemoryCommentsStore();
        // Model an existing installation before this migration, even if another spec in this
        // worker already provisioned the project through account creation.
        await app.delete(workspacePk(PUBLIC_WORKSPACE_ID), 'public-feedback-members-v1');
        const existingUser: DbUser = {
            id: `u_${randomUUID()}`, pk: userPk(''), type: 'user', email: 'existing@example.com',
            name: 'Existing user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        existingUser.pk = userPk(existingUser.id);
        await app.create(existingUser);
        const legacyDomain = `legacy-${randomUUID()}.localhost`;
        const legacy: DbComment = {
            id: `comment_${randomUUID()}`, domain: legacyDomain, path: '/brand',
            number: 15, position: { type: 'page' }, resolved: true, ttl: 777,
            thread: { items: [{ id: 'item_legacy', text: 'Existing public feedback' }] }
        };
        await store.create(legacy);
        const projects = await Promise.all(Array.from({ length: 3 }, () => provisionPublicProject(app, store, legacyDomain)));
        expect(projects.every(project => project.id === PUBLIC_PROJECT_ID && project.access === 'guests')).toBe(true);
        expect((await app.get(projects[0]!.pk, PUBLIC_PROJECT_ID))?.doc).toMatchObject({ type: 'project', ttl: -1 });
        expect((await app.get(workspacePk(PUBLIC_WORKSPACE_ID), memberId(existingUser.id)))?.doc)
            .toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID], userId: existingUser.id, ttl: -1 });
        expect(await store.listAll(PUBLIC_PROJECT_PARTITION, 100)).toHaveLength(3);
        expect((await store.get(PUBLIC_PROJECT_PARTITION, legacy.id))?.comment).toMatchObject({ ttl: 777, resolved: true });
        expect((await store.get(legacyDomain, legacy.id))?.comment).toEqual(legacy);

        const headline = (await store.get(PUBLIC_PROJECT_PARTITION, HEADLINE_COMMENT_ID))!.comment;
        expect(headline).toMatchObject({ ttl: -1, resolved: false, position: { startSelector: '#hero-comment-anchor' } });
        expect(headline.thread.items).toHaveLength(2);
        expect(headline.authorId).toBeUndefined();
        const reply = { id: 'item_visitor_reply', text: 'A real reply', authorId: 'visitor' };
        await store.appendThreadItem(headline.domain, headline.id, reply, 50, new Date().toISOString());
        await provisionPublicProject(app, store, legacyDomain);
        const after = (await store.get(headline.domain, headline.id))!.comment;
        expect(after.ttl).toBe(-1);
        expect(after.number).toBe(headline.number);
        expect(after.thread.items.at(-1)).toEqual(reply);
        const numbers = (await store.listAll(PUBLIC_PROJECT_PARTITION, 100)).map(comment => comment.number);
        expect(new Set(numbers).size).toBe(numbers.length);
        // A deleted migrated thread must not reappear on another cold start.
        const migrated = (await store.get(PUBLIC_PROJECT_PARTITION, legacy.id))!;
        await store.delete(PUBLIC_PROJECT_PARTITION, legacy.id, migrated.etag);
        await provisionPublicProject(app, store, legacyDomain);
        expect(await store.get(PUBLIC_PROJECT_PARTITION, legacy.id)).toBeNull();
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});

test('joining feedback concurrently grants only its project and preserves existing admin access', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const app = getAppStore();
        const user = { id: `u_${randomUUID()}`, email: 'new@example.com' } as DbUser;
        const memberships = await Promise.all(Array.from({ length: 3 }, () => joinPublicProject(user, app)));
        expect(memberships.every(member => member.role === 'commenter' && member.projects.length === 1
            && member.projects[0] === PUBLIC_PROJECT_ID)).toBe(true);
        const stored = (await app.get<DbMember>(memberships[0]!.pk, memberId(user.id)))!;
        const admin: DbMember = { ...stored.doc, role: 'admin', projects: 'all' };
        await app.replace(admin, stored.etag);
        expect(await joinPublicProject(user, app)).toEqual(admin);
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});

test('anonymous reads get real starter threads; visitors cannot remove or resolve them', async ({ request }) => {
    const response = await request.get('/api/comments?path=/');
    expect(response.ok()).toBe(true);
    expect(response.headers()['set-cookie']).toBeUndefined();
    const comments = await response.json() as { id: string; isMine: boolean; thread: { items: { author: { name: string; isMe: boolean } }[] } }[];
    const headline = comments.find(comment => comment.id === HEADLINE_COMMENT_ID)!;
    expect(headline.isMine).toBe(false);
    expect(headline.thread.items[0]?.author).toEqual({ name: 'Guest 3F2A', isMe: false });
    expect(headline.thread.items[1]?.author).toEqual({ name: 'uier', isMe: false });
    expect((await request.delete(`/api/comments/${HEADLINE_COMMENT_ID}`)).status()).toBe(403);
    expect((await request.patch(`/api/comments/${HEADLINE_COMMENT_ID}`, { data: { resolved: true } })).status()).toBe(403);
});
