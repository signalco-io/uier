import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { commentPriority, type CommentPriority } from '@uier/toolbar/triage';
import type { DbProject } from '../app/model';
import { ApiError, apiErrors } from '../comments/http';
import { refreshMutationActor, type ProjectActor } from './actor';
import { canTriageProject, setProjectCommentAssignee, setProjectCommentPriority, setProjectCommentResolved, type CommentChangeGuard } from './comments';
import { bulkTriageSchema } from './bulkTriageSchema';
import { commentRevision } from './commentRevision';

export type TriageResult = { id: string; outcome: 'success' | 'noop' | 'conflict' | 'unavailable' | 'failure';
    saved?: { priority: CommentPriority; resolved: boolean; inProgress: boolean; assigneeId: string | null; revision: string } };
/** Partial success, at most four writes in flight. No client ids or snapshots confer authority. */
export async function triageProjectComments(project: DbProject, actor: ProjectActor, raw: unknown, store: CommentsStore = getCommentsStore()) {
    const parsed = bulkTriageSchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.invalidRequest('Choose 1–50 distinct threads and a valid action.');
    const input = parsed.data;
    await refreshMutationActor(project, actor);
    if (!canTriageProject(project, actor)) throw apiErrors.forbidden('Only project members can triage feedback.');
    const results: TriageResult[] = new Array(input.items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, input.items.length) }, async () => {
        for (;;) {
            const index = next++;
            const item = input.items[index];
            if (!item) return;
            try {
                let changed = false;
                const guard: CommentChangeGuard = {
                    expected: item.expected,
                    triage: true,
                    value: comment => input.kind === 'priority' ? commentPriority(comment.priority)
                        : input.kind === 'assignment' ? comment.assigneeId ?? null : Boolean(comment.resolved),
                    ...('revision' in item ? { revision: item.revision } : {}),
                    onResult: value => { changed = value; }
                };
                // Status deliberately stays in the shared service. The opaque content revision also
                // covers future verification fields; this path never creates reviewer confirmation.
                const saved = input.kind === 'priority' ? await setProjectCommentPriority(project, actor, item.id, input.priority, item.idempotencyKey, guard, store)
                    : input.kind === 'assignment' ? await setProjectCommentAssignee(project, actor, item.id, input.assigneeId, item.idempotencyKey, guard, store)
                    : await setProjectCommentResolved(project, actor, item.id, input.resolved, item.idempotencyKey, guard, store);
                results[index] = { id: item.id, outcome: changed ? 'success' : 'noop', saved: {
                    priority: commentPriority(saved.priority), resolved: Boolean(saved.resolved), inProgress: Boolean(saved.inProgress && !saved.resolved), assigneeId: saved.assigneeId ?? null, revision: commentRevision(saved)
                } };
            } catch (error) {
                results[index] = { id: item.id, outcome: error instanceof ApiError && error.code === 'conflict' ? 'conflict'
                    : error instanceof ApiError && ['not_found', 'forbidden', 'sign_in_required'].includes(error.code) ? 'unavailable' : 'failure' };
            }
        }
    }));
    return { results, counts: {
        success: results.filter(item => item.outcome === 'success').length,
        noop: results.filter(item => item.outcome === 'noop').length,
        conflict: results.filter(item => item.outcome === 'conflict').length,
        unavailable: results.filter(item => item.outcome === 'unavailable').length,
        failure: results.filter(item => item.outcome === 'failure').length
    } };
}
