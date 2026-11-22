import { randomUUID } from 'node:crypto';
import { KnownPageLinks, KnownPages } from '../../knownPages';
import { hasProjectAccess, loadWorkspaceAccess } from '../app/access';
import { findProject } from '../app/projects';
import type { AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { getUser } from '../app/users';
import { getMember, listWorkspaceMembers } from '../app/workspaces';
import { getReadSequence } from '../comments/readState';
import type { DbReviewRelease, DbReviewSession } from '../db/schema';
import { layoutEmail } from '../email/templates';
import { getCommentsStore } from '../repo/commentsStore';
import { memberActor } from '../review/actor';
import { canSeeComment, projectPartition } from '../review/comments';
import { participantNames } from '../review/dto';
import { reviewSessionDocumentId } from '../review/reviewSessionRelease';
import type { NotificationDelivery } from './delivery';
import {
    notificationManageUrl, notificationPk, notificationPreference, notificationSubscription,
    notificationToken, preferenceId, type NotificationPreference
} from './preferences';

async function releaseThreads(release: DbReviewRelease) {
    const store = getCommentsStore();
    const threads = [];
    for (let index = 0; index < release.threadIds.length; index += 8) {
        const entries = await Promise.all(release.threadIds.slice(index, index + 8).map(id => store.get(release.domain, id)));
        for (const entry of entries) {
            const comment = entry?.comment;
            if (comment?.reviewSession?.id === release.sessionId && comment.reviewSession.revision === release.revision) threads.push(comment);
        }
    }
    return threads;
}

export async function discoverReviewNotifications(release: DbReviewRelease, store: AppStore) {
    const project = await findProject(release.projectId);
    if (!project) return;
    const [members, access, threads] = await Promise.all([
        listWorkspaceMembers(project.workspaceId), loadWorkspaceAccess(project.workspaceId), releaseThreads(release)
    ]);
    const mentions = new Set(threads.flatMap(comment => (comment.notificationEvents ?? [])
        .filter(event => event.reviewHeld && ['comment', 'reply', 'mention'].includes(event.kind))
        .flatMap(event => event.recipients ?? [])));
    for (const member of members) {
        const actorId = `user:${member.userId}`;
        if (actorId === release.authorId || !hasProjectAccess(access, member, project)
            || (member.role !== 'admin' && member.userId !== project.createdBy && !mentions.has(actorId))) continue;
        await store.create<NotificationDelivery>({
            type: 'notification-delivery', id: `delivery_${sha256Hex(`${release.id}:${actorId}`)}`, pk: notificationPk(project.id),
            projectId: project.id, threadId: release.id, reviewReleaseId: release.id, actorId, userId: member.userId,
            requestedThrough: 1, processedThrough: 0, active: true, failures: 0, nextAttemptAt: release.submittedAt, status: 'queued', ttl: -1
        });
    }
    const comments = getCommentsStore();
    const current = await comments.reviewSessionRecord<DbReviewRelease>(release.domain, release.id);
    if (current?.doc.type === 'review-release' && current.doc.emailPending) {
        const { emailPending: _pending, ...doc } = current.doc;
        await comments.writeReviewSessionBatch(release.domain, [{ operation: 'replace', doc, etag: current.etag }]);
    }
}

const plain = (text: string, max: number) => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);

export async function reviewNotificationMessage(delivery: NotificationDelivery, baseUrl: string, store: AppStore) {
    if (!delivery.reviewReleaseId || !delivery.userId) return null;
    const project = await findProject(delivery.projectId);
    if (!project || project.access === 'disabled') return null;
    const domain = projectPartition(project.id);
    const [releaseRecord, actor, user, member, existingPreference] = await Promise.all([
        getCommentsStore().reviewSessionRecord<DbReviewRelease>(domain, delivery.reviewReleaseId),
        memberActor(project, delivery.userId), getUser(delivery.userId), getMember(project.workspaceId, delivery.userId),
        notificationPreference(project.id, delivery.actorId)
    ]);
    const release = releaseRecord?.doc;
    if (release?.type !== 'review-release' || actor?.kind !== 'member' || !user?.email
        || delivery.actorId === release.authorId || existingPreference?.muted
        || (member?.createdAt && member.createdAt > release.submittedAt)) return null;
    const threads = await releaseThreads(release);
    const eligible = [];
    let canIncludeSummary = threads.length === release.threadIds.length;
    for (const comment of threads) {
        if (!canSeeComment(comment, actor)) {
            canIncludeSummary = false;
            continue;
        }
        const [follow, read] = await Promise.all([
            notificationSubscription(project.id, delivery.actorId, comment.id),
            getReadSequence(domain, delivery.actorId, comment.id)
        ]);
        if (follow?.following === false || (follow?.since && follow.since > release.submittedAt)) continue;
        const events = (comment.notificationEvents ?? []).filter(event => event.reviewHeld && event.sequence > read && event.actorId !== delivery.actorId);
        const mentioned = events.some(event => ['comment', 'reply', 'mention'].includes(event.kind)
            && event.recipients?.includes(delivery.actorId) && (!event.itemId || comment.thread.items.some(item => item.id === event.itemId && !item.deletedAt
                && item.mentions?.some(mention => mention.userId === delivery.userId))));
        const creatorNotice = (actor.isAdmin || actor.userId === project.createdBy) && events.some(event => event.kind === 'comment');
        if (mentioned || creatorNotice) eligible.push(comment);
    }
    if (!eligible.length) return null;
    const excerpts = project.emailCommentExcerpts === true;
    const names = await participantNames(project);
    const author = plain(release.authorId.startsWith('user:') ? names.get(release.authorId.slice(5)) ?? 'Former member'
        : threads.find(comment => comment.authorId === release.authorId)?.thread.items[0]?.authorName ?? 'Guest', 60) || 'Reviewer';
    const projectName = plain(project.name, 60) || 'Project';
    const count = eligible.length;
    const comments = `${count} ${count === 1 ? 'comment' : 'comments'}`;
    const subject = release.revision === 1 ? `${projectName} · ${author} sent a review with ${comments}`
        : `${projectName} · ${author} added ${comments} to Review ${release.number}`;
    const paragraphs = eligible.slice(0, 10).map(comment => {
        const first = comment.thread.items[0];
        const label = [comment.number ? `#${comment.number}` : null, comment.feedbackType?.label ?? comment.kind ?? 'Comment',
            plain(comment.path.split(/[?#]/, 1)[0] || '/', 100)].filter(Boolean).join(' · ');
        const excerpt = excerpts && first && !first.deletedAt ? plain(first.text, 160) : '';
        return excerpt ? `${label} · ${excerpt}` : label;
    });
    if (count > 10) paragraphs.push(`and ${count - 10} more`);
    let showReviewText = excerpts && canIncludeSummary && count === threads.length;
    // The author may carry the text forward on resume. Any prior thread it covered still
    // needs to be readable by this recipient.
    if (showReviewText && (release.title || release.summary) && release.revision > 1) {
        const store = getCommentsStore();
        const session = await store.reviewSessionRecord<DbReviewSession>(domain, reviewSessionDocumentId(release.sessionId));
        const published = session?.doc.publishedThreadIds.slice(0, release.threadCount);
        showReviewText = published?.length === release.threadCount;
        const ids = published?.filter(id => !release.threadIds.includes(id)) ?? [];
        for (let index = 0; showReviewText && index < ids.length; index += 8) {
            const rows = await Promise.all(ids.slice(index, index + 8).map(id => store.get(domain, id)));
            showReviewText = rows.every(row => row?.comment.reviewSession?.id === release.sessionId && canSeeComment(row.comment, actor));
        }
    }
    if (showReviewText && release.summary) paragraphs.unshift(plain(release.summary, 1000));
    let preference = existingPreference;
    if (!preference) {
        await store.create<NotificationPreference>({ type: 'notification-preference', pk: notificationPk(project.id), id: preferenceId(delivery.actorId),
            projectId: project.id, actorId: delivery.actorId, muted: false, version: randomUUID() });
        preference = await notificationPreference(project.id, delivery.actorId);
    }
    if (!preference || preference.muted) return null;
    const token = notificationToken(preference, 'project');
    const url = new URL(KnownPageLinks.project(project.publicId ?? project.id), baseUrl);
    url.searchParams.set('reviewSessionId', release.sessionId);
    url.searchParams.set('status', 'all');
    const heading = showReviewText && release.title ? plain(release.title, 120) : `Review ${release.number}`;
    const message = { ...layoutEmail({ to: user.email, subject, heading,
        paragraphs, action: { label: 'Open review', url: url.href },
        footnote: 'This email includes unread feedback from the review.',
        footerAction: { label: 'Manage project emails', url: notificationManageUrl(baseUrl, token) } }), headers: {
        'List-Unsubscribe': `<${baseUrl}${KnownPages.NotificationUnsubscribe}?token=${encodeURIComponent(token)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    } };
    return { message, fingerprint: sha256Hex(JSON.stringify([user.email, subject, heading, paragraphs, eligible.map(thread => thread.id), preference.version, url.href])) };
}
