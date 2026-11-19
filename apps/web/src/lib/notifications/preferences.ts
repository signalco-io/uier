import { threadRecordTtl } from '../comments/retention';
import { z } from 'zod';
import type { DbProject } from '../app/model';
import { getAppStore, updateDoc } from '../app/store';
import { randomToken, signToken, verifyToken } from '../app/tokens';
import { actorAuthorId, assertCanUseComments, memberActor, type ProjectActor } from '../review/actor';
import { getProjectComment } from '../review/comments';
import { findProject } from '../app/projects';
import { apiErrors } from '../comments/http';
import { consume, APP_COUNTERS_PARTITION } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { sendEmail, showsEmailLinksOnPage } from '../email/send';
import { notificationVerificationEmail } from '../email/templates';
import { KnownPages } from '../../knownPages';
import type { DbComment } from '../db/schema';
import { clearEmailSuppression } from '../email/suppression';

import { notificationPk, notificationPreference, notificationSubscription, preferenceId, subscriptionId, type NotificationPreference, type NotificationSubscription } from './subscriptions';
export { notificationPk, notificationPreference, notificationSubscription, preferenceId, type NotificationPreference, type NotificationSubscription } from './subscriptions';

/** Deleting a message does not implicitly unfollow the thread. */
export function isNotificationParticipant(comment: DbComment, actorId: string) {
    return comment.thread.items.some(item => item.authorId === actorId)
        || Boolean(comment.notificationEvents?.some(event => event.actorId === actorId && (event.kind === 'comment' || event.kind === 'reply')));
}

export async function setProjectMuted(project: DbProject, actor: ProjectActor, muted: boolean) {
    muted = z.boolean().parse(muted);
    if (actor.kind !== 'member' || !await memberActor(project, actor.userId)) throw apiErrors.forbidden();
    const actorId = actorAuthorId(actor)!;
    const doc: NotificationPreference = {
        type: 'notification-preference', id: preferenceId(actorId), pk: notificationPk(project.id),
        projectId: project.id, actorId, muted, version: randomToken()
    };
    if (!await getAppStore().create(doc))
        await updateDoc<NotificationPreference>(doc.pk, doc.id, () => doc);
}

export type ThreadNotificationState = { member: boolean; eligible: boolean; following: boolean; verified: boolean; pending: boolean; muted: boolean };

/** Caller supplies already authorized/visible comments. Two store reads for a whole list. */
export async function threadNotificationStates(project: DbProject, actor: ProjectActor, comments: DbComment[]) {
    const actorId = actorAuthorId(actor);
    if (!actorId) return new Map<string, ThreadNotificationState>();
    const [subscriptions, preference] = await Promise.all([
        getAppStore().query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id), where: { actorId } }),
        notificationPreference(project.id, actorId)
    ]);
    const byThread = new Map(subscriptions.map(subscription => [subscription.threadId, subscription]));
    return new Map(comments.map(comment => {
        const subscription = byThread.get(comment.id);
        const participant = isNotificationParticipant(comment, actorId);
        return [comment.id, { member: actor.kind === 'member', eligible: actor.kind === 'member' || participant,
            following: subscription?.following ?? (actor.kind === 'member' && participant), verified: Boolean(subscription?.verifiedAt),
            pending: Boolean(subscription?.pendingUntil && Date.parse(subscription.pendingUntil) > Date.now()), muted: preference?.muted ?? false }];
    }));
}

export async function threadNotificationState(project: DbProject, actor: ProjectActor, threadId: string) {
    const comment = await getProjectComment(project, actor, threadId);
    if (!comment || !actorAuthorId(actor)) throw apiErrors.notFound();
    return (await threadNotificationStates(project, actor, [comment])).get(threadId)!;
}

type NotificationToken = { projectId: string; id: string; version: string; mode: 'verify' | 'subscription' | 'project' };

export function notificationToken(doc: NotificationSubscription | NotificationPreference, mode: NotificationToken['mode']) {
    return signToken<NotificationToken>('notification', { projectId: doc.projectId, id: doc.id, version: doc.version, mode },
        mode === 'verify' ? 24 * 60 * 60 : 365 * 24 * 60 * 60);
}

export function notificationManageUrl(baseUrl: string, token: string) {
    return `${baseUrl}${KnownPages.Notifications}?token=${encodeURIComponent(token)}`;
}

/** Separate from submitting a comment. No email/account is needed to post. */
export async function followThread(project: DbProject, actor: ProjectActor, threadId: string, following: boolean, email?: string, baseUrl?: string, ipBucket?: string) {
    following = z.boolean().parse(following);
    assertCanUseComments(project, actor);
    const comment = await getProjectComment(project, actor, threadId);
    const actorId = actorAuthorId(actor);
    if (!comment || !actorId) throw apiErrors.notFound();
    if (actor.kind !== 'member' && !isNotificationParticipant(comment, actorId))
        throw apiErrors.forbidden('Leave a comment or reply before subscribing.');
    return saveThreadFollow({ project, actor, comment, following, email, ipBucket,
        verifyUrl: baseUrl ? doc => notificationManageUrl(baseUrl, notificationToken(doc, 'verify')) : undefined,
        showVerificationUrl: showsEmailLinksOnPage() });
}

type FollowInput = {
    project: DbProject; actor: ProjectActor; comment: DbComment; following: boolean; email?: string; ipBucket?: string;
    proof?: Pick<NotificationSubscription, 'proofAssetId' | 'proofShareId' | 'proofEpoch' | 'proofMailbox'>;
    verifyUrl?: (doc: NotificationSubscription) => string;
    showVerificationUrl?: boolean;
};

/** Shared subscription writes. The caller authorizes the thread, actor and optional proof binding. */
export async function saveThreadFollow({ project, actor, comment, following, email, ipBucket, proof, verifyUrl, showVerificationUrl }: FollowInput) {
    const threadId = comment.id;
    const actorId = actorAuthorId(actor)!;
    const old = await notificationSubscription(project.id, actorId, threadId);
    if (actor.kind === 'guest' && following) {
        const parsed = z.email().max(254).safeParse(email?.trim().toLowerCase());
        if (!parsed.success || !verifyUrl) throw apiErrors.invalidRequest('Enter a valid email address.');
        await consumeNotificationEmailLimits(parsed.data, ipBucket, actorId);
        const now = new Date().toISOString();
        const doc: NotificationSubscription = {
            type: 'notification-subscription', id: subscriptionId(actorId, threadId), pk: notificationPk(project.id),
            projectId: project.id, threadId, actorId, following: false, since: now,
            ...proof, email: parsed.data, version: randomToken(), pendingUntil: new Date(Date.now() + 86400000).toISOString(), ttl: threadRecordTtl(comment, 86400)
        };
        if (!await getAppStore().create(doc)) await updateDoc<NotificationSubscription>(doc.pk, doc.id, () => doc);
        const url = verifyUrl(doc);
        try {
            await sendEmail(notificationVerificationEmail({ to: parsed.data, url, proof: Boolean(proof) }));
        } catch (error) {
            if (!proof) throw error;
            console.error('[proof review] Confirmation email could not be sent.');
            throw apiErrors.unavailable('The confirmation email could not be sent. Try again.');
        }
        return { verificationUrl: showVerificationUrl ? url : undefined };
    }
    const doc: NotificationSubscription = {
        type: 'notification-subscription', id: subscriptionId(actorId, threadId), pk: notificationPk(project.id),
        projectId: project.id, threadId, actorId, ...(actor.kind === 'member' ? { userId: actor.userId } : {}),
        following, since: following ? new Date().toISOString() : old?.since ?? new Date().toISOString(), version: randomToken(),
        ttl: threadRecordTtl(comment)
    };
    if (!await getAppStore().create(doc)) await updateDoc<NotificationSubscription>(doc.pk, doc.id, () => doc);
    return {};
}

export async function consumeNotificationEmailLimits(email: string, ipBucket?: string, actorId?: string) {
    const keys = [`notification-address:${email}`, ...(actorId ? [`notification-actor:${actorId}`] : []),
        ...(ipBucket ? [`notification-ip:${ipBucket}`] : [])];
    for (const key of keys) await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key, limit: key.startsWith('notification-ip:') ? 20 : 5, windowSeconds: 3600,
        reason: 'too_fast', message: 'Too many verification emails. Try again later.'
    });
}

export async function confirmThreadFollow(doc: NotificationSubscription, comment: DbComment) {
    const confirmed = await updateDoc<NotificationSubscription>(doc.pk, doc.id, current => {
        const now = new Date().toISOString();
        if (current.version !== doc.version || !current.pendingUntil || current.pendingUntil <= now) throw apiErrors.conflict();
        const { pendingUntil: _pending, ...rest } = current;
        return { ...rest, following: true, verifiedAt: now, since: now, ttl: threadRecordTtl(comment) };
    });
    if (!confirmed) throw apiErrors.notFound();
    if (confirmed.email) await clearEmailSuppression(confirmed.email);
    return confirmed;
}

/** GETs inspect only: mail scanners cannot verify or unsubscribe. Tokens never grant project access. */
export async function inspectNotificationToken(token: unknown) {
    if (typeof token !== 'string') return null;
    const payload = verifyToken<NotificationToken>('notification', token);
    if (!payload || !['verify', 'subscription', 'project'].includes(payload.mode)
        || typeof payload.projectId !== 'string' || typeof payload.id !== 'string' || typeof payload.version !== 'string') return null;
    const doc = (await getAppStore().get<NotificationSubscription | NotificationPreference>(notificationPk(payload.projectId), payload.id))?.doc;
    if (!doc || doc.version !== payload.version) return null;
    if (payload.mode === 'project' ? doc.type !== 'notification-preference' : doc.type !== 'notification-subscription') return null;
    if (payload.mode === 'verify' && (doc.type !== 'notification-subscription' || doc.proofAssetId || !doc.pendingUntil || Date.parse(doc.pendingUntil) <= Date.now())) return null;
    return { payload, doc };
}

export async function actOnNotificationToken(token: unknown, action: 'verify' | 'unsubscribe' | 'mute') {
    const inspected = await inspectNotificationToken(token);
    if (!inspected) throw apiErrors.notFound('This notification link has expired.');
    const { payload, doc } = inspected;
    if (action === 'verify') {
        if (payload.mode !== 'verify' || doc.type !== 'notification-subscription') throw apiErrors.forbidden();
        const project = await findProject(doc.projectId);
        const comment = project && project.access === 'guests' ? await getProjectComment(project, { kind: 'guest', visitorId: doc.actorId }, doc.threadId) : null;
        if (!comment) throw apiErrors.notFound();
        await confirmThreadFollow(doc, comment);
    } else if (action === 'unsubscribe' && payload.mode === 'subscription' && doc.type === 'notification-subscription') {
        const comment = (await getCommentsStore().get(`project:${doc.projectId}`, doc.threadId))?.comment;
        if (!comment) { await getAppStore().delete(doc.pk, doc.id); return; }
        await updateDoc<NotificationSubscription>(doc.pk, doc.id, current => {
            if (current.version !== doc.version) throw apiErrors.conflict();
            const { email: _email, verifiedAt: _verified, pendingUntil: _pending, proofMailbox: _mailbox, ...rest } = current;
            return { ...rest, following: false, ...(current.proofAssetId ? { version: randomToken() } : {}), ttl: threadRecordTtl(comment) };
        });
    } else if (action === 'mute' && payload.mode === 'project' && doc.type === 'notification-preference') {
        await updateDoc<NotificationPreference>(doc.pk, doc.id, current => {
            if (current.version !== doc.version) throw apiErrors.conflict();
            return { ...current, muted: true };
        });
    } else throw apiErrors.forbidden();
}
