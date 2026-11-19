import { UserFacingError } from './actionErrors';
import { userPk, type AppDoc, type DbWorkspace } from './model';
import type { AppStore } from './store';

export const preparationTimeout = 2 * 60_000;

export type AccountDeletion = AppDoc & {
    type: 'account-deletion';
    userId: string;
    attempt: string;
    requestedAt: string;
    status: 'preparing' | 'cancelled' | 'committed' | 'complete';
    workspaceIds: string[];
    closedWorkspaceIds: string[];
    email?: string;
};

/** Only a workspace with an active reservation needs the additional point read. A cancelled
 * attempt cannot commit, even if a delayed request still holds an old workspace snapshot. */
export async function assertWorkspaceWritable(workspace: DbWorkspace, store: AppStore) {
    const lock = workspace.accountDeletion;
    if (!lock) return;
    const job = await store.get<AccountDeletion>(userPk(lock.userId), 'account-deletion');
    if (job?.doc.attempt !== lock.attempt || job.doc.status === 'cancelled' || job.doc.status === 'complete') return;
    // A lost request need not block edits until the next worker run. Fence its commit first.
    if (job.doc.status === 'preparing' && Date.now() - Date.parse(job.doc.requestedAt) > preparationTimeout
        && await store.replace({ ...job.doc, status: 'cancelled' }, job.etag) === 'ok') return;
    throw new UserFacingError('Workspace access is changing. Try again shortly.');
}
