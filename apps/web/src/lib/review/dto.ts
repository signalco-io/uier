import { readActivity } from '../comments/activity';
import type { DbComment, DbThreadItem } from '../db/schema';
import { toCommentDto, type CommentDto } from '../comments/dto';
import { toReproductionContext, type ReproductionContext } from '../comments/reproduction';
export { authorNames } from '../comments/authorNames';
import { listProjectMembers } from '../app/members';
import type { DbProject } from '../app/model';
import { actorAuthorId, type ProjectActor } from './actor';
import { canDeleteComment, canDeleteItem, canEditComment, canEditItem, canResolveComment } from './comments';

const memberPrefix = 'user:';

/** An item's author name: the member's name, the guest's name, or "Guest" */
export function itemAuthorName(item: Pick<DbThreadItem, 'authorId' | 'authorName'>, names: Map<string, string>) {
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
    assignee?: { id?: string; name: string; isMe: boolean; unavailable: boolean };
    private: boolean;
    reproduction?: ReproductionContext;
    /** What the current reviewer may do (the toolbar shows only these actions) */
    permissions: { resolve: boolean; delete: boolean; edit: boolean; assign: boolean };
    thread: { items: (CommentDto['thread']['items'][number] & { canDelete?: boolean; canEdit?: boolean; mentions?: ReturnType<typeof messageMentions> })[] };
};

/**
 * A project comment for the toolbar: the public comment shape (`CommentDto`) with project names
 * and permissions. Detailed reproduction context is member-only; author ids are never exposed.
 */
export function toReviewCommentDto(comment: DbComment, actor: ProjectActor, names: Map<string, string>, origins: readonly string[] = [], readSequence = 0, participants = names): ReviewCommentDto | null {
    const authorId = actorAuthorId(actor);
    const dto = toCommentDto(comment, authorId, names);
    if (!dto)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    return {
        ...dto,
        activity: readActivity(comment, authorId, readSequence),
        ...(actor.kind === 'member' ? { reproduction: toReproductionContext(comment, origins) } : {}),
        private: comment.private === true,
        assignee: comment.assigneeId ? {
            ...(actor.kind === 'member' ? { id: comment.assigneeId } : {}),
            name: participants.get(comment.assigneeId) ?? 'Former member',
            isMe: actor.kind === 'member' && actor.userId === comment.assigneeId && participants.has(comment.assigneeId),
            unavailable: !participants.has(comment.assigneeId)
        } : undefined,
        permissions: {
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
                return {
                    ...itemDto,
                    ...(actor.kind === 'member' ? { mentions: messageMentions(item, participants) } : {}),
                    author: { ...itemDto.author, name: itemAuthorName(item, names) },
                    canDelete: canDeleteItem(item, actor),
                    canEdit: canEditItem(item, actor)
                };
            })
        }
    };
}
