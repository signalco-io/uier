import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { HEADLINE_COMMENT_ID, STEP_COMMENT_ID, PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION, PUBLIC_WORKSPACE_ID, provisionPublicProject, joinPublicProject } from '../src/lib/comments/publicProject';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { findOrCreateUser } from '../src/lib/app/users';
import { randomToken, signToken, sha256Hex } from '../src/lib/app/tokens';
import { resolveActor, memberActor } from '../src/lib/review/actor';
import { ensureOwnWorkspace, getMember } from '../src/lib/app/workspaces';
import { createProject, updateProject } from '../src/lib/app/projects';
import { inviteToWorkspace, removeMember, acceptInvitation } from '../src/lib/app/invitations';
import type { AppContext } from '../src/lib/app/context';
import { isPublicProjectStaff } from '../src/lib/comments/publicProjectPolicy';
import { createCommentAuthorFilter, resolveCommentAuthorFilter } from '../src/lib/app/commentAuthors';
import { loadProjectComments } from '../src/lib/app/projectComments';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { pngImage } from './support/images';
import { brand } from '@uier/brand';
import { createWithScreenshot } from '../src/lib/comments/service';
import { replaceSavedScreenshot } from '../src/lib/comments/replaceScreenshot';
import { createProjectComment, replyToProjectComment, listProjectComments, getProjectComment, removeProjectComment, deleteProjectCommentItem } from '../src/lib/review/comments';
import { GET as showcaseGet, POST as showcasePost } from '../app/api/comments/route';
import { reviewApiHandler } from '../src/lib/review/http';
import { listReviewComments } from '../src/lib/review/readRoutes';



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
            id: `comment_${randomUUID()}`, domain: legacyDomain, path: '/app/projects',
            number: 15, position: { type: 'page' }, resolved: true, ttl: 777,
            thread: { items: [{ id: 'item_legacy', text: 'Existing public feedback' }] }
        };
        await store.create(legacy);
        const projects = await Promise.all(Array.from({ length: 3 }, () => provisionPublicProject(app, store, legacyDomain)));
        expect(projects.every(project => project.id === PUBLIC_PROJECT_ID && project.access === 'guests')).toBe(true);
        expect((await app.get(projects[0]!.pk, PUBLIC_PROJECT_ID))?.doc).toMatchObject({ type: 'project', ttl: -1 });
        expect((await app.get(workspacePk(PUBLIC_WORKSPACE_ID), memberId(existingUser.id)))?.doc)
            .toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID], userId: existingUser.id, ttl: -1 });
        // Other service specs can share this worker's public-project store. Check this fixture's threads.
        const fixtureIds = new Set([HEADLINE_COMMENT_ID, STEP_COMMENT_ID, legacy.id]);
        expect((await store.listAll(PUBLIC_PROJECT_PARTITION, 100)).filter(comment => fixtureIds.has(comment.id))).toHaveLength(3);
        expect((await store.get(PUBLIC_PROJECT_PARTITION, legacy.id))?.comment).toMatchObject({ ttl: 777, resolved: true, private: true });
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
        const numbers = (await store.listAll(PUBLIC_PROJECT_PARTITION, 100)).flatMap(comment => comment.number === undefined ? [] : [comment.number]);
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

async function staffRuntime(run: () => Promise<void>) {
    const old = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_STAFF_EMAILS: process.env.UIER_STAFF_EMAILS };
    process.env.UIER_LOCAL = '1';
    delete process.env.UIER_STAFF_EMAILS;
    try { await run(); }
    finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test('showcase reads and writes enforce current project access for anonymous, guest and member callers just like review', async () => staffRuntime(async () => {
    const app = getAppStore();
    const project = await provisionPublicProject(app, getMemoryCommentsStore());
    const user = await findOrCreateUser(`showcase-access-${randomUUID()}@example.com`);
    const call = (method: 'GET' | 'POST', cookie?: string) => (method === 'GET' ? showcaseGet : showcasePost)(
        new Request(`http://localhost/api/comments?path=/`, { method,
            headers: { host: 'localhost', ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: JSON.stringify({ path: '/', position: { type: 'page' }, kind: 'feedback', text: 'Authorized feedback' }) } : {})
        }), { params: Promise.resolve({}) });
    const review = reviewApiHandler(listReviewComments, { verifyWrites: false });
    const callers: { cookie?: string; headers: Record<string, string> }[] = [
        { cookie: undefined, headers: {} },
        { cookie: `uier_visitor=${randomToken()}`, headers: { 'X-Uier-Visitor': randomToken() } },
        { cookie: `uier_session=${signToken('session', { uid: user.id }, 3600)}`,
            headers: { Authorization: `Bearer ${signToken('review', { uid: user.id, pid: project.id }, 3600)}` } }
    ];
    const original = (await app.get<DbProject>(project.pk, project.id))!.doc;
    try {
        // ensurePublicProject has already resolved before these stored settings change.
        for (const access of ['guests', 'invited', 'disabled'] as const) {
            const current = (await app.get<DbProject>(project.pk, project.id))!;
            await app.replace({ ...current.doc, access }, current.etag);
            for (const [index, caller] of callers.entries()) {
                const status = access === 'disabled' ? 403 : access === 'invited' && index < 2 ? 401 : 200;
                const listed = await call('GET', caller.cookie);
                const compared = await review(new Request(`http://localhost/api/review/${project.publicId}/comments?path=/`, { headers: caller.headers }),
                    { params: Promise.resolve({ projectId: project.publicId }) });
                expect(listed.status).toBe(status);
                expect(compared.status).toBe(status);
                const before = await getMemoryCommentsStore().listAll(PUBLIC_PROJECT_PARTITION, 1000);
                const written = await call('POST', caller.cookie);
                expect(written.status).toBe(status === 200 ? 201 : status);
                if (status !== 200) {
                    expect(await listed.json()).toMatchObject({ error: access === 'disabled' ? 'comments_disabled' : 'sign_in_required' });
                    expect(await written.json()).toMatchObject({ error: access === 'disabled' ? 'comments_disabled' : 'sign_in_required' });
                    expect(written.headers.has('set-cookie')).toBe(false);
                    expect(await getMemoryCommentsStore().listAll(PUBLIC_PROJECT_PARTITION, 1000)).toEqual(before);
                }
            }
        }
        const current = (await app.get<DbProject>(project.pk, project.id))!;
        await app.replace({ ...current.doc, access: 'invited' }, current.etag);
        await app.delete(project.pk, memberId(user.id));
        expect((await call('GET', callers[2]!.cookie)).status).toBe(401);
    } finally {
        const current = (await app.get<DbProject>(project.pk, project.id))!;
        await app.replace(original, current.etag);
    }
}));

test('staff normalization, concurrent joins and allowlist removal replace hand-set roles without changing ordinary workspaces', async () => staffRuntime(async () => {
    const app = getAppStore();
    const user = await findOrCreateUser(`staff-${randomUUID()}@example.com`);
    const own = await ensureOwnWorkspace(user);
    const originalOwn = (await app.get<DbMember>(own.pk, own.id))!;
    await app.delete(workspacePk(PUBLIC_WORKSPACE_ID), memberId(user.id));
    const joined = await Promise.all(Array.from({ length: 8 }, () => joinPublicProject(user, app)));
    expect(joined.every(member => member.role === 'commenter' && JSON.stringify(member.projects) === JSON.stringify([PUBLIC_PROJECT_ID]))).toBe(true);
    const first = joined[0]!;
    expect(first).toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID] });
    process.env.UIER_STAFF_EMAILS = ` malformed, ${user.email.toUpperCase()} ; bad@@example.com\n`;
    expect(isPublicProjectStaff(user.email)).toBe(true);
    expect(isPublicProjectStaff('bad@@example.com')).toBe(false);
    const promoted = await Promise.all(Array.from({ length: 8 }, () => joinPublicProject(user)));
    expect(promoted.every(member => member.role === 'admin' && member.projects === 'all')).toBe(true);
    expect(promoted.every(member => member.createdAt === first.createdAt)).toBe(true);
    const project = await provisionPublicProject(app, getMemoryCommentsStore());
    const request = new Request('http://localhost/api/review', { headers: { Authorization: `Bearer ${signToken('review', { uid: user.id, pid: project.id }, 3600)}` } });
    expect(await resolveActor(request, project)).toMatchObject({ isAdmin: true });
    process.env.UIER_STAFF_EMAILS = '';
    // Existing review tokens lose staff access even before the stored role is rewritten.
    expect((await app.get<DbMember>(first.pk, first.id))!.doc.role).toBe('admin');
    expect(await resolveActor(request, project)).toMatchObject({ kind: 'member', isAdmin: false });
    // Read-time demotion also constrains the old stored all-projects grant.
    expect(await memberActor({ ...project, id: 'other0000001' }, user.id)).toBeNull();
    const demoted = await Promise.all(Array.from({ length: 8 }, () => joinPublicProject(user)));
    expect(demoted.every(member => member.role === 'commenter' && JSON.stringify(member.projects) === JSON.stringify([PUBLIC_PROJECT_ID]))).toBe(true);
    const stored = (await app.get<DbMember>(first.pk, first.id))!;
    await app.replace({ ...stored.doc, role: 'admin', projects: 'all' }, stored.etag);
    // A new server instance resets manually assigned admins, even with the durable backfill receipt.
    await provisionPublicProject(app, getMemoryCommentsStore());
    expect((await app.get<DbMember>(first.pk, first.id))!.doc).toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID] });
    expect(await app.get<DbMember>(own.pk, own.id)).toEqual(originalOwn);
    delete process.env.UIER_STAFF_EMAILS;
    expect(isPublicProjectStaff(user.email)).toBe(false);
    process.env.UIER_STAFF_EMAILS = 'invalid address;@@;';
    expect((await findOrCreateUser(user.email)).id).toBe(user.id);
    expect(await joinPublicProject(user)).toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID] });
}));

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


test('public workspace rejects invitations, member removal, project creation and settings; earlier invitations cannot promote', async () => staffRuntime(async () => {
    const user = await findOrCreateUser(`operations-${randomUUID()}@example.com`);
    process.env.UIER_STAFF_EMAILS = user.email;
    const member = await joinPublicProject(user);
    const context = { user, member, workspace: { id: PUBLIC_WORKSPACE_ID }, isAdmin: true } as AppContext;
    const project = await provisionPublicProject(getAppStore(), getMemoryCommentsStore());
    const target = await findOrCreateUser(`old-invite-${randomUUID()}@example.com`);
    await expect(inviteToWorkspace(context, { email: target.email, role: 'admin', projects: 'all' })).rejects.toThrow('Everyone joins the uier workspace automatically.');
    await expect(removeMember(context, target.id)).rejects.toThrow('Everyone joins the uier workspace automatically.');
    await expect(createProject(context, { name: 'Unexpected', urls: ['https://example.com'] })).rejects.toThrow('Everyone joins the uier workspace automatically.');
    for (const update of [{ name: 'Renamed' }, { access: 'invited' as const }, { urls: ['https://attacker.example'] }, { status: 'done' as const }, { emailCommentExcerpts: true }])
        await expect(updateProject(PUBLIC_WORKSPACE_ID, project.id, update)).rejects.toThrow('The public feedback project settings are managed by uier.');
    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const app = getAppStore();
    const id = `invitation_${randomUUID()}`;
    await app.create({ type: 'invitation', id, pk: member.pk, workspaceId: PUBLIC_WORKSPACE_ID, email: target.email,
        role: 'admin', projects: 'all', invitedBy: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), tokenHash });
    await app.create({ type: 'invitation-token', id: tokenHash, pk: `invitation:${tokenHash}`, workspaceId: PUBLIC_WORKSPACE_ID, invitationId: id });
    expect(await acceptInvitation(token)).toMatchObject({ user: { id: target.id } });
    expect(await getMember(PUBLIC_WORKSPACE_ID, target.id)).toMatchObject({ role: 'commenter', projects: [PUBLIC_PROJECT_ID] });
    expect(await acceptInvitation(token)).toBeNull();
    expect((await app.get(project.pk, project.id))!.doc).toMatchObject({ name: project.name, access: 'guests', urls: ['https://uier.io'] });
}));

test('private app feedback is visible to staff and its author; deleting replies and screenshot threads preserves counters and numbering', async () => staffRuntime(async () => {
    const staff = await findOrCreateUser(`moderate-${randomUUID()}@example.com`);
    process.env.UIER_STAFF_EMAILS = staff.email;
    await joinPublicProject(staff);
    const project = await provisionPublicProject(getAppStore(), getMemoryCommentsStore());
    const owner = await findOrCreateUser(`owner-${randomUUID()}@example.com`);
    const stranger = await findOrCreateUser(`stranger-${randomUUID()}@example.com`);
    const admin = (await memberActor(project, staff.id))!;
    const author = (await memberActor(project, owner.id))!;
    const other = (await memberActor(project, stranger.id))!;
    const request = new Request('http://localhost');
    const comment = await createProjectComment(request, project, author, { origin: 'https://uier.io', path: '/app/projects', kind: 'feedback', position: { type: 'page' }, text: 'Private app feedback', screenshot: parseScreenshot(pngImage) as ParsedScreenshot });
    await replyToProjectComment(request, project, author, comment.id, { text: 'Remove just this reply' });
    const replied = (await getProjectComment(project, admin, comment.id))!;
    expect(await getProjectComment(project, author, comment.id)).not.toBeNull();
    await expect(getProjectComment(project, other, comment.id)).rejects.toMatchObject({ status: 404 });
    const reviewRequest = new Request('http://localhost/api/review', { headers: { Authorization: `Bearer ${signToken('review', { uid: staff.id, pid: project.id }, 3600)}` } });
    process.env.UIER_STAFF_EMAILS = '';
    const formerStaff = await resolveActor(reviewRequest, project);
    expect(formerStaff).toMatchObject({ kind: 'member', isAdmin: false });
    await expect(getProjectComment(project, formerStaff, comment.id)).rejects.toMatchObject({ status: 404 });
    process.env.UIER_STAFF_EMAILS = staff.email;
    const store = getMemoryCommentsStore();
    const replyId = replied.thread.items[1]!.id!;
    await expect(deleteProjectCommentItem(project, other, comment.id, replyId)).rejects.toMatchObject({ status: 404 });
    const afterReply = await deleteProjectCommentItem(project, admin, comment.id, replyId);
    expect(afterReply!.thread.items).toHaveLength(1);
    expect(await store.getScreenshot(comment.domain, comment.id)).not.toBeNull();
    const counterId = `moderation-counter-${randomUUID()}`;
    expect(await store.incrementCounter(comment.domain, counterId, 1, 3600)).toBe(true);
    const beforeNumber = await store.nextCommentNumber(comment.domain);
    await removeProjectComment(project, admin, comment.id);
    expect(await store.get(comment.domain, comment.id)).toBeNull();
    expect(await store.getScreenshot(comment.domain, comment.id)).toBeNull();
    expect(await store.nextCommentNumber(comment.domain)).toBe(beforeNumber + 1);
    expect(await store.incrementCounter(comment.domain, counterId, 1, 3600)).toBe(false);
}));

test('opaque author filters include opened and replied threads before the limit and reject commenters, foreign projects and expired references', async () => staffRuntime(async () => {
    const user = await findOrCreateUser(`author-filter-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Author filtering', urls: ['https://example.com'] });
    const store = getMemoryCommentsStore();
    const domain = `project:${project.id}`;
    const targetId = `user:${randomUUID()}`;
    const guestId = sha256Hex(randomToken());
    const seed = async (id: string, authorId: string, replies: { authorId: string; deletedAt?: string }[] = [], createdAt = '2000-01-01T00:00:00.000Z') => {
        const comment: DbComment = { id: `comment_${id}`, domain, path: '/old', origin: 'https://example.com', position: { type: 'page' }, authorId, createdAt,
            thread: { items: [{ id: 'first', text: 'Opened', authorId }, ...replies.map((reply, i) => ({ id: `reply_${i}`, text: 'Reply', ...reply }))] } };
        await store.create(comment); return comment;
    };
    const opened = await seed('opened', targetId);
    const replied = await seed('replied', guestId, [{ authorId: targetId }]);
    await seed('deleted', 'other', [{ authorId: targetId, deletedAt: new Date().toISOString() }]);
    for (let i = 0; i < 1001; i++) await seed(`new_${i}`, 'other', [], '2020-01-01T00:00:00.000Z');
    const actor = (await memberActor(project, user.id))!;
    expect((await listProjectComments(project, actor)).map(c => c.id)).not.toContain(opened.id);
    const reference = await createCommentAuthorFilter(context, project, opened.id);
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reference).not.toContain(targetId);
    const selected = (await resolveCommentAuthorFilter(context, project, reference))!;
    expect(selected.authorId).toBe(targetId);
    expect((await listProjectComments(project, actor, undefined, undefined, selected.authorId)).map(c => c.id).sort()).toEqual([opened.id, replied.id].sort());
    expect((await store.list(domain, '/old', 1000, undefined, targetId)).map(c => c.id).sort()).toEqual([opened.id, replied.id].sort());
    const guestRef = await createCommentAuthorFilter(context, project, replied.id);
    expect((await resolveCommentAuthorFilter(context, project, guestRef))!.authorId).toBe(guestId);
    const replyRef = await createCommentAuthorFilter(context, project, replied.id, 'reply_0');
    expect((await resolveCommentAuthorFilter(context, project, replyRef))!.authorId).toBe(targetId);
    const views = await loadProjectComments(context, project, undefined, targetId);
    expect(JSON.stringify(views)).not.toContain(targetId);
    expect(JSON.stringify(views)).not.toContain(guestId);
    const commenter = { ...context, isAdmin: false };
    await expect(createCommentAuthorFilter(commenter, project, opened.id)).rejects.toThrow('Only admins can filter by author.');
    expect(await resolveCommentAuthorFilter(commenter, project, reference)).toBeNull();
    await expect(listProjectComments(project, { kind: 'member', userId: user.id, name: '', isAdmin: false }, undefined, undefined, targetId)).rejects.toMatchObject({ status: 403 });
    const second = await createProject(context, { name: 'Other', urls: ['https://other.example'] });
    expect(await resolveCommentAuthorFilter(context, second, reference)).toBeNull();
    expect(await resolveCommentAuthorFilter({ ...context, user: { ...user, id: 'u_someoneelse' } }, project, reference)).toBeNull();
    expect(await resolveCommentAuthorFilter(context, project, targetId)).toBeNull();
    const app = getAppStore();
    const ref = (await app.get(workspacePk(project.workspaceId), `comment-author_${sha256Hex(reference)}`))!;
    await app.replace({ ...ref.doc, expiresAt: '2000-01-01T00:00:00.000Z' }, ref.etag);
    expect(await resolveCommentAuthorFilter(context, project, reference)).toBeNull();
    // Legacy threads can keep the opener only at the comment level.
    const legacy = (await store.get(domain, opened.id))!;
    await store.replace({ ...legacy.comment, thread: { items: [{ id: 'first', text: 'Legacy opener' }] } }, legacy.etag);
    const legacyRef = await createCommentAuthorFilter(context, project, opened.id);
    expect((await resolveCommentAuthorFilter(context, project, legacyRef))!.authorId).toBe(targetId);
}));

test('deleting migrated feedback or replacing its image removes the legacy comment and screenshot', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const store = getMemoryCommentsStore();
        const app = getAppStore();
        const project = await provisionPublicProject(app, store);
        await app.create({ id: 'public-feedback-migration-v1', pk: project.pk, type: 'migration', ttl: -1 });
        const image = parseScreenshot(pngImage) as ParsedScreenshot;
        for (const operation of ['delete', 'replace']) {
            const legacy: DbComment = { id: `comment_${randomUUID()}`, domain: brand.domain, path: '/', position: { type: 'page' }, authorId: 'legacy-owner',
                screenshot: { contentType: image.contentType, bytes: image.data.length, width: image.width, height: image.height },
                thread: { items: [{ id: 'first', text: 'Migrated image', authorId: 'legacy-owner' }] } };
            await createWithScreenshot(store, legacy, image);
            await createWithScreenshot(store, { ...legacy, domain: PUBLIC_PROJECT_PARTITION }, image);
            if (operation === 'delete') await removeProjectComment(project, { kind: 'guest', visitorId: 'legacy-owner' }, legacy.id);
            else await replaceSavedScreenshot(store, PUBLIC_PROJECT_PARTITION, legacy.id, { screenshot: image, expectedRevision: null }, () => {});
            expect(await store.get(brand.domain, legacy.id)).toBeNull();
            expect(await store.getScreenshot(brand.domain, legacy.id)).toBeNull();
        }
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});
