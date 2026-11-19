import { z } from 'zod';
import type { DbProject } from '../app/model';
import { getAppStore } from '../app/store';
import { keyedHash, isLocalRuntime } from '../comments/environment';
import { apiErrors } from '../comments/http';
import { proofReviewRecoveryEmail } from '../email/templates';
import { sendEmail } from '../email/send';
import { confirmThreadFollow, consumeNotificationEmailLimits, saveThreadFollow } from '../notifications/preferences';
import { notificationPk, notificationSubscription, type NotificationSubscription } from '../notifications/subscriptions';
import { getProjectComment } from '../review/comments';
import { liveProofFollow, proofProject, proofReturningCookie, verifiedProofFollow } from './access';
import { proofFollowLifetime, proofRecoveryLifetime, proofReturningLink, readProofReturningLink } from './returningLink';
import { proofEpoch, proofNotFound, proofStore } from './store';
import { authorizeProofThread, type ProofThreadRoute } from './threadAccess';
import { proofThreadPath } from './threadModel';

const mailboxHash = (projectId: string, assetId: string, email: string) =>
    keyedHash('proof-follow-mailbox', JSON.stringify([projectId, assetId, email]));
const emailSchema = z.preprocess(value => typeof value === 'string' ? value.trim().toLowerCase() : value, z.email().max(254));

async function proofFollowContext(request: Request, route: ProofThreadRoute & { threadId: string }) {
    const { project, actor, permissions } = await authorizeProofThread(request, route);
    const comment = await getProjectComment(project, actor, route.threadId);
    if (!comment || actor.kind !== 'guest' || permissions.kind !== 'guest' || !permissions.comment || comment.authorId !== actor.visitorId
        || comment.assetTarget?.authorShareId !== permissions.shareId || !comment.thread.items[0] || comment.thread.items[0].deletedAt)
        throw proofNotFound();
    const proofEpochId = proofEpoch((await proofStore(project.id).guard())?.doc);
    return { project, actor, comment, proof: { proofAssetId: route.assetId, proofShareId: permissions.shareId, proofEpoch: proofEpochId } };
}

export async function proofFollowState(request: Request, route: ProofThreadRoute & { threadId: string }) {
    const { project, actor, comment, proof } = await proofFollowContext(request, route);
    const subscription = await notificationSubscription(project.id, actor.visitorId, comment.id);
    if (subscription?.proofShareId !== proof.proofShareId || subscription?.proofEpoch !== proof.proofEpoch)
        return { following: false, pending: false };
    return { following: verifiedProofFollow(subscription), pending: Boolean(subscription.pendingUntil && Date.parse(subscription.pendingUntil) > Date.now()) };
}

export async function setProofFollow(request: Request, route: ProofThreadRoute & { threadId: string }, following: boolean, rawEmail: string | undefined,
    baseUrl: string, ipBucket?: string) {
    const { project, actor, comment, proof } = await proofFollowContext(request, route);
    if (!following) return saveThreadFollow({ project, actor, comment, following, proof });
    const email = emailSchema.safeParse(rawEmail);
    if (!email.success) throw apiErrors.invalidRequest('Enter a valid email address.');
    return saveThreadFollow({ project, actor, comment, following, email: email.data, ipBucket,
        proof: { ...proof, proofMailbox: mailboxHash(project.id, route.assetId, email.data) },
        verifyUrl: doc => proofReturningLink(baseUrl, route.projectId, doc, comment.assetTarget!.source.versionId, 'confirm', proofFollowLifetime),
        showVerificationUrl: isLocalRuntime() && !process.env.ACS_CONNECTION_STRING });
}

export async function openProofReview(route: ProofThreadRoute, token: string) {
    const link = readProofReturningLink(token);
    const unavailable = () => apiErrors.notFound('This file review link has expired or is unavailable.');
    if (!link || link.assetId !== route.assetId) throw unavailable();
    const project = await proofProject(route.projectId);
    if (link.projectId !== project.id) throw unavailable();
    const stored = (await getAppStore().get<NotificationSubscription>(notificationPk(project.id), link.subscriptionId))?.doc;
    if (stored?.type !== 'notification-subscription' || stored.version !== link.subscriptionVersion || stored.proofAssetId !== route.assetId)
        throw unavailable();
    const binding = await liveProofFollow(project, stored);
    const version = (await proofStore(project.id).version(link.versionId))?.doc;
    if (!binding || version?.assetId !== route.assetId || version.status !== 'published') throw unavailable();
    const { verification, resolved, archivedAt } = binding.comment;
    if (link.verificationId && (resolved || archivedAt || project.verificationEnabled !== true || verification?.id !== link.verificationId
        || verification.outcome !== 'pending' || verification.reviewer !== stored.actorId || verification.evidence?.after.versionId !== version.id))
        throw unavailable();
    let subscription = stored;
    if (link.action === 'confirm') {
        if (!stored.email || !stored.proofMailbox || !stored.pendingUntil || Date.parse(stored.pendingUntil) <= Date.now()) throw unavailable();
        subscription = await confirmThreadFollow(stored, binding.comment);
    } else if (!verifiedProofFollow(stored)) throw unavailable();
    return { cookie: proofReturningCookie(subscription, binding.share),
        href: proofThreadPath(project.publicId ?? project.id, route.assetId, version.id, stored.threadId) };
}

export async function prepareProofRecovery(rawEmail: string, ipBucket?: string) {
    const email = emailSchema.safeParse(rawEmail);
    if (!email.success) throw apiErrors.invalidRequest('Enter a valid email address.');
    // Apply the same budget before looking for a match, regardless of the file or mailbox.
    await consumeNotificationEmailLimits(email.data, ipBucket);
    return email.data;
}

async function recoverableProofFollows(project: DbProject, assetId: string, email: string) {
    return getAppStore().query<NotificationSubscription>({ type: 'notification-subscription', pk: notificationPk(project.id),
        where: { proofAssetId: assetId, proofMailbox: mailboxHash(project.id, assetId, email), following: true }, orderBy: 'id', limit: 30 });
}

/** Resolves after the generic HTTP acknowledgement. Issue one link per distinct, live author identity. */
export async function sendProofRecovery(route: ProofThreadRoute, email: string, baseUrl: string, deliver = sendEmail) {
    try {
        const project = await proofProject(route.projectId);
        const subscriptions = await recoverableProofFollows(project, route.assetId, email);
        const sent = new Set<string>();
        for (const doc of subscriptions) {
            if (!verifiedProofFollow(doc) || doc.email !== email) continue;
            const identity = JSON.stringify([doc.actorId, doc.proofShareId]);
            if (sent.has(identity)) continue;
            const binding = await liveProofFollow(project, doc);
            if (!binding) continue;
            const pending = binding.comment.verification;
            const versionId = project.verificationEnabled === true && pending?.outcome === 'pending'
                && pending.reviewer === doc.actorId && !binding.comment.resolved && !binding.comment.archivedAt
                ? pending.evidence?.after.versionId : undefined;
            const url = proofReturningLink(baseUrl, project.publicId ?? project.id, doc,
                versionId ?? binding.asset.currentVersionId!, 'open', proofRecoveryLifetime);
            await deliver(proofReviewRecoveryEmail({ to: doc.email, url }));
            sent.add(identity);
            if (sent.size >= 3) break;
        }
    } catch (error) {
        // A recovery request must return the same acknowledgement for all email/file combinations.
        if (!(error instanceof Error && 'status' in error && error.status === 404))
            console.error('[proof review] Recovery email could not be sent.');
    }
}
