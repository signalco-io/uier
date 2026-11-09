import { randomUUID } from 'node:crypto';
import { agentLabels, type AgentKind } from '@uier/toolbar/agents';
import { commentPriority, priorityLabels } from '@uier/toolbar/triage';
import { feedbackStage, feedbackStageLabels } from '@uier/toolbar/verification';
import type { DbComment } from '../db/schema';
import { assignedAgents, assignedUserIds } from '../review/assignments';
import { integrationLabels } from '../integrations/model';

/** Separate from unread cursors and delivery outboxes. Oldest entries are discarded in the same write. */
export const MAX_THREAD_HISTORY = 200;
type HistoryAction = 'assigned' | 'unassigned' | 'status' | 'verification-requested' | 'verification-confirmed'
    | 'verification-rejected' | 'verification-canceled' | 'priority' | 'title-written' | 'title-edited' | 'title-cleared'
    | 'agent-attached' | 'agent-updated' | 'agent-removed' | 'public' | 'private' | 'moved';
export type DbThreadHistoryEntry = {
    id: string; at: string; actorId: string; action: HistoryAction;
    /** Protect activity from a private period even after publication. No text, URLs or credentials. */
    private: boolean;
    userId?: string;
    agentKind?: AgentKind;
    status?: ReturnType<typeof feedbackStage>;
    priority?: ReturnType<typeof commentPriority>;
};
export type ThreadHistoryEntry = { id: string; at: string; description: string };

/** Diff the authorized latest version inside its ETag/receipt write, never after persistence. */
export function withThreadHistory(previous: DbComment, next: DbComment, actorId: string, at = new Date().toISOString()): DbComment {
    const entries: DbThreadHistoryEntry[] = [];
    const add = (action: HistoryAction, detail: Partial<Pick<DbThreadHistoryEntry, 'userId' | 'agentKind' | 'status' | 'priority'>> = {}) => {
        entries.push({ id: randomUUID(), at, actorId, action, private: Boolean(previous.private || next.private), ...detail });
    };
    const before = assignedUserIds(previous), after = assignedUserIds(next);
    for (const userId of before) if (!after.includes(userId)) add('unassigned', { userId });
    for (const userId of after) if (!before.includes(userId)) add('assigned', { userId });
    const oldAgents = assignedAgents(previous), newAgents = assignedAgents(next);
    const key = (agent: typeof oldAgents[number]) => `${agent.assigneeId}:${agent.id ?? 'legacy'}`;
    const details = (agent: typeof oldAgents[number]) => JSON.stringify([agent.kind, agent.model, agent.reasoning, agent.sessionId, agent.connector?.credentialId]);
    for (const agent of oldAgents) if (!newAgents.some(other => key(other) === key(agent)))
        add('agent-removed', { userId: agent.assigneeId, agentKind: agent.kind });
    for (const agent of newAgents) {
        const old = oldAgents.find(other => key(other) === key(agent));
        if (!old || details(old) !== details(agent)) add(old ? 'agent-updated' : 'agent-attached', { userId: agent.assigneeId, agentKind: agent.kind });
    }
    if (feedbackStage(previous) !== feedbackStage(next)) add('status', { status: feedbackStage(next) });
    if (previous.verification?.revision !== next.verification?.revision && next.verification
        && ['pending', 'confirmed', 'needs-work', 'canceled'].includes(next.verification.outcome)) {
        const outcome = next.verification.outcome;
        add(outcome === 'pending' ? 'verification-requested' : outcome === 'confirmed' ? 'verification-confirmed'
            : outcome === 'needs-work' ? 'verification-rejected' : 'verification-canceled');
    } else if (previous.verification?.outcome === 'pending' && next.verification?.outcome !== 'pending') {
        add('verification-canceled');
    }
    if (commentPriority(previous.priority) !== commentPriority(next.priority)) add('priority', { priority: commentPriority(next.priority) });
    if (previous.aiTitle?.text !== next.aiTitle?.text || previous.aiTitle?.source !== next.aiTitle?.source)
        add(next.aiTitle ? actorId === 'system:ai-title' ? 'title-written' : 'title-edited' : 'title-cleared');
    if (Boolean(previous.private) !== Boolean(next.private)) add(next.private ? 'private' : 'public');
    if (previous.domain !== next.domain || previous.path !== next.path || previous.origin !== next.origin
        || previous.anchorContext?.revision !== next.anchorContext?.revision) add('moved');
    return entries.length ? { ...next, history: [...(previous.history ?? []), ...entries].slice(-MAX_THREAD_HISTORY) } : next;
}

/** Fresh member directory only. Guest DTOs omit history entirely; private-period entries stay restricted. */
export function threadHistoryView(comment: DbComment, viewer: { member: boolean; authorId?: string; admin?: boolean }, names: Map<string, string>): ThreadHistoryEntry[] | undefined {
    if (!viewer.member) return undefined;
    const person = (id: string) => names.get(id) ?? 'Former member';
    return comment.history?.filter(entry => !entry.private || viewer.admin || Boolean(viewer.authorId && viewer.authorId === comment.authorId)).map(entry => {
        const who = entry.actorId === 'system:ai-title' ? 'AI' : entry.actorId === 'system:uier' ? 'uier'
            : entry.actorId.startsWith('integration:') ? integrationLabels[entry.actorId.slice(12) as keyof typeof integrationLabels] ?? 'Connected service'
                : entry.actorId.startsWith('user:') ? person(entry.actorId.slice(5))
                    : comment.thread.items.find(item => !item.deletedAt && item.authorId === entry.actorId)?.authorName ?? 'Reviewer';
        const target = entry.userId ? person(entry.userId) : 'someone';
        const agent = entry.agentKind ? agentLabels[entry.agentKind] : 'an AI agent';
        const actions: Record<HistoryAction, string> = {
            assigned: `assigned ${target}`, unassigned: `unassigned ${target}`,
            status: `changed status to ${entry.status ? feedbackStageLabels[entry.status] : 'Open'}`,
            'verification-requested': 'requested verification', 'verification-confirmed': 'confirmed the fix',
            'verification-rejected': 'rejected the fix', 'verification-canceled': 'canceled verification',
            priority: `changed priority to ${entry.priority ? priorityLabels[entry.priority] : 'Normal'}`,
            'title-written': 'wrote the title', 'title-edited': 'edited the title', 'title-cleared': 'cleared the title',
            'agent-attached': `attached ${agent} under ${target}`, 'agent-updated': `updated ${agent} under ${target}`,
            'agent-removed': `removed ${agent} from ${target}`, public: 'made the thread public', private: 'made the thread private', moved: 'moved the thread'
        };
        return { id: entry.id, at: entry.at, description: `${who} ${actions[entry.action]}.` };
    });
}
