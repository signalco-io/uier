import { threadRecordTtl } from '../comments/retention';
import { feedbackSource } from '../app/environments';
import { commentPath } from '../comments/dto';
import { randomUUID } from 'node:crypto';
import type { AppDoc, DbProject } from '../app/model';
import { getAppStore, updateDoc } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { getUser } from '../app/users';
import { getMember, listWorkspaceMembers } from '../app/workspaces';
import { hasProjectAccess, loadWorkspaceAccess } from '../app/access';
import { findProject } from '../app/projects';
import { memberActor, type ProjectActor } from '../review/actor';
import { canSeeComment } from '../review/comments';
import { participantNames } from '../review/dto';
import { digestContent } from './digest';
import type { DbComment } from '../db/schema';
import { getCommentsStore } from '../repo/commentsStore';
import { getReadSequence } from '../comments/readState';
import { layoutEmail } from '../email/templates';
import { KnownPages, KnownPageLinks } from '../../knownPages';
import { isNotificationParticipant, notificationManageUrl, notificationPk, notificationPreference, notificationSubscription, notificationToken,
    preferenceId, type NotificationPreference, type NotificationSubscription } from './preferences';
import { deliverNotificationEmail, type EmailAttempt } from './transport';
import { EmailNotConfiguredError, type EmailMessage } from '../email/send';
import { emailSuppression } from '../email/suppression';

export const DIGEST_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 8;
export const COMPLETED_DELIVERY_TTL = 30 * 24 * 60 * 60;

/** Atomic outbox entries on the comment, using #83's thread sequence. No copied message content. */
export type NotificationEvent = { sequence: number; actorId: string; kind: 'comment' | 'reply' | 'resolved' | 'reopened' | 'mention' | 'assignment'; at: string; recipients?: string[]; agent?: import('../db/schema').AgentSource; itemId?: string; assigneeId?: string | null };

export type NotificationDelivery = AppDoc & {
    type: 'notification-delivery'; projectId: string; threadId: string; actorId: string; userId?: string;
    requestedThrough: number; processedThrough: number; active: boolean;
    failures: number; nextAttemptAt: string;
    lease?: { id: string; until: string };
    attempt?: EmailAttempt & { through: number; message: EmailMessage };
    status: 'queued' | 'waiting' | 'accepted' | 'suppressed' | 'failed' | 'ambiguous';
    lastCode?: string;
    lastOperationId?: string;
};

const deliveryId = (threadId: string, actorId: string) => `delivery_${sha256Hex(`${threadId}:${actorId}`)}`;
const iso = (time = Date.now()) => new Date(time).toISOString();
const failureCode = (code: string | undefined) => code && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'UnknownProviderError';

/** Crash-safe discovery: clear the comment's pending flag only after all ledgers exist. */
export async function discoverThreadNotifications(project: DbProject, comment: DbComment) {
    const store = getAppStore();
    const recipients = new Map<string, string | undefined>();
    const [members, access] = await Promise.all([listWorkspaceMembers(project.workspaceId), loadWorkspaceAccess(project.workspaceId)]);
    const subscriptions = await store.query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id), where: { threadId: comment.id } });
    for (const member of members) {
        const actorId = `user:${member.userId}`;
        if (hasProjectAccess(access, member, project) && (member.role === 'admin' || member.userId === project.createdBy
            || isNotificationParticipant(comment, actorId)
            || subscriptions.some(sub => sub.actorId === actorId && sub.following))) recipients.set(actorId, member.userId);
    }
    for (const subscription of subscriptions) if (!subscription.userId && subscription.following && subscription.verifiedAt)
        recipients.set(subscription.actorId, undefined);
    // #91 can target existing authorized members; dispatch still checks mute, follow and visibility.
    for (const event of comment.notificationEvents ?? []) for (const actorId of event.recipients ?? []) {
        const member = members.find(member => actorId === `user:${member.userId}` && hasProjectAccess(access, member, project));
        if (member) recipients.set(actorId, member.userId);
    }
    const requestedThrough = Math.max(0, ...(comment.notificationEvents ?? []).map(event => event.sequence));
    for (const [actorId, userId] of recipients) {
        const doc: NotificationDelivery = { type: 'notification-delivery', id: deliveryId(comment.id, actorId), pk: notificationPk(project.id),
            projectId: project.id, threadId: comment.id, actorId, ...(userId ? { userId } : {}),
            requestedThrough, processedThrough: comment.notificationDiscoveredThrough ?? 0, active: true, failures: 0, nextAttemptAt: iso(), status: 'queued',
            ttl: threadRecordTtl(comment) };
        if (!await store.create(doc)) await updateDoc<NotificationDelivery>(doc.pk, doc.id, old => {
            const active = old.status !== 'failed' && old.status !== 'ambiguous' && (old.active || requestedThrough > old.processedThrough);
            return { ...old, requestedThrough: Math.max(old.requestedThrough, requestedThrough), active,
                ttl: threadRecordTtl(comment, !active && ['accepted', 'suppressed'].includes(old.status) ? COMPLETED_DELIVERY_TTL : -1) };
        });
    }
    const comments = getCommentsStore();
    const current = await comments.get(comment.domain, comment.id);
    if (current && Math.max(0, ...(current.comment.notificationEvents ?? []).map(event => event.sequence)) === requestedThrough)
        await comments.replace({ ...current.comment, notificationPending: false, notificationDiscoveredThrough: requestedThrough }, current.etag);
}

async function recipientContext(delivery: NotificationDelivery) {
    const project = await findProject(delivery.projectId);
    if (!project || project.access === 'disabled') return null;
    const actor: ProjectActor | null = delivery.userId ? await memberActor(project, delivery.userId)
        : project.access === 'guests' ? { kind: 'guest', visitorId: delivery.actorId } : null;
    if (!actor) return null;
    const comment = (await getCommentsStore().get(`project:${project.id}`, delivery.threadId))?.comment;
    if (!comment || !canSeeComment(comment, actor)) return null;
    const [subscription, preference, readSequence] = await Promise.all([
        notificationSubscription(project.id, delivery.actorId, comment.id), notificationPreference(project.id, delivery.actorId),
        getReadSequence(comment.domain, delivery.actorId, comment.id)
    ]);
    const user = delivery.userId ? await getUser(delivery.userId) : null;
    const member = delivery.userId ? await getMember(project.workspaceId, delivery.userId) : null;
    if (preference?.muted || (actor.kind === 'guest' && (!subscription?.following || !subscription.verifiedAt || !subscription.email))) return null;
    return { project, comment, actor, subscription, preference, readSequence, memberSince: member?.createdAt, email: user?.email ?? subscription?.email };
}

function eligibleEvents(delivery: NotificationDelivery, context: NonNullable<Awaited<ReturnType<typeof recipientContext>>>) {
    const { comment, actor, subscription, readSequence } = context;
    return (comment.notificationEvents ?? []).filter(event => event.sequence > delivery.processedThrough && event.sequence <= delivery.requestedThrough
        && event.sequence > readSequence && event.actorId !== delivery.actorId
        && subscription?.following !== false
        && (!context.memberSince || event.at >= context.memberSince)
        && (!subscription?.since || event.at >= subscription.since)
        && (event.kind === 'comment' ? actor.kind === 'member' && (actor.isAdmin || actor.userId === context.project.createdBy || event.recipients?.includes(delivery.actorId))
            : event.kind === 'mention' || event.kind === 'assignment' ? Boolean(event.recipients?.includes(delivery.actorId))
                : subscription?.following ?? (actor.kind === 'member' && (isNotificationParticipant(comment, delivery.actorId)
                    || event.recipients?.includes(delivery.actorId)))));
}

async function digestMessage(baseUrl: string, delivery: NotificationDelivery, context: NonNullable<Awaited<ReturnType<typeof recipientContext>>>, batch: NotificationEvent[]) {
    const { project, comment } = context;
    let manage: NotificationSubscription | NotificationPreference | undefined = context.subscription;
    let mode: 'subscription' | 'project' = 'subscription';
    if (!manage) {
        mode = 'project';
        manage = context.preference;
        if (!manage) {
            const preference: NotificationPreference = { type: 'notification-preference', pk: notificationPk(project.id), id: preferenceId(delivery.actorId),
                projectId: project.id, actorId: delivery.actorId, muted: false, version: randomUUID() };
            await getAppStore().create(preference);
            manage = (await notificationPreference(project.id, delivery.actorId))!;
        }
    }
    const source = feedbackSource(project, comment.origin);
    const token = notificationToken(manage, mode);
    const manageUrl = notificationManageUrl(baseUrl, token);
    const unsubscribeUrl = `${baseUrl}${KnownPages.NotificationUnsubscribe}?token=${encodeURIComponent(token)}`;
    let url = delivery.userId ? `${baseUrl}${KnownPageLinks.project(project.id)}?environment=${source.environment}` : manageUrl;
    if (source.available && source.origin) {
        const page = new URL(commentPath(comment), source.origin);
        if (page.origin !== source.origin) throw new Error('Invalid notification page origin');
        if (delivery.userId) url = `${baseUrl}${KnownPageLinks.projectReview(project.id, page.toString(), comment.id)}`;
        else {
            page.searchParams.set('toolbar-code', project.publicId);
            page.searchParams.set('uier-comment', comment.id);
            url = page.toString();
        }
    }
    const content = digestContent(project, comment, delivery.actorId, batch, await participantNames(project));
    return { ...layoutEmail({ to: context.email!, subject: content.subject,
        paragraphs: [...content.lines,
            source.available ? 'Open the thread to read the latest feedback, replies and status changes.' : 'The original site address is unavailable. Project members can read the feedback in the app history.'],
        action: { label: source.available ? 'Open thread' : delivery.userId ? 'Open feedback history' : 'Manage notifications', url }, footnote: 'Related activity is batched for 5 minutes. Activity you have read is skipped.',
        footerAction: { label: mode === 'project' ? 'Manage project emails' : 'Unsubscribe from thread', url: manageUrl } }), headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        } };
}

/** One bounded attempt under an optimistic lease; all state survives process restarts. */
export async function processNotificationDelivery(candidate: NotificationDelivery, baseUrl: string, transport = deliverNotificationEmail, now = Date.now(), store = getAppStore()) {
    const stored = await store.get<NotificationDelivery>(candidate.pk, candidate.id);
    if (!stored || !stored.doc.active || Date.parse(stored.doc.nextAttemptAt) > now || (stored.doc.lease && Date.parse(stored.doc.lease.until) > now)) return;
    const lease = { id: randomUUID(), until: iso(now + 5 * 60 * 1000) };
    const delivery = { ...stored.doc, lease };
    if (await store.replace(delivery, stored.etag) !== 'ok') return;
    const thread = (await getCommentsStore().get(`project:${delivery.projectId}`, delivery.threadId))?.comment;
    const save = async (patch: Partial<NotificationDelivery>) => updateDoc<NotificationDelivery>(delivery.pk, delivery.id, current => {
        if (current.lease?.id !== lease.id) throw new Error('Notification lease lost');
        const { lease: _lease, ...rest } = current;
        const saved = { ...rest, ...patch };
        if (patch.status === 'accepted' && current.lastCode?.startsWith('ACSReport_')) saved.lastCode = current.lastCode;
        if (saved.status !== 'failed' && saved.status !== 'ambiguous')
            saved.active = Boolean(saved.attempt) || current.requestedThrough > saved.processedThrough;
        saved.ttl = threadRecordTtl(thread ?? { ttl: -1 } as DbComment,
            !saved.active && saved.processedThrough >= saved.requestedThrough && ['accepted', 'suppressed'].includes(saved.status) ? COMPLETED_DELIVERY_TTL : -1);
        return saved;
    }, store);
    try {
        const context = await recipientContext(delivery);
        const events = context ? eligibleEvents(delivery, context) : [];
        if (!context?.email || !events.length) {
            await save({ processedThrough: delivery.requestedThrough, attempt: undefined, active: false, status: 'suppressed' });
            return;
        }
        if (await emailSuppression(context.email, store)) {
            await save({ processedThrough: delivery.requestedThrough, attempt: undefined, active: false, status: 'suppressed', lastCode: 'address_suppressed' });
            return;
        }
        const due = Date.parse(events[0]!.at) + DIGEST_WINDOW_MS;
        if (!delivery.attempt && now < due) { await save({ nextAttemptAt: iso(due), status: 'waiting' }); return; }
        const through = delivery.attempt?.through ?? Math.max(...events.filter(event => Date.parse(event.at) <= due).map(event => event.sequence));
        const batch = events.filter(event => event.sequence <= through);
        // A cursor may advance between retries; cancel any unsent content that's now seen.
        if (!batch.length) { await save({ processedThrough: through, attempt: undefined, active: true, nextAttemptAt: iso(), status: 'suppressed' }); return; }
        let attempt = delivery.attempt ?? { operationId: randomUUID(), firstSentAt: iso(now), through,
            message: await digestMessage(baseUrl, delivery, context, batch) };
        // Persist before the external request, including its exact body and repeatability identity.
        await updateDoc<NotificationDelivery>(delivery.pk, delivery.id, current => {
            if (current.lease?.id !== lease.id) throw new Error('Notification lease lost');
            return { ...current, attempt, lastOperationId: attempt.operationId, ...(!delivery.attempt ? { lastCode: undefined } : {}) };
        }, store);
        // Preparing a digest does several reads/writes. Check once more at the send boundary.
        const latest = await recipientContext(delivery);
        if (!latest?.email || latest.email !== attempt.message.to || !eligibleEvents(delivery, latest).some(event => event.sequence <= through)) {
            await save({ processedThrough: through, attempt: undefined, active: false, status: 'suppressed' });
            return;
        }
        // A newly prepared operation has not reached the provider yet. Reloaded items and
        // settings replace its content (including edits/deletions); prior-run operations must
        // retain their exact persisted message for ACS repeatability and reconciliation.
        if (!delivery.attempt) {
            const latestBatch = eligibleEvents(delivery, latest).filter(event => event.sequence <= through);
            attempt = { ...attempt, message: await digestMessage(baseUrl, delivery, latest, latestBatch) };
            await updateDoc<NotificationDelivery>(delivery.pk, delivery.id, current => {
                if (current.lease?.id !== lease.id) throw new Error('Notification lease lost');
                return { ...current, attempt };
            }, store);
        }
        if (await emailSuppression(attempt.message.to, store)) {
            await save({ processedThrough: delivery.requestedThrough, attempt: undefined, active: false, status: 'suppressed', lastCode: 'address_suppressed' });
            return;
        }
        const result = await transport(attempt.message, attempt, Boolean(delivery.attempt));
        if (result.status === 'sent') {
            await save({ processedThrough: through, attempt: undefined, active: true, failures: 0, nextAttemptAt: iso(), status: 'accepted', lastCode: result.code });
        } else if (result.status === 'ambiguous') {
            await save({ active: false, status: 'ambiguous', lastCode: failureCode(result.code) });
            console.error(`[notifications] ${delivery.id}: ambiguous (${failureCode(result.code)})`);
        } else if (result.status === 'failed') {
            const failures = delivery.failures + 1;
            await save({ failures, attempt: undefined, active: failures < MAX_FAILURES, status: failures < MAX_FAILURES ? 'queued' : 'failed',
                nextAttemptAt: iso(now + Math.min(3600000, 60000 * 2 ** failures)), lastCode: failureCode(result.code) });
            console.error(`[notifications] ${delivery.id}: provider rejected (${failureCode(result.code)})`);
        } else await save({ attempt: { ...attempt, resumeFrom: result.resumeFrom }, nextAttemptAt: iso(now + 60000), status: 'waiting' });
    } catch (error) {
        const failures = delivery.failures + 1;
        // Error messages from providers may contain personal data. Store only a bounded class name.
        const code = error instanceof Error ? failureCode(error.name) : 'UnknownError';
        await save({ failures, active: failures < MAX_FAILURES, status: failures < MAX_FAILURES ? 'queued' : 'failed', lastCode: code,
            ...(error instanceof EmailNotConfiguredError ? { attempt: undefined } : {}),
            nextAttemptAt: iso(now + Math.min(3600000, 60000 * 2 ** failures)) });
        console.error(`[notifications] ${delivery.id}: attempt failed (${code})`);
    }
}

export async function runNotificationWorker(baseUrl: string, transport = deliverNotificationEmail, store = getAppStore()) {
    // Adopt expiry for old completed ledgers in bounded batches. Preserve a replay floor before
    // making any pre-checkpoint ledger eligible to expire; an etag race retries on the next run.
    for (const status of ['accepted', 'suppressed']) {
        for (const old of await store.query<NotificationDelivery>({ type: 'notification-delivery',
            where: { active: false, status }, missingTtl: true, limit: 100 })) {
            if (old.attempt || old.processedThrough < old.requestedThrough) continue;
            const comments = getCommentsStore();
            const thread = await comments.get(`project:${old.projectId}`, old.threadId);
            if (thread && await comments.replace({ ...thread.comment,
                notificationDiscoveredThrough: Math.max(thread.comment.notificationDiscoveredThrough ?? 0, old.requestedThrough)
            }, thread.etag) !== 'ok') continue;
            await updateDoc<NotificationDelivery>(old.pk, old.id, current => {
                if (current.active || current.attempt || current.processedThrough < current.requestedThrough
                    || !['accepted', 'suppressed'].includes(current.status)) return current;
                return { ...current, ttl: thread ? threadRecordTtl(thread.comment, COMPLETED_DELIVERY_TTL) : COMPLETED_DELIVERY_TTL };
            }, store);
        }
    }
    for (const comment of await getCommentsStore().listNotificationPending()) {
        if (!comment.projectId) continue;
        const project = await findProject(comment.projectId);
        if (project) await discoverThreadNotifications(project, comment);
    }
    const deliveries = await store.query<NotificationDelivery>({ type: 'notification-delivery', where: { active: true } });
    for (const delivery of deliveries) await processNotificationDelivery(delivery, baseUrl, transport, Date.now(), store);
    const blocked = await Promise.all(['failed', 'ambiguous'].map(status =>
        store.query<NotificationDelivery>({ type: 'notification-delivery', where: { active: false, status } })));
    return { checked: deliveries.length, blocked: blocked.reduce((count, rows) => count + rows.length, 0) };
}

/** Manual workflow recovery. An uncertain send keeps its operation identity and is only reconciled. */
export async function retryNotificationDelivery(id: string) {
    if (!/^delivery_[a-f0-9]{64}$/.test(id)) throw new Error('Invalid notification delivery id.');
    const [delivery] = await getAppStore().query<NotificationDelivery>({ type: 'notification-delivery', where: { id } });
    if (!delivery || (delivery.status !== 'failed' && delivery.status !== 'ambiguous')) throw new Error('This delivery does not need manual recovery.');
    await updateDoc<NotificationDelivery>(delivery.pk, delivery.id, current => {
        if (current.lease && Date.parse(current.lease.until) > Date.now()) throw new Error('This delivery is still leased.');
        return { ...current, active: true, failures: 0, status: 'queued', nextAttemptAt: iso() };
    });
}
