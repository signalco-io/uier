import type { DbComment } from '../db/schema';
import { threadActivity } from '../comments/activity';
import type { NotificationEvent } from './delivery';
import { PUBLIC_PROJECT_ID } from '../comments/publicProject';

/** Call on the already advanced #83 activity, inside the same etag-protected comment write. */
export function withNotificationEvent(comment: DbComment, actorId: string, kind: NotificationEvent['kind'], at = new Date().toISOString(), recipients?: string[]): DbComment {
    // The public showcase is deliberately anonymous, with no owner email notifications.
    if (!comment.projectId || comment.projectId === PUBLIC_PROJECT_ID) return comment;
    const sequence = threadActivity(comment).sequence;
    return { ...comment, notificationPending: true, notificationEvents: [...(comment.notificationEvents ?? []),
        { sequence, actorId, kind, at, ...(recipients?.length ? { recipients: [...new Set(recipients)] } : {}) }] };
}
