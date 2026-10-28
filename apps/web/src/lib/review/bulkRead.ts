import type { DbProject } from '../app/model';
import { findProject } from '../app/projects';
import { markThreadsRead } from '../comments/bulkRead';
import { apiErrors } from '../comments/http';
import { actorAuthorId, assertCanUseComments, assertWriter, memberActor, type ProjectActor } from './actor';
import { getProjectComment } from './comments';

/** Used by the app and verified review API; current access is checked before and during the batch. */
export async function markProjectThreadsRead(project: DbProject, actor: ProjectActor, input: unknown) {
    assertWriter(actor);
    const authorize = async () => {
        const current = await findProject(project.id);
        if (!current) throw apiErrors.notFound();
        const reviewer = actor.kind === 'member' ? await memberActor(current, actor.userId) : actor;
        if (!reviewer) throw apiErrors.signInRequired();
        assertCanUseComments(current, reviewer);
        return { current, reviewer };
    };
    await authorize();
    return markThreadsRead(input, actorAuthorId(actor), async id => {
        const { current, reviewer } = await authorize();
        return getProjectComment(current, reviewer, id);
    });
}
