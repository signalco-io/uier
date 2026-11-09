import type { DbProject } from '../app/model';
import type { DbAssigneeAgent } from '../db/schema';
import { feedbackStage } from '@uier/toolbar/verification';
import { withThreadActivity } from '../comments/activity';
import { apiErrors } from '../comments/http';
import { submission } from '../comments/submissions';
import { withOrdinaryStage } from '../comments/verificationState';
import { idempotencyKeySchema } from '../comments/validation';
import { withNotificationEvent } from '../notifications/events';
import type { CommentsStore } from '../repo/commentsStore';
import { actorAuthorId, type ProjectActor } from './actor';
import { assigneeAgentInputSchema, currentAssigneeAgent, type AssigneeAgentInput } from './assigneeAgentModel';
import { changeComment, projectPartition } from './comments';
import { assertEligibleParticipant, assertParticipantEditor } from './participants';

/**
 * Sets, changes or clears (`null`) the AI agent working on a thread under its assignee. Only the assignee
 * can, for themselves: in the app or through their own MCP connection (`actor.agent`, recorded as the
 * connector). Nobody, admins included, sets one under someone else, and guests never can.
 *
 * `assignToMe` (MCP, when the person asked for it) assigns an unassigned thread to the actor first, in the
 * same write; a thread assigned to someone else is always refused. Records thread activity and an `agent`
 * event (MCP `feedback.agent_changed`), which is never emailed.
 *
 * `startWork` (MCP, when the connection may also change status) treats attaching an agent as the start of
 * the work: an Open thread moves to In progress in the same write, recorded like any status change (its own
 * activity step and a `progress-started` event, which followers are emailed). Only attaching does: updating
 * or clearing the agent, or a thread that is In progress, Ready to verify or Done, keeps its status.
 */
export async function setProjectCommentAgent(project: DbProject, actor: ProjectActor, id: string, agent: AssigneeAgentInput | null,
    options: { idempotencyKey?: string; assignToMe?: boolean; startWork?: boolean; store?: CommentsStore } = {}) {
    const parsed = assigneeAgentInputSchema.nullable().safeParse(agent);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw apiErrors.invalidRequest(issue && ['sessionId', 'model', 'reasoning'].includes(String(issue.path[0])) ? issue.message : 'Choose a valid agent.');
    }
    const desired = parsed.data;
    if (options.idempotencyKey !== undefined && !idempotencyKeySchema.safeParse(options.idempotencyKey).success)
        throw apiErrors.invalidRequest('Use a valid submission key.');
    if (actor.kind !== 'member') throw apiErrors.forbidden('Sign in to choose an agent.');
    const actorId = actorAuthorId(actor)!;
    const assignToMe = Boolean(options.assignToMe && desired);
    return await changeComment(project, actor, id, () => true, async comment => {
        await assertParticipantEditor(project, actor, comment);
        const at = new Date().toISOString();
        let updated = comment;
        if (assignToMe && !comment.assigneeId) {
            await assertEligibleParticipant(project, comment, actor.userId);
            updated = withNotificationEvent({ ...withThreadActivity(comment, actorId), assigneeId: actor.userId }, actorId, 'assignment', at,
                [actorId], actor.agent, { assigneeId: actor.userId });
        }
        if (updated.assigneeId !== actor.userId)
            throw apiErrors.forbidden(updated.assigneeId ? 'Only the assignee can choose the agent working under them.' : 'Assign this thread to yourself first.');
        const current = currentAssigneeAgent(updated);
        if (!desired) {
            if (!current && !updated.assigneeAgent) return updated;
            const cleared = { ...updated };
            delete cleared.assigneeAgent;
            if (!current) return cleared;
            return withNotificationEvent(withThreadActivity(cleared, actorId), actorId, 'agent', at, undefined, actor.agent,
                { assigneeId: actor.userId, assigneeAgent: null });
        }
        if (current && current.kind === desired.kind && current.sessionId === desired.sessionId && current.model === desired.model
            && current.reasoning === desired.reasoning) return updated;
        const next: DbAssigneeAgent = {
            kind: desired.kind, assigneeId: actor.userId,
            ...(desired.sessionId ? { sessionId: desired.sessionId } : {}), ...(desired.model ? { model: desired.model } : {}),
            ...(desired.reasoning ? { reasoning: desired.reasoning } : {}),
            setBy: actor.userId, setAt: at, ...(actor.agent ? { connector: actor.agent } : {})
        };
        // One activity step per change: an assignment made here keeps its own, before the agent's, and the
        // move to In progress its own after it.
        const attached = withNotificationEvent({ ...withThreadActivity(updated, actorId), assigneeAgent: next }, actorId, 'agent', at, undefined, actor.agent,
            { assigneeId: actor.userId, assigneeAgent: { kind: next.kind, ...(next.model ? { model: next.model } : {}),
                ...(next.reasoning ? { reasoning: next.reasoning } : {}), ...(next.sessionId ? { sessionId: next.sessionId } : {}) } });
        if (!options.startWork || current || feedbackStage(attached) !== 'open') return attached;
        return withNotificationEvent(withOrdinaryStage(withThreadActivity(attached, actorId), 'in-progress'), actorId, 'progress-started', at, undefined, actor.agent);
    }, submission(projectPartition(project.id), actorId, options.idempotencyKey, { operation: 'agent', id, agent: desired, assignToMe }), undefined, options.store);
}
