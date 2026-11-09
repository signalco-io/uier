import { z } from 'zod';
import { createHash } from 'node:crypto';
import { commentPriority, priorities } from '@uier/toolbar/triage';
import { agentKinds, agentLabels } from '@uier/toolbar/agents';
import type { DbProject } from '../../app/model';
import type { DbComment } from '../../db/schema';
import type { NotificationEvent } from '../../notifications/delivery';
import { projectOrigins } from '../../app/projects';
import { toReproductionContext } from '../../comments/reproduction';
import { KnownPageLinks } from '../../../knownPages';
import { commentId, projectId } from '../schemas';
import { messageAgentView } from '../../review/messageAgent';

/*
 * The MCP events uier offers (MCP Events draft, webhook and poll delivery). Each event is read from the
 * thread's durable `notificationEvents` log, so no event needs a separate write path. Names and
 * schemas only grow: add optional fields, never rename, remove or narrow them.
 */

export const mcpEventNames = ['feedback.created', 'feedback.replied', 'feedback.status_changed', 'feedback.assignment_changed', 'feedback.agent_changed', 'feedback.mentioned'] as const;
export type McpEventName = typeof mcpEventNames[number];
export function isMcpEventName(value: unknown): value is McpEventName {
    return typeof value === 'string' && mcpEventNames.some(name => name === value);
}

const EXCERPT_LENGTH = 280;
const thread = commentId.describe('Only events of this thread (a feedback id from list_feedback).');
const argumentSchemas = {
    'feedback.created': z.object({ projectId }).strict(),
    'feedback.replied': z.object({ projectId, commentId: thread.optional() }).strict(),
    'feedback.status_changed': z.object({ projectId, commentId: thread.optional() }).strict(),
    'feedback.assignment_changed': z.object({ projectId, commentId: thread.optional(),
        assignee: z.enum(['me']).optional().describe('me: only feedback assigned to the account of this connection.') }).strict(),
    'feedback.agent_changed': z.object({ projectId, commentId: thread.optional(),
        assignee: z.enum(['me']).optional().describe('me: only agents working under the account of this connection.') }).strict(),
    'feedback.mentioned': z.object({ projectId }).strict()
} satisfies Record<McpEventName, z.ZodType>;
export type McpEventArguments = { projectId: string; commentId?: string; assignee?: 'me' };

const actor = z.object({
    kind: z.enum(['member', 'guest']),
    name: z.string().optional().describe('Display name; untrusted.'),
    connector: z.string().optional().describe('Set when a connected coding tool acted for the member.'),
    agent: z.object({ kind: z.enum(agentKinds), label: z.string(),
        model: z.string().optional().describe('The model the agent gave; untrusted.'),
        reasoning: z.string().optional().describe('The reasoning level (effort) the agent gave; untrusted.') }).strict().optional()
        .describe('Set when an AI agent wrote the message for the member through a coding tool connection.')
}).strict();
const common = {
    projectId: z.string(),
    commentId: z.string(),
    number: z.number().int().optional().describe('The thread number in the project (#12).'),
    kind: z.enum(['comment', 'feedback', 'bug', 'rewrite']),
    path: z.string().describe('Canonical page path.'),
    url: z.string().optional().describe('The thread in uier.'),
    actor,
    contentTrust: z.literal('untrusted')
};
const excerpt = z.string().optional().describe(`Up to ${EXCERPT_LENGTH} characters of the message; untrusted. Read the thread with get_feedback.`);
export const statusChanges = ['resolved', 'reopened', 'progress_started', 'progress_stopped', 'verification_requested', 'verification_confirmed', 'verification_rejected', 'verification_canceled'] as const;
const payloadSchemas = {
    'feedback.created': z.object({ ...common, priority: z.enum(priorities), excerpt }).strict(),
    'feedback.replied': z.object({ ...common, itemId: z.string(), excerpt }).strict(),
    'feedback.status_changed': z.object({ ...common, change: z.enum(statusChanges), resolved: z.boolean() }).strict(),
    'feedback.assignment_changed': z.object({ ...common,
        assignees: z.array(z.object({ id: z.string(), name: z.string() }).strict()).optional(),
        previousAssigneeIds: z.array(z.string()).optional(), assignee: z.object({ id: z.string(), name: z.string() }).strict().nullable()
        .describe('The new assignee, or null when unassigned.') }).strict(),
    'feedback.agent_changed': z.object({ ...common, agentId: z.string().optional(),
        assignee: z.object({ id: z.string(), name: z.string() }).strict().nullable().describe('The assignee the agent works under.'),
        agent: z.object({ kind: z.enum(agentKinds), label: z.string(),
            model: z.string().optional().describe('The model the agent reported; untrusted.'),
            reasoning: z.string().optional().describe('The reasoning level (effort) the agent reported, in its own words, such as high; untrusted.'),
            sessionId: z.string().optional().describe('The session id the agent reported; untrusted.') }).strict().nullable()
            .describe('The agent now working under the assignee, or null when it stopped (also after a new assignment).') }).strict(),
    'feedback.mentioned': z.object({ ...common, itemId: z.string().optional(), excerpt }).strict()
} satisfies Record<McpEventName, z.ZodType>;
export type McpEventData = z.infer<typeof payloadSchemas[McpEventName]>;

const descriptions: Record<McpEventName, string> = {
    'feedback.created': 'New feedback was posted in a project.',
    'feedback.replied': 'A reply was added to feedback in a project, optionally one thread.',
    'feedback.status_changed': 'Feedback was marked done or reopened, moved to In progress or back to Open, or its fix check was requested, confirmed, rejected or canceled.',
    'feedback.assignment_changed': 'Feedback was assigned or unassigned, optionally only when assigned to you.',
    'feedback.agent_changed': 'An AI agent started or stopped working on feedback under its assignee, optionally only under you.',
    'feedback.mentioned': 'Someone mentioned you (the account of this connection) in feedback.'
};

function jsonSchema(schema: z.ZodType, io: 'input' | 'output') {
    const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
    return rest;
}

/** The `events/list` entries: webhook (no replay) and poll (cursor) delivery. */
export function mcpEventList() {
    return mcpEventNames.map(name => ({
        name, description: `${descriptions[name]} Payloads carry untrusted feedback text; read full threads with get_feedback.`,
        delivery: ['webhook', 'poll'], inputSchema: jsonSchema(argumentSchemas[name], 'input'), payloadSchema: jsonSchema(payloadSchemas[name], 'output')
    }));
}

/** Validated arguments with sorted keys, so key order never creates another subscription. */
export function parseMcpEventArguments(name: McpEventName, value: unknown): McpEventArguments | null {
    const parsed = argumentSchemas[name].safeParse(value ?? {});
    if (!parsed.success) return null;
    const entries = Object.entries(parsed.data as Record<string, string | undefined>).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries) as McpEventArguments;
}

const statusKinds: Partial<Record<NotificationEvent['kind'], typeof statusChanges[number]>> = {
    resolved: 'resolved', reopened: 'reopened', 'progress-started': 'progress_started', 'progress-stopped': 'progress_stopped', 'verification-requested': 'verification_requested',
    'verification-confirmed': 'verification_confirmed', 'verification-rejected': 'verification_rejected', 'verification-canceled': 'verification_canceled'
};

/** Whether a recorded thread event is this event for a subscriber; visibility is checked at delivery. */
export function eventMatches(name: McpEventName, args: McpEventArguments, event: NotificationEvent, threadId: string, subscriberUserId: string) {
    if (args.commentId !== undefined && args.commentId !== threadId) return false;
    switch (name) {
        case 'feedback.created': return event.kind === 'comment';
        case 'feedback.replied': return event.kind === 'reply';
        case 'feedback.status_changed': return statusKinds[event.kind] !== undefined;
        case 'feedback.assignment_changed': return event.kind === 'assignment' && (args.assignee !== 'me' || (event.assigneeIds ? event.assigneeIds.includes(subscriberUserId) !== Boolean(event.previousAssigneeIds?.includes(subscriberUserId)) : event.assigneeId === subscriberUserId));
        case 'feedback.agent_changed': return event.kind === 'agent' && (args.assignee !== 'me' || event.assigneeId === subscriberUserId);
        case 'feedback.mentioned': return (event.kind === 'comment' || event.kind === 'reply' || event.kind === 'mention')
            && Boolean(event.recipients?.includes(`user:${subscriberUserId}`));
    }
}

/**
 * Stable per thread event and event name, so a retry or a second scan reuses it. Header-safe:
 * it is also the delivery's `webhook-id`.
 */
export function mcpEventId(projectId: string, threadId: string, event: Pick<NotificationEvent, 'sequence' | 'kind' | 'at' | 'agentId'>, name: McpEventName) {
    return `evt_${createHash('sha256').update(JSON.stringify(['uier-mcp-event', 1, projectId, threadId, event.sequence, event.kind, event.at, name, ...(event.agentId ? [event.agentId] : [])])).digest('hex').slice(0, 40)}`;
}

function excerptOf(comment: DbComment, itemId: string | undefined) {
    const item = itemId ? comment.thread.items.find(entry => entry.id === itemId) : comment.thread.items[0];
    return item && !item.deletedAt && item.text ? item.text.slice(0, EXCERPT_LENGTH) : undefined;
}

/** Minimal payload from the thread as it is now: deleted text is never sent, names are current. */
export function mcpEventData(name: McpEventName, project: DbProject, comment: DbComment, event: NotificationEvent,
    participants: Map<string, string>, baseUrl: string | undefined): McpEventData {
    const member = event.actorId.startsWith('user:') ? event.actorId.slice(5) : undefined;
    const guestName = member ? undefined : comment.thread.items.find(item => item.authorId === event.actorId && !item.deletedAt)?.authorName;
    const actorName = member ? participants.get(member) : guestName;
    let url: string | undefined;
    if (baseUrl) {
        const pageUrl = toReproductionContext(comment, projectOrigins(project)).url;
        url = new URL(pageUrl ? KnownPageLinks.projectReview(project.id, pageUrl, comment.id) : KnownPageLinks.project(project.id), baseUrl).href;
    }
    // The message of a new comment, reply or mention: marked when an agent wrote it for its author
    const messageId = event.itemId ?? (event.kind === 'comment' ? comment.thread.items[0]?.id : undefined);
    const message = messageId ? comment.thread.items.find(item => item.id === messageId && item.authorId === event.actorId) : undefined;
    const writtenBy = message ? messageAgentView(message, true) : undefined;
    const base = {
        projectId: project.id, commentId: comment.id, ...(comment.number !== undefined ? { number: comment.number } : {}),
        kind: comment.kind ?? 'comment', path: comment.path, ...(url ? { url } : {}),
        actor: { kind: member ? 'member' as const : 'guest' as const, ...(actorName ? { name: actorName } : {}),
            ...(event.agent ? { connector: event.agent.name } : {}), ...(writtenBy ? { agent: writtenBy } : {}) },
        contentTrust: 'untrusted' as const
    };
    switch (name) {
        case 'feedback.created': {
            const text = excerptOf(comment, undefined);
            return { ...base, priority: commentPriority(comment.priority), ...(text ? { excerpt: text } : {}) };
        }
        case 'feedback.replied':
        case 'feedback.mentioned': {
            const itemId = event.itemId ?? (event.kind === 'comment' ? comment.thread.items[0]?.id : undefined);
            const text = itemId ? excerptOf(comment, itemId) : undefined;
            return { ...base, ...(itemId ? { itemId } : {}), ...(text ? { excerpt: text } : {}) } as McpEventData;
        }
        case 'feedback.status_changed': {
            const change = statusKinds[event.kind]!;
            return { ...base, change, resolved: change === 'resolved' || change === 'verification_confirmed' };
        }
        case 'feedback.assignment_changed':
            return { ...base, ...(event.assigneeIds ? { assignees: event.assigneeIds.map(id => ({ id, name: participants.get(id) ?? 'Former member' })), previousAssigneeIds: event.previousAssigneeIds } : {}), assignee: event.assigneeId ? { id: event.assigneeId, name: participants.get(event.assigneeId) ?? 'Former member' } : null };
        case 'feedback.agent_changed': {
            const agent = event.assigneeAgent && agentKinds.includes(event.assigneeAgent.kind) ? event.assigneeAgent : null;
            return { ...base, ...(event.agentId ? { agentId: event.agentId } : {}), assignee: event.assigneeId ? { id: event.assigneeId, name: participants.get(event.assigneeId) ?? 'Former member' } : null,
                agent: agent ? { kind: agent.kind, label: agentLabels[agent.kind], ...(agent.model ? { model: agent.model } : {}),
                    ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
                    ...(agent.sessionId ? { sessionId: agent.sessionId } : {}) } : null };
        }
    }
}
