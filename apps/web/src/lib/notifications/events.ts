import type { DbComment } from '../db/schema';
import { threadActivity } from '../comments/activity';
import type { NotificationEvent } from './delivery';
import { isUierFeedbackProject } from '../comments/publicProject';

/** Call on the already advanced #83 activity, inside the same etag-protected comment write. */
export function withNotificationEvent(comment: DbComment, actorId: string, kind: NotificationEvent['kind'], at = new Date().toISOString(), recipients?: string[], agent?: import('../db/schema').AgentSource, details: Pick<NotificationEvent, 'itemId' | 'assigneeId' | 'verificationOverride' | 'assigneeAgent' | 'assigneeIds' | 'previousAssigneeIds' | 'agentId'> = {}): DbComment {
    // Every project action feeds MCP, including the owner’s web actions. uier feedback
    // projects retain the ledger without queuing owner email.
    if (!comment.projectId) return comment;
    const sequence = threadActivity(comment).sequence;
    return { ...comment, notificationPending: !isUierFeedbackProject(comment.projectId), notificationEvents: [...(comment.notificationEvents ?? []),
        { sequence, actorId, kind, at, ...details, ...(recipients?.length ? { recipients: [...new Set(recipients)] } : {}), ...(agent ? { agent } : {}) }] };
}
