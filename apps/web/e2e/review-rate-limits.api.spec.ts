import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { randomToken, signToken } from '../src/lib/app/tokens';
import { findOrCreateUser } from '../src/lib/app/users';
import { errorResponse } from '../src/lib/comments/http';
import { RATE_LIMIT_MEMBER_COMMENTS, RATE_LIMIT_MEMBER_REPLIES, RATE_LIMIT_DOMAIN_SCREENSHOTS } from '../src/lib/comments/limits';
import { enforceNewCommentLimits, enforceReplyLimits, enforceScreenshotLimits } from '../src/lib/comments/rateLimits';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { resolveActor } from '../src/lib/review/actor';
import { createProjectComment, enforceProjectRewriteLimits, projectPartition, replyToProjectComment } from '../src/lib/review/comments';
import { pngImage } from './support/images';

const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

const request = (headers: HeadersInit = {}) => new Request('http://127.0.0.1/api/review', { headers });
const guestRequest = (headers: HeadersInit = {}) => request({ 'X-Uier-Visitor': randomToken(), ...headers });
const input = (project: DbProject, path = '/pricing') => ({
    origin: project.urls[0]!, path, text: 'Review feedback', kind: 'feedback' as const, position: { type: 'page' as const }
});

async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const users = await Promise.all(Array.from({ length: 3 }, (_, i) => findOrCreateUser(`rate-${id}-${i}@example.com`)));
    const workspaceId = `w_${users[0]!.id}`;
    const now = new Date().toISOString();
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: 'Rate limits',
        urls: ['https://reviewed.example'], status: 'active', access: 'guests', createdBy: users[0]!.id, createdAt: now, updatedAt: now };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [i, user] of users.entries())
        await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId,
            userId: user.id, email: user.email, role: i === 0 ? 'admin' : 'commenter', projects: [id], createdAt: now });
    const tokens = users.map(user => signToken('review', { uid: user.id, pid: id }, 3600));
    const requests = tokens.map(token => request({ Authorization: `Bearer ${token}` }));
    const actors = await Promise.all(requests.map(req => resolveActor(req, project)));
    expect(actors.every(actor => actor.kind === 'member')).toBe(true);
    return { project, users, tokens, requests, actors };
}

async function limited(write: Promise<unknown>, reason = 'too_fast') {
    const error = await write.then(() => { throw new Error('Write unexpectedly passed its limit'); }, error => error);
    const response = errorResponse(error);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: 'rate_limited', reason });
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
}

test('members exceed visitor budgets and stop at finite per-project comment and reply ceilings', async () => {
    const f = await fixture();
    // A non-admin member receives the same budget as the owner.
    const actor = f.actors[1]!;
    const req = f.requests[1]!;
    const comments = [];
    for (let i = 0; i < RATE_LIMIT_MEMBER_COMMENTS; i++)
        comments.push(await createProjectComment(req, f.project, actor, input(f.project, `/page-${i}`)));
    await limited(createProjectComment(req, f.project, actor, input(f.project, '/one-more')));
    for (let i = 0; i < RATE_LIMIT_MEMBER_REPLIES; i++)
        await replyToProjectComment(req, f.project, actor, comments[Math.floor(i / 40)]!.id, { text: `Reply ${i}` });
    await limited(replyToProjectComment(req, f.project, actor, comments.at(-1)!.id, { text: 'One more' }));
    await createProjectComment(f.requests[0]!, f.project, f.actors[0]!, input(f.project));
    // The same user in another project has an independent budget.
    const other = { ...f.project, id: randomUUID().replaceAll('-', '').slice(0, 12) };
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(f.users[1]!.id)))!;
    await getAppStore().replace({ ...member.doc, projects: 'all' }, member.etag);
    const otherRequest = request({ Authorization: `Bearer ${signToken('review', { uid: f.users[1]!.id, pid: other.id }, 3600)}` });
    await createProjectComment(otherRequest, other, await resolveActor(otherRequest, other), input(other));
});

test('project guests retain 10 comments and 30 replies even when request headers claim membership', async () => {
    const f = await fixture();
    const req = guestRequest({ 'X-Uier-Role': 'admin', 'X-Uier-Member': 'true', 'X-Uier-Rate-Limit': '10000' });
    const actor = await resolveActor(req, f.project);
    expect(actor.kind).toBe('guest');
    let comment;
    for (let i = 0; i < 10; i++) comment = await createProjectComment(req, f.project, actor, input(f.project));
    await limited(createProjectComment(req, f.project, actor, input(f.project, '/other')));
    for (let i = 0; i < 30; i++) await replyToProjectComment(req, f.project, actor, comment!.id, { text: `Reply ${i}` });
    await limited(replyToProjectComment(req, f.project, actor, comment!.id, { text: 'One more' }));
});

test('members behind one non-loopback IP do not consume or inherit the guests shared write budget', async () => {
    const f = await fixture();
    const network = { 'x-forwarded-for': '198.51.100.130' };
    const memberRequests = f.tokens.map(token => request({ ...network, Authorization: `Bearer ${token}` }));
    const actors = await Promise.all(memberRequests.map(req => resolveActor(req, f.project)));
    let comment;
    for (let member = 0; member < 3; member++)
        for (let i = 0; i < 15; i++) comment = await createProjectComment(memberRequests[member]!, f.project, actors[member]!, input(f.project));
    const req = guestRequest(network);
    const actor = await resolveActor(req, f.project);
    for (let i = 0; i < 10; i++) await createProjectComment(req, f.project, actor, input(f.project));
    for (let i = 0; i < 20; i++) await replyToProjectComment(req, f.project, actor, comment!.id, { text: `Guest ${i}` });
    await limited(replyToProjectComment(req, f.project, actor, comment!.id, { text: 'IP full' }));
    const fresh = guestRequest(network);
    await limited(createProjectComment(fresh, f.project, await resolveActor(fresh, f.project), input(f.project)));
    await createProjectComment(memberRequests[0]!, f.project, actors[0]!, input(f.project));
    await replyToProjectComment(memberRequests[1]!, f.project, actors[1]!, comment!.id, { text: 'Member can still reply' });
});

test('100 comments per page per day still stops members while other pages and replies remain available', async () => {
    const f = await fixture();
    let comment;
    for (let i = 0; i < 100; i++) comment = await createProjectComment(f.requests[i % 2]!, f.project, f.actors[i % 2]!, input(f.project));
    await limited(createProjectComment(f.requests[2]!, f.project, f.actors[2]!, input(f.project)), 'page_full');
    await createProjectComment(f.requests[2]!, f.project, f.actors[2]!, input(f.project, '/other'));
    await replyToProjectComment(f.requests[2]!, f.project, f.actors[2]!, comment!.id, { text: 'Still reviewing' });
});

test('member screenshots and paid rewrites keep their existing budgets', async () => {
    const f = await fixture();
    for (let i = 0; i < RATE_LIMIT_DOMAIN_SCREENSHOTS - 1; i++)
        await enforceScreenshotLimits(getCommentsStore(), projectPartition(f.project.id));
    const screenshot = parseScreenshot(pngImage) as ParsedScreenshot;
    const saved = await createProjectComment(f.requests[0]!, f.project, f.actors[0]!, { ...input(f.project), screenshot });
    expect(saved.screenshot).toBeDefined();
    // Screenshots are optional: an exhausted image budget still saves the feedback without one.
    const without = await createProjectComment(f.requests[1]!, f.project, f.actors[1]!, { ...input(f.project), screenshot });
    expect(without.screenshot).toBeUndefined();
    for (let i = 0; i < 20; i++) await enforceProjectRewriteLimits(f.requests[0]!, f.project, f.actors[0]!);
    await limited(enforceProjectRewriteLimits(f.requests[0]!, f.project, f.actors[0]!));
});

test('invalid, expired, foreign and removed-member tokens fall back to guest limits or reject without a visitor', async () => {
    const f = await fixture();
    const user = f.users[1]!;
    const tokens = ['invalid', signToken('review', { uid: user.id, pid: f.project.id }, -1),
        signToken('review', { uid: user.id, pid: 'otherproject' }, 3600), f.tokens[1]!];
    await getAppStore().delete(f.project.pk, memberId(user.id));
    for (const token of tokens) {
        const req = guestRequest({ Authorization: `Bearer ${token}` });
        const actor = await resolveActor(req, f.project);
        expect(actor.kind).toBe('guest');
        let comment;
        for (let i = 0; i < 10; i++) comment = await createProjectComment(req, f.project, actor, input(f.project));
        await limited(createProjectComment(req, f.project, actor, input(f.project, '/extra')));
        for (let i = 0; i < 30; i++) await replyToProjectComment(req, f.project, actor, comment!.id, { text: `Reply ${i}` });
        await limited(replyToProjectComment(req, f.project, actor, comment!.id, { text: 'Extra' }));
        const noVisitor = request({ Authorization: `Bearer ${token}` });
        const anonymous = await resolveActor(noVisitor, f.project);
        expect(anonymous.kind).toBe('anonymous');
        await expect(createProjectComment(noVisitor, f.project, anonymous, input(f.project))).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
        await expect(replyToProjectComment(noVisitor, f.project, anonymous, comment!.id, { text: 'No identity' })).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    }
});

test('rate counters contain only keyed-hash ids and retain fixed-window expiry', async () => {
    const calls: { domain: string; id: string; limit: number; ttl: number }[] = [];
    const store = { ...getCommentsStore(), incrementCounter: async (domain: string, id: string, limit: number, ttl: number) => {
        calls.push({ domain, id, limit, ttl }); return true;
    } };
    const subject = { domain: 'project:hashcheck', authorId: 'user:private-user-id', member: true, ipBucket: '198.51.100.130', credentialId: 'private-credential-id' };
    await enforceNewCommentLimits(store, subject, '/page');
    await enforceReplyLimits(store, subject);
    expect(calls).toHaveLength(4); // Member, page, credential, owner; no member IP counter.
    for (const call of calls) {
        expect(call.id).toMatch(/^counter_[a-f0-9]{40}$/);
        expect(call.domain).toBe(subject.domain);
        expect([3900, 86700]).toContain(call.ttl);
        expect(JSON.stringify(call)).not.toContain(subject.authorId);
        expect(JSON.stringify(call)).not.toContain(subject.ipBucket);
        expect(JSON.stringify(call)).not.toContain(subject.credentialId);
    }
});
