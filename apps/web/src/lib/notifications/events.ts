import type { DbComment } from '../db/schema';
import { threadActivity } from '../comments/activity';
import type { NotificationEvent } from './delivery';
import { PUBLIC_PROJECT_ID } from '../comments/publicProject';

/** Call on the already advanced #83 activity, inside the same etag-protected comment write. */
export function withNotificationEvent(comment: DbComment, actorId: string, kind: NotificationEvent['kind'], at = new Date().toISOString(), recipients?: string[], agent?: import('../db/schema').AgentSource, details: Pick<NotificationEvent, 'itemId' | 'assigneeId'> = {}): DbComment {
    // The public showcase never queues owner email. Explicit connector actions still retain
    // attribution in the existing activity ledger, without creating a notification job.
    if (!comment.projectId || (comment.projectId === PUBLIC_PROJECT_ID && !agent)) return comment;
    const sequence = threadActivity(comment).sequence;
    return { ...comment, notificationPending: comment.projectId !== PUBLIC_PROJECT_ID, notificationEvents: [...(comment.notificationEvents ?? []),
        { sequence, actorId, kind, at, ...details, ...(recipients?.length ? { recipients: [...new Set(recipients)] } : {}), ...(agent ? { agent } : {}) }] };
}
