import type { VerificationDetails, VerificationPermissions } from '@uier/toolbar/verification';
import type { DbComment } from '../db/schema';
import type { DbProject } from '../app/model';
import type { ProjectActor } from './actor';
import { feedbackSource } from '../app/environments';

/** Call only after the caller has authorized thread visibility. */
function usableAuthor(comment: DbComment, project: DbProject, members: Map<string, string>) {
    const author = comment.authorId;
    return Boolean(author && !comment.thread.items[0]?.deletedAt && (author.startsWith('user:') ? members.has(author.slice(5)) : project.access === 'guests'));
}
export function verificationPermissions(comment: DbComment, project: DbProject, actor: ProjectActor, members: Map<string, string>): VerificationPermissions {
    const me = actor.kind === 'member' ? `user:${actor.userId}` : actor.kind === 'guest' ? actor.visitorId : undefined;
    const v = comment.verification;
    const enabled = project.access !== 'disabled';
    const pending = enabled && !comment.resolved && v?.outcome === 'pending';
    const distinct = Boolean(me && me !== v?.requester);
    return { ...(actor.kind === 'member' ? { selfId: actor.userId } : {}), request: enabled && actor.kind === 'member',
        respond: Boolean(pending && distinct && me === v?.reviewer && (actor.kind === 'member' ? members.has(actor.userId) : actor.kind === 'guest' && usableAuthor(comment, project, members) && me === comment.authorId)),
        cancel: Boolean(pending && (me === v?.requester || actor.kind === 'member' && actor.isAdmin)),
        override: Boolean(pending && distinct && actor.kind === 'member' && actor.isAdmin && me !== v?.reviewer),
        defaultReviewer: enabled && usableAuthor(comment, project, members) && comment.authorId !== me };
}
/** Only display names; private guest identities remain in the server record. */
export function verificationDetails(comment: DbComment, project: DbProject, actor: ProjectActor, members: Map<string, string>): VerificationDetails | undefined {
    const v = comment.verification;
    if (!v) return;
    const name = (id: string) => id.startsWith('user:') ? members.get(id.slice(5)) ?? 'Former member'
        : id === comment.authorId && !comment.thread.items[0]?.deletedAt ? comment.thread.items[0]?.authorName || 'Guest' : 'Unavailable reviewer';
    const fixOrigin = v.fixUrl ? new URL(v.fixUrl).origin : undefined;
    const showLink = actor.kind === 'member' || Boolean(feedbackSource(project, comment.origin).available && (!fixOrigin || !project.urls.some(url => new URL(url).origin === fixOrigin) || fixOrigin === comment.origin));
    return { id: v.id, revision: v.revision, outcome: v.outcome, requestedAt: v.requestedAt,
        requester: name(v.requester), reviewer: name(v.reviewer), summary: v.summary,
        ...(showLink && v.fixUrl ? { fixUrl: v.fixUrl } : {}),
        ...(v.decision ? { decision: { kind: v.decision.kind, actor: name(v.decision.actorId), at: v.decision.at, override: v.decision.override } } : {}) };
}
