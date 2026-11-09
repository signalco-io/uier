import { z } from 'zod';
import { agentIsWorking, agentKinds, agentLabels, MAX_AGENT_MODEL_LENGTH, MAX_AGENT_REASONING_LENGTH, MAX_AGENT_SESSION_LENGTH, type AssigneeAgentView } from '@uier/toolbar/agents';
import type { DbAssigneeAgent } from '../db/schema';
import { assignedAgents, assignedUserIds, type AssignmentFields } from './assignments';

/** Plain one-line text; blank clears it */
const plainText = (max: number, label: string) => z.string().trim().max(max, `${label} can be at most ${max} characters.`)
    .refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), `${label} must be plain text on one line.`)
    .transform(value => value || undefined);

/** The agent someone chooses, or an MCP connection reports for itself */
export const assigneeAgentInputSchema = z.object({
    kind: z.enum(agentKinds),
    sessionId: plainText(MAX_AGENT_SESSION_LENGTH, 'A session id').optional(),
    model: plainText(MAX_AGENT_MODEL_LENGTH, 'A model').optional(),
    reasoning: plainText(MAX_AGENT_REASONING_LENGTH, 'A reasoning level').optional()
}).strict();
export type AssigneeAgentInput = z.input<typeof assigneeAgentInputSchema>;

/** The first agent under a current assignee, for earlier single-agent callers. */
export function currentAssigneeAgent(comment: AssignmentFields, assigneeId = assignedUserIds(comment)[0], agentId?: string) {
    return assignedAgents(comment).find(agent => agent.assigneeId === assigneeId && (!agentId || agent.id === agentId));
}

/** Public member projection. Never exposes a connector's credential id. */
export function agentView(agent: DbAssigneeAgent): AssigneeAgentView {
    return { ...(agent.id ? { id: agent.id } : {}), kind: agent.kind, label: agentLabels[agent.kind], ...(agent.model ? { model: agent.model } : {}),
        ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
        ...(agent.sessionId ? { sessionId: agent.sessionId } : {}), setAt: agent.setAt, ...(agentIsWorking(agent.workingUntil) ? { workingUntil: agent.workingUntil } : {}) };
}
export function assigneeAgentViews(comment: AssignmentFields, assigneeId: string): AssigneeAgentView[] {
    return assignedAgents(comment).filter(agent => agent.assigneeId === assigneeId).map(agentView);
}
export function assigneeAgentView(comment: AssignmentFields, assigneeId = assignedUserIds(comment)[0], agentId?: string): AssigneeAgentView | undefined {
    const agent = currentAssigneeAgent(comment, assigneeId, agentId);
    return agent && agentView(agent);
}
