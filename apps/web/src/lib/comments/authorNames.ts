import type { DbComment } from '../db/schema';
import { getUser } from '../app/users';

/** Current account names, loaded once per author/assignee. Guest names stay on their messages. */
export async function authorNames(comments: DbComment[]) {
    const items = comments.flatMap(comment => Array.isArray(comment.thread?.items) ? comment.thread.items : [])
        .filter(item => typeof item === 'object' && item !== null);
    const memberIds = items.map(item => item.authorId)
        .filter((id): id is string => typeof id === 'string' && id.startsWith('user:'))
        .map(id => id.slice('user:'.length));
    const extraIds = comments.map(comment => comment.assigneeId).filter((id): id is string => Boolean(id));
    const users = await Promise.all([...new Set([...memberIds, ...extraIds])].map(id => getUser(id)));
    return new Map(users.flatMap(user => user ? [[user.id, user.name] as const] : []));
}
