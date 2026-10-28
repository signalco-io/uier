import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser, findUserByEmail } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, deleteProjectCommentItem, editProjectCommentItem, replyToProjectComment, setProjectCommentResolved } from '../src/lib/review/comments';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { markThreadRead } from '../src/lib/comments/readState';
import { threadActivity, withThreadActivity } from '../src/lib/comments/activity';
import { withNotificationEvent } from '../src/lib/notifications/events';
import { discoverThreadNotifications, processNotificationDelivery, retryNotificationDelivery, type NotificationDelivery } from '../src/lib/notifications/delivery';
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
async function dispatch(project: DbProject, comment: DbComment, sent: EmailMessage[], transport?: typeof deliverNotificationEmail, store?: ReturnType<typeof getAppStore>) {
    await discoverThreadNotifications(project, await current(comment));
    for (const delivery of await deliveries(project)) await processNotificationDelivery(delivery, baseUrl,
        transport ?? (async message => { sent.push(message); return { status: 'sent' }; }), Date.now() + 30 * 60 * 1000, store);
}

test('owners receive new feedback, participants receive batched replies/status, actors do not receive their own activity', async () => {
    const f = await fixture();
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toEqual([f.owner.email]);
    expect(sent[0]!.text).not.toContain('Private source text');
    expect(sent[0]!.text).toContain('Ana (guest) left feedback on #1 (/pricing)');
    expect(sent[0]!.subject).toContain(f.project.name);
    expect(sent[0]!.subject).toContain('#1 (/pricing)');
    expect(sent[0]!.subject).not.toMatch(/tab=|yearly|plans/);
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
    expect(sent[1]!.subject).toContain('3 updates on #1 (/pricing)');
    expect(sent[1]!.text).toContain('replied on #1 (/pricing)');
    expect(sent[1]!.text).toContain('resolved #1 (/pricing)');
    expect(sent[1]!.text).toContain('reopened #1 (/pricing)');
    expect(sent[1]!.text).not.toContain('Team replied');
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
});

test('safe submission retries commit a single notification event with the shared activity cursor', async () => {
    const f = await fixture();
    const input = { text: 'Retryable feedback', origin: 'https://reviewed.example', path: '/retry',
        position: { type: 'page' } as const, kind: 'feedback' as const, authorName: 'Ana', idempotencyKey: randomUUID() };
    const [created, retried] = await Promise.all([
        createProjectComment(request, f.project, f.guest, input),
        createProjectComment(request, f.project, f.guest, input)
    ]);
    expect(retried.id).toBe(created.id);
    expect((await current(created)).notificationEvents).toHaveLength(1);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, created, sent);
    expect(sent).toHaveLength(1);
    await followThread(f.project, f.ownerActor, created.id, true);
    const reply = { text: 'One reply after a lost response', idempotencyKey: randomUUID() };
    await Promise.all([
        replyToProjectComment(request, f.project, f.memberActor, created.id, reply),
        replyToProjectComment(request, f.project, f.memberActor, created.id, reply)
    ]);
    const saved = await current(created);
    expect(saved.thread.items).toHaveLength(2);
    expect(threadActivity(saved).sequence).toBe(2);
    expect(saved.notificationEvents?.map(event => [event.kind, event.sequence])).toEqual([['comment', 1], ['reply', 2]]);
    await dispatch(f.project, created, sent);
    await createProjectComment(request, f.project, f.guest, input);
    await replyToProjectComment(request, f.project, f.memberActor, created.id, reply);
    await dispatch(f.project, created, sent);
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

test('an authorized project creator receives new feedback after an admin role change', async () => {
    const f = await fixture();
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toEqual([f.owner.email]);
});

test('deleting a reply preserves its member participation until explicit unfollow', async () => {
    const f = await fixture();
    const reply = await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'Member participation' });
    await deleteProjectCommentItem(f.project, f.memberActor, f.comment.id, reply.thread.items.at(-1)!.id);
    await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Team follow-up' });
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
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
    const operationId = delivery.attempt!.operationId;
    await retryNotificationDelivery(delivery.id);
    expect((await deliveries(f.project))[0]).toMatchObject({ active: true, status: 'queued', attempt: { operationId } });
    const second = await fixture();
    await discoverThreadNotifications(second.project, second.comment);
    for (let attempt = 0; attempt < 8; attempt++) {
        const queued = (await deliveries(second.project))[0]!;
        await processNotificationDelivery(queued, baseUrl, async () => ({ status: 'failed', code: 'ProviderRejected' }), Date.now() + (attempt + 1) * 4 * 60 * 60 * 1000);
    }
    expect((await deliveries(second.project))[0]).toMatchObject({ active: false, status: 'failed', failures: 8, lastCode: 'ProviderRejected' });
    const failed = (await deliveries(second.project))[0]!;
    await retryNotificationDelivery(failed.id);
    expect((await deliveries(second.project))[0]).toMatchObject({ active: true, failures: 0, status: 'queued' });
});

test('outbox shares the activity cursor and status no-ops do not enqueue duplicates', async () => {
    const f = await fixture();
    const replied = await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'A reply' });
    const resolved = await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, true);
    const noop = await setProjectCommentResolved(f.project, f.ownerActor, f.comment.id, true);
    expect(f.comment.notificationEvents).toEqual([{ sequence: 1, actorId: (f.guest as { visitorId: string }).visitorId, kind: 'comment', at: expect.any(String), itemId: f.comment.thread.items[0]!.id }]);
    expect(replied.notificationEvents?.at(-1)?.sequence).toBe(threadActivity(replied).sequence);
    expect(resolved.notificationEvents?.at(-1)?.sequence).toBe(threadActivity(resolved).sequence);
    expect(noop.notificationEvents).toEqual(resolved.notificationEvents);
    expect(noop.notificationPending).toBe(true);
});

test('targeted activity contract reaches authorized nonparticipants once and respects explicit unfollow', async () => {
    const f = await fixture();
    const recipient = `user:${f.member.id}`;
    const stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, notificationEvents: stored.comment.notificationEvents!.map(event => ({ ...event, recipients: [recipient, recipient] })) }, stored.etag);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
    await followThread(f.project, f.memberActor, f.comment.id, false);
    const current = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    const actorId = `user:${f.owner.id}`;
    await getCommentsStore().replace(withNotificationEvent(withThreadActivity(current.comment, actorId), actorId, 'assignment', undefined, [recipient]), current.etag);
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.member.email)).toHaveLength(1);
});


test('removed source notifications keep member history and never retarget a guest to another origin', async () => {
    const f = await fixture();
    const address = `guest-removed-${f.project.id}@example.com`;
    const follow = await followThread(f.project, f.guest, f.comment.id, true, address, baseUrl);
    const token = new URL(follow.verificationUrl!).searchParams.get('token')!;
    await actOnNotificationToken(token, 'verify');
    await updateDoc<DbProject>(f.project.pk, f.project.id, p => ({ ...p, urls: ['https://replacement.example'] }));
    await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'A reply after removal' });
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.find(message => message.to === f.owner.email)?.text).toContain('environment=removed');
    const guest = sent.find(message => message.to === address)!;
    expect(guest.text).toContain('original site address is unavailable');
    expect(guest.text).toContain('Manage notifications');
    expect(guest.text).not.toContain('replacement.example');
    expect(guest.text).not.toContain('uier-comment=');
});


test('digest summarizes several actors, attributes connectors and only describes unread events', async () => {
    const f = await fixture();
    await followThread(f.project, f.ownerActor, f.comment.id, true);
    await markThreadRead(f.comment, `user:${f.owner.id}`, 1);
    const connector = { ...f.memberActor, agent: { credentialId: 'test-connector', name: 'Code\r\nassistant' } } as ProjectActor;
    await replyToProjectComment(request, f.project, connector, f.comment.id, { text: 'Connector secret' });
    await replyToProjectComment(request, f.project, f.guest, f.comment.id, { text: 'Guest secret', authorName: 'Ana' });
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    const mail = sent.find(message => message.to === f.owner.email)!;
    expect(mail.subject).toBe(`${f.project.name}: 2 updates from 2 people on #1 (/pricing)`);
    expect(mail.text).toContain('via Code assistant replied on #1 (/pricing)');
    expect(mail.text).toContain('Ana (guest) replied on #1 (/pricing)');
    expect(mail.text).not.toContain('left feedback');
    expect(mail.text).not.toContain('secret');
});

test('untrusted guest labels stay bounded, escaped, labeled and outside links', async () => {
    const f = await fixture();
    const stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    const name = 'uier\r\n<img src=x> https://evil.example/' + 'x'.repeat(80);
    await getCommentsStore().replace({ ...stored.comment, thread: { items: [{ ...stored.comment.thread.items[0]!, authorName: name }] } }, stored.etag);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent[0]!.subject).toContain(`uier <img src=x> https://evil.example/${'x'.repeat(21)}… (guest)`);
    expect(sent[0]!.subject).not.toMatch(/[\r\n]/);
    expect(sent[0]!.html).toContain('&lt;img src=x&gt;');
    expect(sent[0]!.html).not.toContain('<img');
    expect(sent[0]!.html).not.toMatch(/<a[^>]*>[^<]*evil/);
});

test('legacy names and missing thread numbers have safe fallbacks and long batches are bounded', async () => {
    const f = await fixture();
    const stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, number: undefined,
        notificationEvents: stored.comment.notificationEvents!.map(({ itemId: _itemId, ...event }) => event) }, stored.etag);
    let sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent[0]!.subject).toBe(`${f.project.name}: Ana (guest) left feedback on /pricing`);
    await followThread(f.project, f.ownerActor, f.comment.id, true);
    for (let i = 0; i < 12; i++) await setProjectCommentResolved(f.project, f.guest, f.comment.id, i % 2 === 0);
    sent = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent[0]!.text).toContain('and 2 more');
    expect(sent[0]!.text.match(/Ana \(guest\)/g)).toHaveLength(10);

    const other = await fixture();
    await followThread(other.project, other.ownerActor, other.comment.id, true);
    await replyToProjectComment(request, other.project, other.memberActor, other.comment.id, { text: 'Unavailable author' });
    await replyToProjectComment(request, other.project, other.guest, other.comment.id, { text: 'Missing guest name' });
    await getAppStore().delete(other.project.pk, memberId(other.member.id));
    const currentThread = (await getCommentsStore().get(other.comment.domain, other.comment.id))!;
    await getCommentsStore().replace({ ...currentThread.comment, thread: { items: currentThread.comment.thread.items.map(item => ({ ...item, authorName: undefined })) } }, currentThread.etag);
    sent = [];
    await dispatch(other.project, other.comment, sent);
    expect(sent[0]!.text).toContain('Guest (guest) replied');
    expect(sent[0]!.text).toContain('Former member replied');
});

test('excerpts opt in only to current item text, including verified guests, never quotes or legacy items', async () => {
    const f = await fixture();
    await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, emailCommentExcerpts: true }));
    const address = `excerpt-guest-${f.project.id}@example.com`;
    const follow = await followThread(f.project, f.guest, f.comment.id, true, address, baseUrl);
    await actOnNotificationToken(new URL(follow.verificationUrl!).searchParams.get('token')!, 'verify');
    const reply = await replyToProjectComment(request, f.project, f.ownerActor, f.comment.id, { text: 'Fresh <reply> ' + 'x'.repeat(200) });
    const latest = (await getCommentsStore().get(reply.domain, reply.id))!;
    await getCommentsStore().replace({ ...latest.comment, thread: { items: latest.comment.thread.items.map(item => ({ ...item, quotedText: 'QUOTED PAGE SECRET' })) } }, latest.etag);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    const mail = sent.find(message => message.to === address)!;
    expect(mail.text).toContain('“Fresh <reply> ' + 'x'.repeat(145) + '…”');
    expect(mail.html).toContain('Fresh &lt;reply&gt;');
    expect(mail.text).not.toContain('QUOTED PAGE SECRET');
    expect(mail.subject).not.toContain('Fresh');
    expect(reply.notificationEvents!.at(-1)).toMatchObject({ itemId: reply.thread.items.at(-1)!.id });
    expect(JSON.stringify(reply.notificationEvents)).not.toContain('Fresh');

    const legacy = await fixture();
    await updateDoc<DbProject>(legacy.project.pk, legacy.project.id, project => ({ ...project, emailCommentExcerpts: true }));
    const stored = (await getCommentsStore().get(legacy.comment.domain, legacy.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, notificationEvents: stored.comment.notificationEvents!.map(({ itemId: _itemId, ...event }) => event) }, stored.etag);
    const legacySent: EmailMessage[] = [];
    await dispatch(legacy.project, legacy.comment, legacySent);
    expect(legacySent[0]!.text).not.toContain('Private source text');
});

for (const change of ['off', 'edit', 'delete', 'read'] as const) {
    test(`new attempts recheck ${change} after preparing excerpts and before the provider request`, async () => {
        const f = await fixture();
        await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, emailCommentExcerpts: true }));
        await followThread(f.project, f.ownerActor, f.comment.id, true);
        await markThreadRead(f.comment, `user:${f.owner.id}`, 1);
        const reply = await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'OLD EXCERPT' });
        const item = reply.thread.items.at(-1)!;
        const store = getAppStore();
        const originalReplace = store.replace;
        let changed = false;
        // The injected storage adapter pauses just after the first message is persisted.
        store.replace = async (doc, etag) => {
            const result = await originalReplace.call(store, doc, etag);
            if (!changed && doc.type === 'notification-delivery' && 'attempt' in doc && doc.attempt) {
                changed = true;
                const ledger = (await deliveries(f.project)).find(delivery => delivery.actorId === `user:${f.owner.id}`)!;
                expect(ledger.attempt!.message.text).toContain('OLD EXCERPT');
                if (change === 'off') await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, emailCommentExcerpts: false }));
                if (change === 'edit') await editProjectCommentItem(f.project, f.memberActor, f.comment.id, item.id, { text: 'NEW EXCERPT', expectedText: item.text });
                if (change === 'delete') await deleteProjectCommentItem(f.project, f.memberActor, f.comment.id, item.id);
                if (change === 'read') await markThreadRead(reply, `user:${f.owner.id}`, threadActivity(reply).sequence);
            }
            return result;
        };
        const sent: EmailMessage[] = [];
        await dispatch(f.project, f.comment, sent, undefined, store);
        expect(changed).toBe(true);
        if (change === 'read') expect(sent).toHaveLength(0);
        else {
            expect(sent).toHaveLength(1);
            expect(sent[0]!.text).not.toContain('OLD EXCERPT');
            expect(sent[0]!.text.includes('NEW EXCERPT')).toBe(change === 'edit');
        }
    });
}

test('reply deleted before sending has no excerpt and a prior-run ambiguous attempt keeps its exact message', async () => {
    const f = await fixture();
    await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, emailCommentExcerpts: true }));
    await followThread(f.project, f.ownerActor, f.comment.id, true);
    const reply = await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'DELETED REPLY' });
    await deleteProjectCommentItem(f.project, f.memberActor, f.comment.id, reply.thread.items.at(-1)!.id);
    const retained = await replyToProjectComment(request, f.project, f.memberActor, f.comment.id, { text: 'RETAINED EXCERPT' });
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent, async message => { sent.push(message); return { status: 'ambiguous' }; });
    expect(sent[0]!.text).not.toContain('DELETED REPLY');
    expect(sent[0]!.text).toContain('RETAINED EXCERPT');
    const ledger = (await deliveries(f.project)).find(delivery => delivery.actorId === `user:${f.owner.id}`)!;
    const message = ledger.attempt!.message;
    await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, emailCommentExcerpts: false }));
    await editProjectCommentItem(f.project, f.memberActor, f.comment.id, retained.thread.items.at(-1)!.id, { text: 'CHANGED LATER', expectedText: 'RETAINED EXCERPT' });
    await retryNotificationDelivery(ledger.id);
    await dispatch(f.project, f.comment, [], async (retried, attempt, isRetry) => {
        expect(isRetry).toBe(true);
        expect(attempt.operationId).toBe(ledger.attempt!.operationId);
        expect(retried).toEqual(message);
        return { status: 'sent' };
    });
});
