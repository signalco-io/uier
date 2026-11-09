import { verificationDetails, verificationPermissions } from './fixVerificationDto';
import { feedbackSource, type FeedbackSource } from '../app/environments';
import { readActivity } from '../comments/activity';
import type { DbComment, DbThreadItem } from '../db/schema';
import { toCommentDto, type CommentDto } from '../comments/dto';
import { toReproductionContext, type ReproductionContext } from '../comments/reproduction';
export { authorNames } from '../comments/authorNames';
import { listProjectMembers } from '../app/members';
import type { DbProject } from '../app/model';
import { actorAuthorId, type ProjectActor } from './actor';
import { assigneeAgentView } from './assigneeAgentModel';
import { messageAgentView } from './messageAgent';
import { canTriageProject, canDeleteComment, canDeleteItem, canEditComment, canEditItem, canResolveComment } from './comments';

const memberPrefix = 'user:';

/**
 * An item's author name: the member's name, the guest's name, or "Guest". A member's message from a coding
 * tool says how: "Ana via Claude" (the agent that wrote it), or "Ana via <connection name>" on older messages.
 */
export function itemAuthorName(item: Pick<DbThreadItem, 'authorId' | 'authorName' | 'agent' | 'writtenBy'>, names: Map<string, string>) {
    if (item.authorId?.startsWith(memberPrefix)) {
        const agent = messageAgentView(item, false);
        return `${itemPersonName(item, names)}${agent ? ` via ${agent.label}` : item.agent ? ` via ${item.agent.name}` : ''}`;
    }
    return item.authorName || 'Guest';
}

/** The person alone: a member's name without the agent or connection they wrote through */
export function itemPersonName(item: Pick<DbThreadItem, 'authorId' | 'authorName'>, names: Map<string, string>) {
    if (item.authorId?.startsWith(memberPrefix))
        return names.get(item.authorId.slice(memberPrefix.length)) ?? 'Former member';
    return item.authorName || 'Guest';
}

export async function participantNames(project: DbProject) {
    return new Map((await listProjectMembers(project.workspaceId, project.id)).filter(({ user }) => user).map(({ member, name }) => [member.userId, name]));
}

export function messageMentions(item: DbThreadItem, names: Map<string, string>) {
    return item.mentions?.map(mention => ({ ...mention, name: names.get(mention.userId) ?? 'Former member' }));
}

export type ReviewCommentDto = CommentDto & {
    source?: FeedbackSource;
    /** `agent`: the AI agent working under the assignee, for members only */
    assignee?: { id?: string; name: string; isMe: boolean; unavailable: boolean; agent?: import('@uier/toolbar/agents').AssigneeAgentView };
    private: boolean;
    reproduction?: ReproductionContext;
    /** What the current reviewer may do (the toolbar shows only these actions) */
    verificationPermissions?: import('@uier/toolbar/verification').VerificationPermissions;
    permissions: { resolve: boolean; delete: boolean; edit: boolean; assign: boolean; priority: boolean };
    /** `agent`: the AI agent that wrote the message for its author (its model and reasoning level for members only) */
    thread: { items: (CommentDto['thread']['items'][number] & { canDelete?: boolean; canEdit?: boolean; mentions?: ReturnType<typeof messageMentions>; agent?: import('@uier/toolbar/agents').MessageAgentView })[] };
};

/**
 * A project comment for the toolbar: the public comment shape (`CommentDto`) with project names
 * and permissions. Detailed reproduction context is member-only; author ids are never exposed.
 */
export function toReviewCommentDto(comment: DbComment, actor: ProjectActor, names: Map<string, string>, origins: readonly string[] = [], readSequence = 0, participants = names, project?: DbProject): ReviewCommentDto | null {
    const authorId = actorAuthorId(actor);
    const agent = actor.kind === 'member' ? assigneeAgentView(comment) : undefined;
    const dto = toCommentDto(comment, authorId, names);
    if (!dto)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    return {
        ...dto,
        ...(project ? { verification: verificationDetails(comment, project, actor, participants), verificationPermissions: verificationPermissions(comment, project, actor, participants) } : {}),
        ...(project ? { source: feedbackSource(project, comment.origin) } : {}),
        activity: readActivity(comment, authorId, readSequence),
        ...(actor.kind === 'member' ? { reproduction: toReproductionContext(comment, origins) } : {}),
        private: comment.private === true,
        assignee: comment.assigneeId ? {
            ...(actor.kind === 'member' ? { id: comment.assigneeId } : {}),
            name: participants.get(comment.assigneeId) ?? 'Former member',
            isMe: actor.kind === 'member' && actor.userId === comment.assigneeId && participants.has(comment.assigneeId),
            unavailable: !participants.has(comment.assigneeId),
            ...(agent ? { agent } : {})
        } : undefined,
        permissions: {
            priority: canTriageProject({ id: project?.id ?? comment.projectId ?? comment.domain.replace(/^project:/, '') }, actor),
            resolve: canResolveComment(comment, actor),
            edit: canEditComment(comment, actor) && !items[0]?.deletedAt,
            assign: actor.kind === 'member',
            delete: canDeleteComment(comment, actor)
        },
        thread: {
            items: dto.thread.items.map((itemDto) => {
                const item = items.find(i => String(i.id) === itemDto.id);
                if (!item || 'deleted' in itemDto)
                    return itemDto;
                const writtenBy = messageAgentView(item, actor.kind === 'member');
                return {
                    ...itemDto,
                    ...(actor.kind === 'member' ? { mentions: messageMentions(item, participants) } : {}),
                    author: { ...itemDto.author, name: itemAuthorName(item, names) },
                    ...(writtenBy ? { agent: writtenBy } : {}),
                    canDelete: canDeleteItem(item, actor),
                    canEdit: canEditItem(item, actor)
                };
            })
        }
    };
}
