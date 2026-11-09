import { z } from 'zod';
import { agentKinds, agentLabels, isAgentKind, MAX_AGENT_MODEL_LENGTH, MAX_AGENT_REASONING_LENGTH, MAX_AGENT_SESSION_LENGTH, type AssigneeAgentView } from '@uier/toolbar/agents';
import type { DbComment } from '../db/schema';

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

/** The agent working under the thread's current assignee; one saved under an earlier assignee is ignored. */
export function currentAssigneeAgent(comment: Pick<DbComment, 'assigneeId' | 'assigneeAgent'>) {
    const agent = comment.assigneeAgent;
    return agent && comment.assigneeId && agent.assigneeId === comment.assigneeId && isAgentKind(agent.kind) ? agent : undefined;
}

/** What members see about the agent (app, toolbar, MCP and the feedback packet). Never the connector's ids. */
export function assigneeAgentView(comment: Pick<DbComment, 'assigneeId' | 'assigneeAgent'>): AssigneeAgentView | undefined {
    const agent = currentAssigneeAgent(comment);
    if (!agent) return undefined;
    return { kind: agent.kind, label: agentLabels[agent.kind], ...(agent.model ? { model: agent.model } : {}),
        ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
        ...(agent.sessionId ? { sessionId: agent.sessionId } : {}), setAt: agent.setAt };
}
