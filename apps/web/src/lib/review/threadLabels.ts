import type { DbProject } from '../app/model';
import { assignedLabelIds, MAX_THREAD_LABELS } from '../app/threadLabel';
import { threadLabelIdsSchema, threadLabelModeSchema } from '../app/threadLabelSchema';
import { loadThreadLabels } from '../app/threadLabels';
import { withThreadActivity } from '../comments/activity';
import { apiErrors } from '../comments/http';
import { submission } from '../comments/submissions';
import { idempotencyKeySchema } from '../comments/validation';
import { actorAuthorId, refreshMutationActor, type ProjectActor } from './actor';
import { canTriageProject, changeComment, projectPartition } from './comments';

/** Atomic add/remove preserves other labels during concurrent triage. Retries replay a scoped receipt. */
export async function changeProjectCommentLabels(project: DbProject, actor: ProjectActor, id: string, labelIds: string[], mode: 'add' | 'remove', idempotencyKey: string) {
    const ids = threadLabelIdsSchema.safeParse(labelIds);
    if (!ids.success || !threadLabelModeSchema.safeParse(mode).success || !idempotencyKeySchema.safeParse(idempotencyKey).success)
        throw apiErrors.invalidRequest('Choose distinct labels, an add or remove action, and a valid submission key.');
    labelIds = [...ids.data].sort();
    return changeComment(project, actor, id, () => canTriageProject(project, actor), async comment => {
        const currentProject = await refreshMutationActor(project, actor);
        const catalog = await loadThreadLabels(currentProject);
        if (mode === 'add' && labelIds.some(id => !catalog.some(label => label.id === id)))
            throw apiErrors.invalidRequest('Choose labels available in this project.');
        const previous = assignedLabelIds(comment);
        // A removed definition cannot consume one of the thread's slots forever. A removal can also clear old IDs.
        const next = mode === 'add' ? [...new Set([...previous.filter(id => catalog.some(label => label.id === id)), ...labelIds])]
            : previous.filter(id => !labelIds.includes(id));
        if (next.length > MAX_THREAD_LABELS) throw apiErrors.invalidRequest('A thread can have up to 20 labels.');
        if (previous.length === next.length && previous.every(id => next.includes(id))) return comment;
        return { ...withThreadActivity(comment, actorAuthorId(actor)!), labelIds: next };
    }, submission(projectPartition(project.id), actorAuthorId(actor)!, idempotencyKey, { operation: 'labels', id, labelIds, mode }));
}
