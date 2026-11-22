import type { DbComment } from '../db/schema';
import { threadActivity } from '../comments/activity';
import type { NotificationEvent } from './delivery';
import { isUierFeedbackProject } from '../comments/publicProject';

/** Call on the already advanced #83 activity, inside the same etag-protected comment write. */
export function withNotificationEvent(comment: DbComment, actorId: string, kind: NotificationEvent['kind'], at = new Date().toISOString(), recipients?: string[], agent?: import('../db/schema').AgentSource, details: Pick<NotificationEvent, 'statusResolved' | 'previousStatusId' | 'statusId' | 'statusLabel' | 'statusCategory' | 'itemId' | 'assigneeId' | 'verificationOverride' | 'verificationId' | 'assigneeAgent' | 'assigneeIds' | 'previousAssigneeIds' | 'agentId'> = {}): DbComment {
    // Every project action feeds MCP, including the owner’s web actions. uier feedback
    // projects retain the ledger without queuing owner email.
    if (!comment.projectId) return comment;
    const sequence = threadActivity(comment).sequence;
    const reviewHeld = Boolean(comment.reviewSession && !comment.reviewSession.releasedAt);
    const publishedAt = comment.reviewSession?.releasedAt;
    const eventAt = publishedAt && at <= publishedAt ? new Date(Date.parse(publishedAt) + 1).toISOString() : at;
    return { ...comment, ...(reviewHeld ? {} : { notificationPending: !isUierFeedbackProject(comment.projectId) }), notificationEvents: [...(comment.notificationEvents ?? []),
        { sequence, actorId, kind, at: eventAt, ...details, ...(reviewHeld ? { reviewHeld: true as const } : {}),
            ...(recipients?.length ? { recipients: [...new Set(recipients)] } : {}), ...(agent ? { agent } : {}) }] };
}
