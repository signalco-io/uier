import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import { randomUUID } from 'node:crypto';
import { agentLabels, type AgentKind } from '@uier/toolbar/agents';
import { commentPriority, priorityLabels } from '@uier/toolbar/triage';
import { feedbackStage, feedbackStageLabels } from '@uier/toolbar/verification';
import type { DbComment } from '../db/schema';
import { assignedAgents, assignedUserIds } from '../review/assignments';
import { integrationLabels } from '../integrations/model';

/** Separate from unread cursors and delivery outboxes. Oldest entries are discarded in the same write. */
export const MAX_THREAD_HISTORY = 200;
type HistoryAction = 'archived' | 'restored' | 'assigned' | 'unassigned' | 'status' | 'verification-requested' | 'verification-confirmed'
    | 'verification-rejected' | 'verification-canceled' | 'priority' | 'title-written' | 'title-edited' | 'title-cleared'
    | 'pull-request-linked' | 'pull-request-removed'
    | 'agent-attached' | 'agent-updated' | 'agent-removed' | 'public' | 'private' | 'moved';
export type DbThreadHistoryEntry = {
    id: string; at: string; actorId: string; action: HistoryAction;
    /** Protect activity from a private period even after publication. No text, URLs or credentials. */
    private: boolean;
    userId?: string;
    agentKind?: AgentKind;
    status?: ReturnType<typeof feedbackStage>;
    statusId?: string; statusLabel?: string;
    priority?: ReturnType<typeof commentPriority>;
};
export type ThreadHistoryEntry = { id: string; at: string; description: string };

/** Diff the authorized latest version inside its ETag/receipt write, never after persistence. */
export function withThreadHistory(previous: DbComment, next: DbComment, actorId: string, at = new Date().toISOString()): DbComment {
    const entries: DbThreadHistoryEntry[] = [];
    const add = (action: HistoryAction, detail: Partial<Pick<DbThreadHistoryEntry, 'userId' | 'agentKind' | 'status' | 'priority' | 'statusId' | 'statusLabel'>> = {}) => {
        entries.push({ id: randomUUID(), at, actorId, action, private: Boolean(previous.private || next.private), ...detail });
    };
    for (const link of next.pullRequests ?? []) if (!previous.pullRequests?.some(old => old.url === link.url)) add('pull-request-linked');
    for (const link of previous.pullRequests ?? []) if (!next.pullRequests?.some(saved => saved.url === link.url)) add('pull-request-removed');
    const before = assignedUserIds(previous), after = assignedUserIds(next);
    for (const userId of before) if (!after.includes(userId)) add('unassigned', { userId });
    for (const userId of after) if (!before.includes(userId)) add('assigned', { userId });
    const oldAgents = assignedAgents(previous), newAgents = assignedAgents(next);
    const key = (agent: typeof oldAgents[number]) => `${agent.assigneeId}:${agent.id ?? 'legacy'}`;
    const details = (agent: typeof oldAgents[number]) => JSON.stringify([agent.kind, agent.model, agent.reasoning, agent.sessionId, agent.sessionUrl, agent.connector?.credentialId]);
    for (const agent of oldAgents) if (!newAgents.some(other => key(other) === key(agent)))
        add('agent-removed', { userId: agent.assigneeId, agentKind: agent.kind });
    for (const agent of newAgents) {
        const old = oldAgents.find(other => key(other) === key(agent));
        if (!old || details(old) !== details(agent)) add(old ? 'agent-updated' : 'agent-attached', { userId: agent.assigneeId, agentKind: agent.kind });
    }
    if (Boolean(previous.archivedAt) !== Boolean(next.archivedAt)) add(next.archivedAt ? 'archived' : 'restored');
    if (feedbackStage(previous) !== feedbackStage(next) || previous.workflowStatusId !== next.workflowStatusId || (previous.archivedAt && next.archivedAt && previous.archiveStatusId !== next.archiveStatusId)) {
        const latest = next.notificationEvents?.at(-1);
        const event = latest && latest !== previous.notificationEvents?.at(-1) ? latest : undefined;
        add('status', { status: feedbackStage(next), statusId: event?.statusId, statusLabel: event?.statusLabel });
    }
    if (previous.verification?.revision !== next.verification?.revision && next.verification
        && ['pending', 'confirmed', 'needs-work', 'canceled'].includes(next.verification.outcome)) {
        const outcome = next.verification.outcome;
        add(outcome === 'pending' ? 'verification-requested' : outcome === 'confirmed' ? 'verification-confirmed'
            : outcome === 'needs-work' ? 'verification-rejected' : 'verification-canceled');
    } else if (previous.verification?.outcome === 'pending' && next.verification?.outcome !== 'pending') {
        add('verification-canceled');
    }
    if (commentPriority(previous.priority) !== commentPriority(next.priority)) add('priority', { priority: commentPriority(next.priority) });
    // A member's own title first: deleting the first message removes both titles in one entry
    if ((previous.manualTitle ?? '') !== (next.manualTitle ?? '')) add(next.manualTitle ? 'title-edited' : 'title-cleared');
    else if (previous.aiTitle?.text !== next.aiTitle?.text || previous.aiTitle?.source !== next.aiTitle?.source)
        add(next.aiTitle ? actorId === 'system:ai-title' ? 'title-written' : 'title-edited' : 'title-cleared');
    if (Boolean(previous.private) !== Boolean(next.private)) add(next.private ? 'private' : 'public');
    if (previous.domain !== next.domain || previous.path !== next.path || previous.origin !== next.origin
        || previous.anchorContext?.revision !== next.anchorContext?.revision) add('moved');
    return entries.length ? { ...next, history: [...(previous.history ?? []), ...entries].slice(-MAX_THREAD_HISTORY) } : next;
}

/** Fresh member directory only. Guest DTOs omit history entirely; private-period entries stay restricted. */
export function threadHistoryView(comment: DbComment, viewer: { member: boolean; authorId?: string; admin?: boolean }, names: Map<string, string>, t: AppTranslator = englishAppTranslator): ThreadHistoryEntry[] | undefined {
    if (!viewer.member) return undefined;
    const person = (id: string) => names.get(id) ?? t('Former member');
    return comment.history?.filter(entry => !entry.private || viewer.admin || Boolean(viewer.authorId && viewer.authorId === comment.authorId)).map(entry => {
        const who = entry.actorId === 'system:ai-title' ? 'AI' : entry.actorId === 'system:uier' ? 'uier'
            : entry.actorId.startsWith('integration:') ? integrationLabels[entry.actorId.slice(12) as keyof typeof integrationLabels] ?? t('Connected service')
                : entry.actorId.startsWith('user:') ? person(entry.actorId.slice(5))
                    : comment.thread.items.find(item => !item.deletedAt && item.authorId === entry.actorId)?.authorName ?? t('Reviewer');
        const target = entry.userId ? person(entry.userId) : t('someone');
        const agent = entry.agentKind ? agentLabels[entry.agentKind] : t('an AI agent');
        const actions: Record<HistoryAction, string> = {
            'pull-request-linked': t('linked a pull request'), 'pull-request-removed': t('removed a pull request link'),
            archived: t('archived the thread'), restored: t('restored the thread'),
            assigned: t('assigned {person}', { person: target }), unassigned: t('unassigned {person}', { person: target }),
            status: t('changed status to {status}', { status: entry.statusLabel ?? t(entry.status ? feedbackStageLabels[entry.status] : 'Open') }),
            'verification-requested': t('requested verification'), 'verification-confirmed': t('confirmed the fix'),
            'verification-rejected': t('rejected the fix'), 'verification-canceled': t('canceled verification'),
            priority: t('changed priority to {priority}', { priority: t(entry.priority ? priorityLabels[entry.priority] : 'Normal') }),
            'title-written': t('wrote the title'), 'title-edited': t('edited the title'), 'title-cleared': t('cleared the title'),
            'agent-attached': t('attached {agent} under {person}', { agent, person: target }),
            'agent-updated': t('updated {agent} under {person}', { agent, person: target }),
            'agent-removed': t('removed {agent} from {person}', { agent, person: target }),
            public: t('made the thread public'), private: t('made the thread private'), moved: t('moved the thread')
        };
        return { id: entry.id, at: entry.at, description: t('{actor} {action}.', { actor: who, action: actions[entry.action] }) };
    });
}
