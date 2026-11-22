import type { DbProject } from '../app/model';
import type { DbComment, DbReviewRelease } from '../db/schema';
import { commentPageCursor, type CommentPageOptions } from '../repo/commentPage';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from './actor';
import { canSeeCommentPrivacy, commentVisibilityFilter, projectPartition } from './comments';
import { reviewReleaseId } from './reviewSessionRelease';

export const reviewSessionIdPattern = /^[a-zA-Z0-9_-]{1,72}$/;

/** Reuse release point reads across a page while checking membership for each thread. */
export function publishedReviewReader(store: CommentsStore = getCommentsStore()) {
    const releases = new Map<string, Promise<DbReviewRelease | undefined>>();
    return async (comment: Pick<DbComment, 'id' | 'domain' | 'reviewSession'>) => {
        const session = comment.reviewSession;
        if (!session) return undefined;
        const key = JSON.stringify([comment.domain, session.id, session.revision]);
        let pending = releases.get(key);
        if (!pending) {
            pending = store.reviewSessionRecord<DbReviewRelease>(comment.domain, reviewReleaseId(session.id, session.revision))
                .then(record => record?.doc.type === 'review-release' ? record.doc : undefined);
            releases.set(key, pending);
        }
        const release = await pending;
        if (!release?.threadIds.includes(comment.id)) return undefined;
        return { id: session.id, revision: session.revision, number: release.number };
    };
}

/** Keyset scan until the published page is filled. Held threads never occupy slots or cursors. */
export async function listPublishedFeedback(project: DbProject, actor: ProjectActor, options: CommentPageOptions, signal?: AbortSignal) {
    if (actor.proofThread) return [];
    const domain = projectPartition(project.id);
    const store = getCommentsStore();
    const review = publishedReviewReader(store);
    const result: { comment: DbComment; reviewSession?: Awaited<ReturnType<typeof review>> }[] = [];
    let size = Math.min(1000, options.limit);
    let before = options.before;
    while (result.length < options.limit) {
        signal?.throwIfAborted();
        const rows = await store.listPage(domain, { ...options, limit: size, before, visibility: commentVisibilityFilter(domain, actor) });
        const visible = rows.filter(comment => !comment.assetTarget && canSeeCommentPrivacy(comment, actor));
        for (let index = 0; index < visible.length; index += 8) {
            const batch = visible.slice(index, index + 8);
            const projects = await Promise.all(batch.map(comment => review(comment)));
            for (const [offset, comment] of batch.entries()) {
                const reviewSession = projects[offset];
                if (comment.reviewSession && !reviewSession) continue;
                result.push({ comment, reviewSession });
                if (result.length === options.limit) return result;
            }
        }
        if (rows.length < size) break;
        before = commentPageCursor(rows.at(-1)!);
        size = Math.max(size, 100);
    }
    return result;
}
