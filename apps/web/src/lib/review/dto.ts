import type { DbComment, DbThreadItem } from '../db/schema';
import { toCommentDto, type CommentDto } from '../comments/dto';
import { toReproductionContext, type ReproductionContext } from '../comments/reproduction';
import { getUser } from '../app/users';
import { actorAuthorId, type ProjectActor } from './actor';
import { canDeleteComment, canDeleteItem, canEditComment, canEditItem, canResolveComment } from './comments';

const memberPrefix = 'user:';

/**
 * Display names of the authors of these comments: members by their account name, guests by the
 * name they gave. Members are looked up once each.
 */
export async function authorNames(comments: DbComment[]) {
    const items = comments.flatMap(comment => Array.isArray(comment.thread?.items) ? comment.thread.items : []);
    const memberIds = [...new Set(items
        .map(item => item.authorId)
        .filter((id): id is string => Boolean(id?.startsWith(memberPrefix)))
        .map(id => id.slice(memberPrefix.length)))];
    const extraIds = comments.map(comment => comment.assigneeId).filter((id): id is string => Boolean(id));
    const users = await Promise.all([...new Set([...memberIds, ...extraIds])].map(id => getUser(id)));
    const names = new Map<string, string>();
    for (const user of users) {
        if (user)
            names.set(user.id, user.name);
    }
    return names;
}

/** An item's author name: the member's name, the guest's name, or "Guest" */
export function itemAuthorName(item: Pick<DbThreadItem, 'authorId' | 'authorName'>, names: Map<string, string>) {
    if (item.authorId?.startsWith(memberPrefix))
        return names.get(item.authorId.slice(memberPrefix.length)) ?? 'Former member';
    return item.authorName || 'Guest';
}

export type ReviewCommentDto = CommentDto & {
    private: boolean;
    reproduction?: ReproductionContext;
    /** What the current reviewer may do (the toolbar shows only these actions) */
    permissions: { resolve: boolean; delete: boolean; edit: boolean };
    thread: { items: (CommentDto['thread']['items'][number] & { canDelete?: boolean; canEdit?: boolean })[] };
};

/**
 * A project comment for the toolbar: the public comment shape (`CommentDto`) with project names
 * and permissions. Detailed reproduction context is member-only; author ids are never exposed.
 */
export function toReviewCommentDto(comment: DbComment, actor: ProjectActor, names: Map<string, string>, origins: readonly string[] = []): ReviewCommentDto | null {
    const authorId = actorAuthorId(actor);
    const dto = toCommentDto(comment, authorId);
    if (!dto)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    return {
        ...dto,
        ...(actor.kind === 'member' ? { reproduction: toReproductionContext(comment, origins) } : {}),
        private: comment.private === true,
        permissions: {
            resolve: canResolveComment(comment, actor),
            edit: canEditComment(comment, actor) && !items[0]?.deletedAt,
            delete: canDeleteComment(comment, actor)
        },
        thread: {
            items: dto.thread.items.map((itemDto) => {
                const item = items.find(i => String(i.id) === itemDto.id);
                if (!item || 'deleted' in itemDto)
                    return itemDto;
                return {
                    ...itemDto,
                    author: { ...itemDto.author, name: itemAuthorName(item, names) },
                    canDelete: canDeleteItem(item, actor),
                    canEdit: canEditItem(item, actor)
                };
            })
        }
    };
}
