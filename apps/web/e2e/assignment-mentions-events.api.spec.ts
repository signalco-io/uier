import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, editProjectCommentItem, replyToProjectComment, setProjectCommentAssignee, setProjectCommentPrivate } from '../src/lib/review/comments';
import { memberActor } from '../src/lib/review/actor';
import { readActivity, threadActivity } from '../src/lib/comments/activity';
import { markThreadRead } from '../src/lib/comments/readState';
import { discoverThreadNotifications, processNotificationDelivery, type NotificationDelivery } from '../src/lib/notifications/delivery';
import { followThread, notificationPk, setProjectMuted } from '../src/lib/notifications/preferences';
import type { EmailMessage } from '../src/lib/email/send';
import type { DbComment } from '../src/lib/db/schema';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
const now = () => Date.now() + 30 * 60 * 1000;
const request = new Request('http://127.0.0.1/api/review');

async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`assignment-owner-${id}@example.com`);
    const a = await findOrCreateUser(`assignment-a-${id}@example.com`);
    const b = await findOrCreateUser(`assignment-b-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const old = '2026-01-01T00:00:00.000Z';
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Assignments ${id}`, urls: ['https://reviewed.example'],
        status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [user, role] of [[owner, 'admin'], [a, 'commenter'], [b, 'commenter']] as const)
        await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id, email: user.email, role, projects: 'all', createdAt: old });
    const actor = (await memberActor(project, owner.id))!;
    const aActor = (await memberActor(project, a.id))!;
    const bActor = (await memberActor(project, b.id))!;
    const mention = { userId: a.id, start: 0, end: 5 };
    const comment = await createProjectComment(request, project, actor, { text: '@Alex please check', mentions: [mention], origin: project.urls[0]!,
        path: '/pricing', pageStateVersion: 1, position: { type: 'page' }, kind: 'feedback' });
    return { project, owner, a, b, actor, aActor, bActor, mention, comment };
}

async function current(comment: DbComment) { return (await getCommentsStore().get(comment.domain, comment.id))!.comment; }
async function dispatch(project: DbProject, comment: DbComment, sent: EmailMessage[]) {
    await discoverThreadNotifications(project, await current(comment));
    const deliveries = await getAppStore().query<NotificationDelivery>({ type: 'notification-delivery', pk: notificationPk(project.id) });
    for (const delivery of deliveries) await processNotificationDelivery(delivery, 'https://uier.io', async message => {
        sent.push(message); return { status: 'sent' };
    }, now());
}

test('mentions reach selected nonparticipants once; assignment and reply mentions share unread/digest suppression', async () => {
    const f = await fixture();
    expect(readActivity(f.comment, `user:${f.owner.id}`).unread).toBe(false);
    expect(readActivity(f.comment, `user:${f.a.id}`).unread).toBe(true);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toEqual([f.a.email]);
    expect(f.comment.notificationEvents).toHaveLength(1);
    expect(f.comment.notificationEvents![0]).toMatchObject({ kind: 'comment', recipients: [`user:${f.a.id}`] });
    expect(sent[0]!.text).not.toContain('@Alex please check');
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(1);
    await followThread(f.project, f.aActor, f.comment.id, true);
    const assigned = await setProjectCommentAssignee(f.project, f.actor, f.comment.id, f.a.id);
    const assignedSequence = threadActivity(assigned).sequence;
    // Optimistic retries and a repeated selection do not manufacture another assignment event.
    const repeated = await Promise.all([setProjectCommentAssignee(f.project, f.actor, f.comment.id, f.a.id), setProjectCommentAssignee(f.project, f.actor, f.comment.id, f.a.id)]);
    expect(repeated.map(comment => threadActivity(comment).sequence)).toEqual([assignedSequence, assignedSequence]);
    await replyToProjectComment(request, f.project, f.actor, f.comment.id, { text: '@Alex follow-up', mentions: [f.mention] });
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to)).toEqual([f.a.email, f.a.email]);
    // A reply targeted by a mention is one update, even when both event kinds share the same cursor.
    const events = (await current(f.comment)).notificationEvents!;
    expect(events).toHaveLength(3);
    expect(new Set(events.map(event => event.sequence)).size).toBe(3);
    expect(events.at(-1)).toMatchObject({ kind: 'reply', recipients: [`user:${f.a.id}`] });
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
    const selfAssigned = await setProjectCommentAssignee(f.project, f.aActor, f.comment.id, f.a.id);
    await markThreadRead(selfAssigned, `user:${f.a.id}`, threadActivity(selfAssigned).sequence);
    await setProjectCommentAssignee(f.project, f.actor, f.comment.id, null);
    const latest = await current(f.comment);
    await markThreadRead(latest, `user:${f.a.id}`, threadActivity(latest).sequence);
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
});

test('targeted mention and assignment email respects mute, explicit unfollow, private visibility and removed access', async () => {
    const muted = await fixture();
    await setProjectMuted(muted.project, muted.aActor, true);
    await setProjectCommentAssignee(muted.project, muted.actor, muted.comment.id, muted.a.id);
    const sent: EmailMessage[] = [];
    await dispatch(muted.project, muted.comment, sent);
    expect(sent).toHaveLength(0);

    const unfollowed = await fixture();
    await followThread(unfollowed.project, unfollowed.aActor, unfollowed.comment.id, false);
    await setProjectCommentAssignee(unfollowed.project, unfollowed.actor, unfollowed.comment.id, unfollowed.a.id);
    await dispatch(unfollowed.project, unfollowed.comment, sent);
    expect(sent).toHaveLength(0);

    const privateThread = await fixture();
    await setProjectCommentAssignee(privateThread.project, privateThread.actor, privateThread.comment.id, privateThread.a.id);
    await discoverThreadNotifications(privateThread.project, await current(privateThread.comment));
    await setProjectCommentPrivate(privateThread.project, privateThread.actor, privateThread.comment.id, true);
    await dispatch(privateThread.project, privateThread.comment, sent);
    expect(sent).toHaveLength(0);
    expect((await current(privateThread.comment)).assigneeId).toBeUndefined();

    const removed = await fixture();
    await setProjectCommentAssignee(removed.project, removed.actor, removed.comment.id, removed.a.id);
    await discoverThreadNotifications(removed.project, await current(removed.comment));
    await getAppStore().delete(removed.project.pk, memberId(removed.a.id));
    await dispatch(removed.project, removed.comment, sent);
    expect(sent).toHaveLength(0);
    expect(await memberActor(removed.project, removed.a.id)).toBeNull();
});

test('editing a retained mention is quiet; selecting a different stable identity creates one new activity', async () => {
    const f = await fixture();
    const first = f.comment.thread.items[0]!;
    const initialSequence = threadActivity(f.comment).sequence;
    const retained = await editProjectCommentItem(f.project, f.actor, f.comment.id, first.id, { text: '@Alex please check again', expectedText: first.text, mentions: [f.mention] });
    expect(threadActivity(retained).sequence).toBe(initialSequence);
    const changed = await editProjectCommentItem(f.project, f.actor, f.comment.id, first.id, { text: '@Alex please check again', expectedText: '@Alex please check again', mentions: [{ ...f.mention, userId: f.b.id }] });
    expect(threadActivity(changed).sequence).toBe(initialSequence + 1);
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    expect(sent.map(message => message.to).sort()).toEqual([f.a.email, f.b.email].sort());
    await dispatch(f.project, f.comment, sent);
    expect(sent).toHaveLength(2);
});

test('self-assignment and self-mentions do not create unread or email for their actor', async () => {
    const f = await fixture();
    const sent: EmailMessage[] = [];
    await dispatch(f.project, f.comment, sent);
    const seen = threadActivity(f.comment).sequence;
    await markThreadRead(f.comment, `user:${f.a.id}`, seen);
    const assigned = await setProjectCommentAssignee(f.project, f.aActor, f.comment.id, f.a.id);
    expect(readActivity(assigned, `user:${f.a.id}`, seen).unread).toBe(false);
    await markThreadRead(assigned, `user:${f.b.id}`, threadActivity(assigned).sequence);
    const replied = await replyToProjectComment(request, f.project, f.bActor, f.comment.id, { text: '@Self follow-up', mentions: [{ userId: f.b.id, start: 0, end: 5 }] });
    expect(readActivity(replied, `user:${f.b.id}`, threadActivity(assigned).sequence).unread).toBe(false);
    await dispatch(f.project, f.comment, sent);
    expect(sent.filter(message => message.to === f.a.email)).toHaveLength(1);
    expect(sent.filter(message => message.to === f.b.email)).toHaveLength(0);
});

test('durable retries preserve selected identities and one cursor after losing the database acknowledgement', async () => {
    const f = await fixture();
    const store = getCommentsStore();
    const original = store.commitSubmission;
    let drop = true;
    store.commitSubmission = async (...args) => {
        const result = await original(...args);
        if (drop && result === 'ok') { drop = false; throw new Error('Lost database acknowledgement'); }
        return result;
    };
    try {
        const input = { text: '@Alex retry', mentions: [f.mention], idempotencyKey: randomUUID().replaceAll('-', '') };
        const saved = await replyToProjectComment(request, f.project, f.actor, f.comment.id, input);
        const repeated = await replyToProjectComment(request, f.project, f.actor, f.comment.id, input);
        expect(repeated.thread.items).toHaveLength(2);
        expect(repeated.thread.items[1]!.mentions).toEqual([f.mention]);
        expect(threadActivity(repeated).sequence).toBe(threadActivity(saved).sequence);
        expect(repeated.notificationEvents).toHaveLength(2);
        await expect(replyToProjectComment(request, f.project, f.actor, f.comment.id, { ...input, mentions: [{ ...f.mention, userId: f.b.id }] })).rejects.toMatchObject({ code: 'conflict' });
        drop = true;
        const createInput = { text: '@Alex retry', mentions: [f.mention], idempotencyKey: randomUUID().replaceAll('-', ''),
            origin: f.project.urls[0]!, path: '/pricing', position: { type: 'page' as const }, kind: 'feedback' as const };
        const created = await createProjectComment(request, f.project, f.actor, createInput);
        const replayed = await createProjectComment(request, f.project, f.actor, createInput);
        expect(replayed.id).toBe(created.id);
        expect(replayed.notificationEvents).toHaveLength(1);
        expect(replayed.thread.items[0]!.mentions).toEqual([f.mention]);
    } finally { store.commitSubmission = original; }
});
