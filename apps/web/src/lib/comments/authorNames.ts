import { assignedUserIds } from '../review/assignments';
import type { DbComment } from '../db/schema';
import { getUser } from '../app/users';
import { reactorUserIds } from './reactions';

/** Current account names, loaded once per author/assignee/reactor. Guest names stay on their messages. */
export async function authorNames(comments: DbComment[], loadUser: typeof getUser = getUser) {
    const items = comments.flatMap(comment => Array.isArray(comment.thread?.items) ? comment.thread.items : [])
        .filter(item => typeof item === 'object' && item !== null);
    const memberIds = items.map(item => item.authorId)
        .filter((id): id is string => typeof id === 'string' && id.startsWith('user:'))
        .map(id => id.slice('user:'.length));
    const extraIds = comments.flatMap(comment => [...assignedUserIds(comment), ...[comment.verification?.requester, comment.verification?.reviewer, comment.verification?.decision?.actorId].flatMap(id => id?.startsWith('user:') ? [id.slice(5)] : [])]).filter((id): id is string => Boolean(id));
    const users = await Promise.all([...new Set([...memberIds, ...extraIds, ...reactorUserIds(items)])].map(id => loadUser(id)));
    return new Map(users.flatMap(user => user ? [[user.id, user.name] as const] : []));
}
