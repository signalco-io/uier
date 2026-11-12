import { loadStatusWorkflow } from '../app/statusWorkflows';
import { defaultStatus } from '../app/statusWorkflow';
import { feedbackStage } from '@uier/toolbar/verification';
import { randomUUID } from 'node:crypto';
import { pagePath } from '@uier/toolbar/page-state';
import type { DbComment } from '../db/schema';
import type { DbProject } from '../app/model';
import { projectOrigins } from '../app/projects';
import { withThreadActivity } from '../comments/activity';
import { apiErrors } from '../comments/http';
import { submission } from '../comments/submissions';
import { withNotificationEvent } from '../notifications/events';
import { actorAuthorId, refreshMutationActor, type ProjectActor } from './actor';
import { assertEligibleParticipant } from './participants';
import { changeComment, projectPartition } from './comments';
import { fixVerificationSchema } from './fixVerificationSchema';
import type { CommentsStore } from '../repo/commentsStore';

export { verificationDetails, verificationPermissions } from './fixVerificationDto';
/** Configured review destinations retain only the project's approved page state. External links carry no state. */
export function fixDestination(project: DbProject, value?: string) {
    if (!value) return undefined;
    let url: URL;
    try { url = new URL(value); } catch { throw apiErrors.invalidRequest('Enter a valid fix link.'); }
    if (url.username || url.password) throw apiErrors.invalidRequest('Fix links cannot contain credentials.');
    const local = projectOrigins(project).includes(url.origin);
    if (local) {
        const path = `${url.pathname}${url.search}${url.hash}`;
        if (pagePath(path, project.pageState) !== path) throw apiErrors.invalidRequest('Use a review link without unapproved page state.');
    } else if (url.protocol !== 'https:' || url.search || url.hash) throw apiErrors.invalidRequest('External fix links must use HTTPS without query or fragment state.');
    if (!['http:', 'https:'].includes(url.protocol)) throw apiErrors.invalidRequest('Enter an HTTP or HTTPS fix link.');
    return url.toString();
}

export async function changeFixVerification(project: DbProject, actor: ProjectActor, id: string, raw: unknown, store?: CommentsStore) {
    const parsed = fixVerificationSchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose a reviewer and a valid verification action.');
    const input = parsed.data;
    const me = actorAuthorId(actor);
    if (!me) throw apiErrors.forbidden('Sign in or use your original guest identity.');
    const attempt = submission(projectPartition(project.id), me, input.idempotencyKey, { operation: 'verification', id, ...input });
    return changeComment(project, actor, id, () => true, async comment => {
        const currentProject = await refreshMutationActor(project, actor, true);
        const workflow = await loadStatusWorkflow(currentProject);
        const selected = 'statusId' in input && input.statusId ? workflow.statuses.find(status => status.id === input.statusId) : undefined;
        if ('statusId' in input && input.statusId && !selected) throw apiErrors.invalidRequest('This status is no longer available.');
        const v = comment.verification;
        if ((v?.revision ?? null) !== input.expectedRevision) throw apiErrors.conflict();
        const now = new Date().toISOString();
        if (input.action === 'request') {
            if (selected && selected.category !== 'ready') throw apiErrors.invalidRequest('Choose a Ready to verify status.');
            if (actor.kind !== 'member') throw apiErrors.forbidden('Only project members can request verification.');
            const reviewer = input.reviewerId === 'author' ? comment.authorId : `user:${input.reviewerId}`;
            if (!reviewer || reviewer === me) throw apiErrors.forbidden('Choose another reviewer.');
            if (reviewer.startsWith('user:')) await assertEligibleParticipant(currentProject, comment, reviewer.slice(5));
            else if (reviewer !== comment.authorId || comment.thread.items[0]?.deletedAt || currentProject.access !== 'guests')
                throw apiErrors.forbidden('Choose a member who still has access.');
            const updated: DbComment = { ...withThreadActivity(comment, me), resolved: false, workflowStatusId: (selected ?? defaultStatus(workflow, 'ready')).id, verification: {
                id: randomUUID(), revision: randomUUID(), requester: me, reviewer, requestedAt: now, outcome: 'pending',
                ...(input.summary ? { summary: input.summary } : {}), ...(input.fixUrl ? { fixUrl: fixDestination(currentProject, input.fixUrl) } : {})
            } };
            return withNotificationEvent(updated, me, 'verification-requested', now, [reviewer], actor.agent);
        }
        if (!v || v.outcome !== 'pending' || comment.resolved) throw apiErrors.conflict();
        const admin = actor.kind === 'member' && actor.isAdmin;
        if (input.action === 'cancel') {
            if (me !== v.requester && !admin) throw apiErrors.forbidden('Only the requester or an admin can cancel.');
        } else {
            if (me === v.requester) throw apiErrors.forbidden('The requester cannot confirm their own fix.');
            if (input.override) {
                if (!admin || me === v.reviewer) throw apiErrors.forbidden('An admin must explicitly decide on behalf of another reviewer.');
            } else {
                if (me !== v.reviewer) throw apiErrors.forbidden('Only the requested reviewer can decide.');
                if (me.startsWith('user:')) await assertEligibleParticipant(currentProject, comment, me.slice(5));
                else if (me !== comment.authorId || comment.thread.items[0]?.deletedAt || currentProject.access !== 'guests') throw apiErrors.forbidden('This reviewer no longer has access.');
            }
        }
        const updated: DbComment = { ...withThreadActivity(comment, me), resolved: input.action === 'confirm', ...(input.action === 'confirm' ? { completedAt: now } : {}), verification: {
            ...v, revision: randomUUID(), outcome: input.action === 'confirm' ? 'confirmed' : input.action === 'reject' ? 'needs-work' : 'canceled',
            decision: { kind: input.action, actorId: me, at: now, override: input.action !== 'cancel' && input.override === true }
        } };
        // Still needs work: someone continues the fix. A cancel goes where it was asked to, else back to
        // where the thread was before the request (the flag stays while a check is pending). Done clears it.
        const target = input.action === 'reject' ? 'in-progress' : input.action === 'cancel' ? input.status : undefined;
        if (target === 'in-progress') updated.inProgress = true;
        else if (target === 'open' || input.action === 'confirm') delete updated.inProgress;
        const category = feedbackStage(updated);
        if (selected && selected.category !== category) throw apiErrors.invalidRequest('Choose a status in the target category.');
        updated.workflowStatusId = (selected ?? defaultStatus(workflow, category)).id;
        return withNotificationEvent(updated, me, input.action === 'confirm' ? 'verification-confirmed' : input.action === 'reject' ? 'verification-rejected' : 'verification-canceled', now, [v.requester, v.reviewer], actor.kind === 'member' ? actor.agent : undefined, { verificationOverride: input.override === true });
    }, attempt, { expected: null, value: () => null, requireComments: true }, store);
}
