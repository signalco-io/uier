import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { HEADLINE_COMMENT_ID, PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION, PUBLIC_WORKSPACE_ID, provisionPublicProject, joinPublicProject } from '../src/lib/comments/publicProject';
import { memberId, userPk, workspacePk, type DbMember, type DbUser } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { findOrCreateUser } from '../src/lib/app/users';
import { randomToken, signToken } from '../src/lib/app/tokens';
import { resolveActor } from '../src/lib/review/actor';
import { createProjectComment, replyToProjectComment } from '../src/lib/review/comments';

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

test('enrolled public commenters retain visitor comment, reply and shared IP limits', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = await provisionPublicProject(getAppStore(), getMemoryCommentsStore());
        const users = await Promise.all(Array.from({ length: 4 }, () => findOrCreateUser(`public-limits-${randomUUID()}@example.com`)));
        const ip = '198.51.100.131';
        let comment;
        for (const [index, user] of users.entries()) {
            expect((await joinPublicProject(user)).role).toBe('commenter');
            const req = new Request('http://127.0.0.1/api/review', { headers: { 'x-forwarded-for': ip,
                Authorization: `Bearer ${signToken('review', { uid: user.id, pid: project.id }, 3600)}` } });
            const actor = await resolveActor(req, project);
            expect(actor).toMatchObject({ kind: 'member', isAdmin: false });
            const input = { origin: 'https://uier.io', path: `/public-rate-${user.id}`, kind: 'feedback' as const, position: { type: 'page' as const }, text: 'Public feedback' };
            if (index < 3) for (let i = 0; i < 10; i++) comment = await createProjectComment(req, project, actor, input);
            await expect(createProjectComment(req, project, actor, input)).rejects.toMatchObject({ status: 429, code: 'rate_limited', reason: 'too_fast' });
            if (index === 3) await expect(replyToProjectComment(req, project, actor, comment!.id, { text: 'IP full' })).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
        }
        const user = await findOrCreateUser(`public-replies-${randomUUID()}@example.com`);
        const req = new Request('http://127.0.0.1/api/review', { headers: { Authorization: `Bearer ${signToken('review', { uid: user.id, pid: project.id }, 3600)}` } });
        const actor = await resolveActor(req, project);
        for (let i = 0; i < 30; i++) await replyToProjectComment(req, project, actor, comment!.id, { text: `Reply ${i}` });
        await expect(replyToProjectComment(req, project, actor, comment!.id, { text: 'One more' })).rejects.toMatchObject({ status: 429, code: 'rate_limited', reason: 'too_fast' });
        // Guests on that address are still blocked after account writes consumed the shared budget.
        const guest = new Request('http://127.0.0.1/api/review', { headers: { 'x-forwarded-for': ip, 'X-Uier-Visitor': randomToken() } });
        await expect(replyToProjectComment(guest, project, await resolveActor(guest, project), comment!.id, { text: 'Guest' })).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previous;
    }
});
