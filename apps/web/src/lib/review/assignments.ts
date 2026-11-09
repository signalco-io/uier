import { z } from 'zod';
import { isAgentKind } from '@uier/toolbar/agents';
import { userIdSchema } from '../app/validation';
import type { DbAssigneeAgent, DbComment } from '../db/schema';

export const MAX_ASSIGNEES = 50;
export const MAX_ASSIGNEE_AGENTS = 10;
export const assigneeIdsSchema = z.array(userIdSchema).max(MAX_ASSIGNEES)
    .refine(ids => new Set(ids).size === ids.length, 'Choose distinct people.');
export const assignmentModeSchema = z.enum(['replace', 'add', 'remove']);
export type AssignmentMode = z.infer<typeof assignmentModeSchema>;
export const agentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export type AssignmentFields = Pick<DbComment, 'assigneeId' | 'assigneeIds' | 'assigneeAgent' | 'assigneeAgents'>;

/** Arrays are authoritative when present, including an empty array. Old single assignments need no migration. */
export function assignedUserIds(comment: Pick<AssignmentFields, 'assigneeId' | 'assigneeIds'>): string[] {
    return [...new Set(comment.assigneeIds ?? (comment.assigneeId ? [comment.assigneeId] : []))];
}

/** Only agents under a current assignee. Legacy attachments have a stable id within that person's assignment. */
export function assignedAgents(comment: AssignmentFields): DbAssigneeAgent[] {
    const ids = assignedUserIds(comment);
    return (comment.assigneeAgents ?? (comment.assigneeAgent ? [comment.assigneeAgent] : []))
        .filter(agent => ids.includes(agent.assigneeId) && isAgentKind(agent.kind))
        .map(agent => agent.id ? agent : { ...agent, id: 'legacy' });
}

/** Keep the first-person/first-agent mirrors for earlier readers and pinned toolbar versions. */
export function withAssignments(comment: DbComment, ids: string[], agents = assignedAgents(comment)): DbComment {
    const assigneeIds = [...new Set(ids)];
    const assigneeAgents = agents.filter(agent => assigneeIds.includes(agent.assigneeId));
    const updated = { ...comment, assigneeIds, assigneeAgents };
    if (assigneeIds[0]) updated.assigneeId = assigneeIds[0];
    else delete updated.assigneeId;
    const first = assigneeAgents.find(agent => agent.assigneeId === assigneeIds[0]);
    if (first) updated.assigneeAgent = first;
    else delete updated.assigneeAgent;
    return updated;
}
