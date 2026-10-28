import { feedbackSource } from './environments';
import type { DbProject } from './model';
import { readActivity } from '../comments/activity';
import { commentPath } from '../comments/dto';
import type { DbComment } from '../db/schema';

/** Shared inbox/connector routing for an already authorized, visible thread. */
export function projectCommentRouting(comment: DbComment, project: DbProject, participants: Map<string, string>, authorId: string | undefined, readSequence = 0) {
    return {
        path: commentPath(comment),
        source: feedbackSource(project, comment.origin),
        assignee: comment.assigneeId ? { id: comment.assigneeId, name: participants.get(comment.assigneeId) ?? 'Former member' } : undefined,
        activity: readActivity(comment, authorId, readSequence)
    };
}
