import { feedbackSource } from './environments';
import type { DbProject } from './model';
import { readActivity } from '../comments/activity';
import { commentPath } from '../comments/dto';
import type { DbComment } from '../db/schema';
import { assigneeAgentViews } from '../review/assigneeAgentModel';

import { assignedUserIds } from '../review/assignments';

/** Shared inbox/connector routing for an already authorized, visible thread. */
export function projectCommentRouting(comment: DbComment, project: DbProject, participants: Map<string, string>, authorId: string | undefined, readSequence = 0) {
    const assignees = assignedUserIds(comment).map(id => {
        const agents = assigneeAgentViews(comment, id);
        return { id, name: participants.get(id) ?? 'Former member', agents, ...(agents[0] ? { agent: agents[0] } : {}) };
    });
    return {
        path: commentPath(comment),
        source: feedbackSource(project, comment.origin),
        assignees, assignee: assignees[0],
        activity: readActivity(comment, authorId, readSequence)
    };
}
