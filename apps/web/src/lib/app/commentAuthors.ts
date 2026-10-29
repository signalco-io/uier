import { getAppStore } from './store';
import { workspacePk, type AppDoc, type DbProject } from './model';
import type { AppContext } from './context';
import { UserFacingError } from './actionErrors';
import { isRandomToken, randomToken, sha256Hex } from './tokens';
import { appActor } from './projectComments';
import { getProjectComment } from '../review/comments';
import { authorNames, itemAuthorName } from '../review/dto';
import type { AuthorFilter } from '../../components/app/comments/commentLabels';

const ttl = 24 * 60 * 60;
const filterId = (reference: string) => `comment-author_${sha256Hex(reference)}`;
type DbCommentAuthor = AppDoc & {
    type: 'comment-author'; projectId: string; userId: string; authorId: string; name: string; expiresAt: string;
};

/** Create only from a currently visible item. The browser never supplies an author id. */
export async function createCommentAuthorFilter(context: AppContext, project: DbProject, commentId: string, itemId?: string) {
    if (!context.isAdmin) throw new UserFacingError('Only admins can filter by author.');
    const comment = await getProjectComment(project, appActor(context), commentId);
    const item = itemId ? comment?.thread.items.find(item => item.id === itemId) : comment?.thread.items[0];
    const authorId = item?.authorId ?? (!itemId ? comment?.authorId : undefined);
    if (!comment || !item || !authorId || item.deletedAt)
        throw new UserFacingError('This author is no longer available.');
    const reference = randomToken();
    await getAppStore().create<DbCommentAuthor>({
        type: 'comment-author', id: filterId(reference), pk: workspacePk(project.workspaceId),
        projectId: project.id, userId: context.user.id, authorId,
        name: itemAuthorName(item, await authorNames([comment])),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), ttl
    });
    return reference;
}

/** Recheck admin access and bind the opaque reference to its project and requesting account. */
export async function resolveCommentAuthorFilter(context: AppContext, project: DbProject, reference: string): Promise<{ authorId: string; filter: AuthorFilter } | null> {
    if (!context.isAdmin || !isRandomToken(reference)) return null;
    const entry = (await getAppStore().get<DbCommentAuthor>(workspacePk(project.workspaceId), filterId(reference)))?.doc;
    if (!entry || entry.type !== 'comment-author' || entry.projectId !== project.id || entry.userId !== context.user.id
        || Date.parse(entry.expiresAt) <= Date.now()) return null;
    return { authorId: entry.authorId, filter: { reference, name: entry.name } };
}
