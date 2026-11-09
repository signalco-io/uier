import type { z } from 'zod';
import { agentLabels, isAgentKind, type MessageAgentView } from '@uier/toolbar/agents';
import type { DbComment, DbMessageAgent, DbThreadItem } from '../db/schema';
import { assigneeAgentInputSchema, currentAssigneeAgent } from './assigneeAgentModel';

/**
 * What an MCP connection says about the agent writing a reply through it: the kind it gives or identifies
 * as, and the model and reasoning level it names. The same plain one-line rules as the assignee's agent.
 */
export const messageAgentClaimSchema = assigneeAgentInputSchema.omit({ sessionId: true });
export type MessageAgentClaim = z.input<typeof messageAgentClaimSchema>;

function stored(agent: { kind: DbMessageAgent['kind']; model?: string; reasoning?: string }): DbMessageAgent {
    return { kind: agent.kind, ...(agent.model ? { model: agent.model } : {}), ...(agent.reasoning ? { reasoning: agent.reasoning } : {}) };
}

/**
 * The agent a reply from an MCP connection is marked with. When the agent attached under the author is
 * the same one (the same kind, and the same model and reasoning level when the reply names them), the
 * message is marked with that agent and its details. Otherwise it records what the connection gives.
 * Read from the thread as it is when the reply is saved; never from the message text.
 */
export function messageAgentFor(comment: Pick<DbComment, 'assigneeId' | 'assigneeAgent'>, authorUserId: string, claim: z.output<typeof messageAgentClaimSchema>): DbMessageAgent {
    const attached = currentAssigneeAgent(comment);
    if (attached && attached.assigneeId === authorUserId && attached.kind === claim.kind
        && (claim.model === undefined || claim.model === attached.model)
        && (claim.reasoning === undefined || claim.reasoning === attached.reasoning))
        return stored(attached);
    return stored(claim);
}

/** What a view shows: the agent's kind and label to everyone who sees the message, its model and reasoning level to members */
export function messageAgentView(item: Pick<DbThreadItem, 'authorId' | 'writtenBy' | 'deletedAt'>, details: boolean): MessageAgentView | undefined {
    const agent = item.writtenBy;
    if (!agent || item.deletedAt || !item.authorId?.startsWith('user:') || !isAgentKind(agent.kind)) return undefined;
    return { kind: agent.kind, label: agentLabels[agent.kind],
        ...(details && agent.model ? { model: agent.model } : {}),
        ...(details && agent.reasoning ? { reasoning: agent.reasoning } : {}) };
}
