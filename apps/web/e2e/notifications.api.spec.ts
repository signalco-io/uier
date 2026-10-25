import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser, findUserByEmail } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, replyToProjectComment, setProjectCommentResolved } from '../src/lib/review/comments';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { markThreadRead } from '../src/lib/comments/readState';
import { threadActivity } from '../src/lib/comments/activity';
import { discoverThreadNotifications, processNotificationDelivery, type NotificationDelivery } from '../src/lib/notifications/delivery';
import { actOnNotificationToken, followThread, inspectNotificationToken, notificationPk, notificationSubscription, notificationToken, setProjectMuted } from '../src/lib/notifications/preferences';
import type { EmailMessage } from '../src/lib/email/send';
import type { deliverNotificationEmail } from '../src/lib/notifications/transport';
import type { DbComment } from '../src/lib/db/schema';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const baseUrl = 'https://uier.io';
const request = new Request('http://127.0.0.1/api/review');
const old = '2026-01-01T00:00:00.000Z';

async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`owner-${id}@example.com`);
    const member = await findOrCreateUser(`member-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Project ${id}`, urls: ['https://reviewed.example'],
        pageState: { queryParameters: ['tab'], hashRouting: true }, status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [user, role] of [[owner, 'admin'], [member, 'commenter']] as const)
        await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id, email: user.email, role, projects: 'all', createdAt: old });
    const ownerActor = (await memberActor(project, owner.id))!;
    const memberReviewer = (await memberActor(project, member.id))!;
    const guest: ProjectActor = { kind: 'guest', visitorId: `guest-${id}` };
    const comment = await createProjectComment(request, project, guest, { text: 'Private source text never in email', origin: 'https://reviewed.example',
        path: '/pricing?tab=yearly#/plans', pageStateVersion: 1, position: { type: 'page' }, kind: 'feedback', authorName: 'Ana' });
    return { project, owner, member, ownerActor, memberActor: memberReviewer, guest, comment };
}

async function current(comment: DbComment) { return (await getCommentsStore().get(comment.domain, comment.id))!.comment; }
async function deliveries(project: DbProject) { return getAppStore().query<NotificationDelivery>({ type: 'notification-delivery', pk: notificationPk(project.id) }); }
async function dispatch(project: DbProject, comment: DbComment, sent: EmailMessage[], transport?: typeof deliverNotificationEmail) {
    await discoverThreadNotifications(project, await current(comment));
    for (const delivery of await deliveries(project)) await processNotificationDelivery(delivery, baseUrl,
        transport ?? (async message => { sent.push(message); return { status: 'sent' }; }), Date.now() + 30 * 60 * 1000);
}

test('owners receive new feedback, participants receive batched replies/status, actors do not receive their own activity', async () => {
    const f = await fixture();
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toEqual([f.owner.email]);
    expect(sent[0]!.text).not.toContain('Private source text');
    expect(sent[0]!.text).toContain(encodeURIComponent('/pricing?tab=yearly#/plans'));
    expect(sent[0]!.html).toContain('Manage project emails</a>');
    await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'Member joined' });
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(1);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Team replied' });
    await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, true);
    await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, false);
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.to).toBe(f.member.email);
    expect(sent[1]!.text).toContain('There is new activity');
    expect(sent[1]!.text).not.toContain('Team replied');
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
});

test('digest waits five minutes and uses #83 shared read cursor to suppress seen activity', async () => {
    const f = await fixture();
    const sent: EmailMessage[] = [];
    await discoverThreadNotifications(f.project, f.comment);
    const delivery = (await deliveries(f.project))[0]!;
    const transport: typeof deliverNotificationEmail = async message => { sent.push(message); return { status: 'sent' }; };
    await processNotificationDelivery(delivery, baseUrl, transport);
    expect(sent).toHaveLength(0);
    expect((await deliveries(f.project))[0]!.status).toBe('waiting');
    await markThreadRead(f.comment, `user:${f.owner.id}`, threadActivity(f.comment).sequence);
    await processNotificationDelivery(delivery, baseUrl, transport, Date.now() + 10 * 60 * 1000);
    expect(sent).toHaveLength(0);
    expect((await deliveries(f.project))[0]!.status).toBe('suppressed');
    expect((await current(f.comment)).resolved).toBe(false);
});

test('explicit follow/unfollow and project mute apply at delivery, including queued work', async () => {
    const f = await fixture();
    const sent: EmailMessage[] = [];
    await followThread(f.project, f.memberActor, f.comment.id, true);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'First reply' });
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toContain(f.member.email);
    await followThread(f.project, f.memberActor, f.comment.id, false);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Unfollowed' });
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
    await followThread(f.project, f.memberActor, f.comment.id, true);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Muted' });
    await discoverThreadNotifications(f.project, await current(f.comment));
    await setProjectMuted(f.project, f.memberActor, true);
    for (const delivery of await deliveries(f.project)) await processNotificationDelivery(delivery, baseUrl,
        async message => { sent.push(message); return { status: 'sent' }; }, Date.now() + 10 * 60 * 1000);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
    await setProjectMuted(f.project, f.memberActor, false);
});

test('guest email is optional, verified separately, revocable, and never creates an account', async () => {
    const f = await fixture();
    expect((await current(f.comment)).thread.items[0]!.authorName).toBe('Ana');
    const address = `guest-${f.project.id}@example.com`;
    const result = await followThread(f.project, f.guest, f.comment.id, true, address, baseUrl);
    const token = new URL(result.verificationUrl!).searchParams.get('token')!;
    expect(await inspectNotificationToken(token)).not.toBeNull();
    expect((await notificationSubscription(f.project.id, (f.guest as { visitorId: string }).visitorId, f.comment.id))?.following).toBe(false);
    await actOnNotificationToken(token, 'verify');
    expect(await inspectNotificationToken(token)).toBeNull();
    expect(await findUserByEmail(address)).toBeNull();
    const sent: EmailMessage[] = [];
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Guest reply' });
    await dispatch(f.project, f.comment, sent);
    const guestMail = sent.find(message => message.to === address)!;
    expect(guestMail).toBeDefined();
    expect(guestMail.text).toContain('uier-comment=');
    expect(guestMail.text).not.toContain('Guest reply');
    const subscription = (await notificationSubscription(f.project.id, (f.guest as { visitorId: string }).visitorId, f.comment.id))!;
    const manageToken = notificationToken(subscription, 'subscription');
    await actOnNotificationToken(manageToken, 'unsubscribe');
    expect((await notificationSubscription(f.project.id, subscription.actorId, f.comment.id))?.email).toBeUndefined();
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'No more mail' });
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === address)).toHaveLength(1);
    await expect(actOnNotificationToken(`${manageToken}invalid`, 'verify')).rejects.toMatchObject({ code: 'not_found' });
});

test('access and private visibility are rechecked after discovery', async () => {
    const f = await fixture();
    await followThread(f.project, f.memberActor, f.comment.id, true);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Queued reply' });
    await discoverThreadNotifications(f.project, await current(f.comment));
    await getAppStore().delete(f.project.pk, memberId(f.member.id));
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).not.toContain(f.member.email);

    const other = await fixture();
    await followThread(other.project, other.memberActor, other.comment.id, true);
    await replyToProjectComment(request, other.project, other.ownerActor, other.comment.id, { text: 'Becomes private' });
    const stored = (await getCommentsStore().get(other.comment.domain, other.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, private: true }, stored.etag);
    await dispatch(other.project, other.comment, sent);
    expect(sent.map(message => message.to)).not.toContain(other.member.email);
    await expect(followThread(other.project, other.memberActor, other.comment.id, true)).rejects.toMatchObject({ code: 'not_found' });
});

test('durable retries reuse provider identity, concurrent discovery and worker attempts deduplicate', async () => {
    const f = await fixture();
    await Promise.all([discoverThreadNotifications(f.project, f.comment), discoverThreadNotifications(f.project, f.comment)]);
    expect(await deliveries(f.project)).toHaveLength(1);
    const delivery = (await deliveries(f.project))[0]!;
    let operationId: string | undefined;
    await processNotificationDelivery(delivery, baseUrl, async (_message, attempt) => {
        operationId = attempt.operationId;
        throw new Error('simulated connection failure');
    }, Date.now() + 10 * 60 * 1000);
    const retry = (await deliveries(f.project))[0]!;
    expect(retry.attempt?.operationId).toBe(operationId);
    expect(retry.failures).toBe(1);
    let calls = 0;
    const transport: typeof deliverNotificationEmail = async (_message, attempt, isRetry) => {
        calls++;
        expect(attempt.operationId).toBe(operationId);
        expect(isRetry).toBe(true);
        return { status: 'sent' };
    };
    await Promise.all([processNotificationDelivery(retry, baseUrl, transport, Date.now() + 30 * 60 * 1000),
        processNotificationDelivery(retry, baseUrl, transport, Date.now() + 30 * 60 * 1000)]);
    expect(calls).toBe(1);
    await dispatch(f.project, f.comment, []);
    expect((await deliveries(f.project))[0]!.active).toBe(false);
});

test('provider ambiguity and repeated failure retain clear durable evidence', async () => {
    const f = await fixture();
    await discoverThreadNotifications(f.project, f.comment);
    let delivery = (await deliveries(f.project))[0]!;
    await processNotificationDelivery(delivery, baseUrl, async () => ({ status: 'ambiguous', code: 'operation_unknown' }), Date.now() + 10 * 60 * 1000);
    delivery = (await deliveries(f.project))[0]!;
    expect(delivery).toMatchObject({ active: false, status: 'ambiguous', lastCode: 'operation_unknown' });
    expect(delivery.attempt?.operationId).toBeTruthy();
    const second = await fixture();
    await discoverThreadNotifications(second.project, second.comment);
    for (let attempt = 0; attempt < 8; attempt++) {
        const queued = (await deliveries(second.project))[0]!;
        await processNotificationDelivery(queued, baseUrl, async () => ({ status: 'failed', code: 'ProviderRejected' }), Date.now() + (attempt + 1) * 4 * 60 * 60 * 1000);
    }
    expect((await deliveries(second.project))[0]).toMatchObject({ active: false, status: 'failed', failures: 8, lastCode: 'ProviderRejected' });
});

test('outbox shares the activity cursor and status no-ops do not enqueue duplicates', async () => {
    const f = await fixture();
    const replied = await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'A reply' });
    const resolved = await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, true);
    const noop = await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, true);
    expect(f.comment.notificationEvents).toEqual([{ sequence: 1, actorId: (f.guest as { visitorId: string }).visitorId, kind: 'comment', at: expect.any(String) }]);
    expect(replied.notificationEvents?.at(-1)?.sequence).toBe(threadActivity(replied).sequence);
    expect(resolved.notificationEvents?.at(-1)?.sequence).toBe(threadActivity(resolved).sequence);
    expect(noop.notificationEvents).toEqual(resolved.notificationEvents);
    expect(noop.notificationPending).toBe(true);
});
