import { nanoid } from 'nanoid';
import { apiErrors } from '../comments/http';
import { afterResponse } from '../afterResponse';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { revokeIntegrationGrantsOf } from '../integrations/connection';
import { userPk as mcpUserPk } from '../mcp/oauth/grants';
import { assertWorkspaceWritable, preparationTimeout, type AccountDeletion } from './accountDeletionGuard';
import { accessEvent, memberRemovalChange } from './accessMutations';
import { UserFacingError } from './actionErrors';
import { avatarDocId, memberId, userPk, workspacePk, type AppDoc, type DbMember, type DbUser, type DbWorkspace } from './model';
import { DELETE_ACCOUNT_SIGN_IN_AGAIN, RECENT_SIGN_IN_SECONDS } from './limits';
import { getAppStore, type AppMutation, type AppStore } from './store';

const changed = 'Workspace access is changing. Try again shortly.';
type Row = AppDoc & Record<string, unknown>;

/** A workspace the person has to hand over first. Every one of them is reported together. */
class HandoffNeeded extends UserFacingError {}

async function reserveWorkspace(job: AccountDeletion, id: string, store: AppStore) {
    const pk = workspacePk(id);
    const workspace = await store.get<DbWorkspace>(pk, id);
    if (!workspace) return false;
    await assertWorkspaceWritable(workspace.doc, store);
    const self = await store.get<DbMember>(pk, memberId(job.userId));
    if (!self) return false;
    const close = await store.count({ type: 'member', pk }) === 1;
    if (!close && self.doc.role === 'admin' && await store.count({ type: 'member', pk, where: { role: 'admin' } }) <= 1)
        throw new HandoffNeeded(`Make someone else an admin of ${workspace.doc.name} before deleting your account.`);
    if (close && await store.count({ type: 'project', pk }))
        throw new HandoffNeeded(`Transfer or delete the projects in ${workspace.doc.name}, or add another admin.`);
    const accountDeletion = { userId: job.userId, attempt: job.attempt };
    if (await store.replace({ ...workspace.doc, accountDeletion }, workspace.etag) !== 'ok')
        throw new UserFacingError(changed);
    return close;
}

async function releaseReservation(job: AccountDeletion, id: string, store: AppStore) {
    const workspace = await store.get<DbWorkspace>(workspacePk(id), id);
    if (workspace?.doc.accountDeletion?.attempt !== job.attempt) return;
    const { accountDeletion: _, ...rest } = workspace.doc;
    if (await store.replace(rest, workspace.etag) === 'conflict') throw new Error('Workspace changed during cleanup');
}

/** Cancel the preparation before releasing any reservation. Its old ETag can no longer commit. */
async function cancelPreparation(job: AccountDeletion, store: AppStore) {
    const current = await store.get<AccountDeletion>(job.pk, job.id);
    if (!current || current.doc.attempt !== job.attempt) return;
    if (current.doc.status === 'preparing') {
        if (await store.replace({ ...current.doc, status: 'cancelled' }, current.etag) !== 'ok') return;
    } else if (current.doc.status !== 'cancelled') return;
    for (const id of job.workspaceIds) await releaseReservation(job, id, store);
    const cancelled = await store.get<AccountDeletion>(job.pk, job.id);
    if (cancelled?.doc.attempt === job.attempt && cancelled.doc.status === 'cancelled')
        await store.transact([{ kind: 'delete', pk: job.pk, id: job.id, etag: cancelled.etag }]);
}

/** The caller derives the principal and sign-in time from the active browser cookie. */
export async function deleteAccount(session: { userId: string; signedInAt: number }, confirmation: string, store = getAppStore()) {
    const age = Date.now() / 1000 - session.signedInAt;
    if (!Number.isFinite(age) || age < 0 || age > RECENT_SIGN_IN_SECONDS)
        throw new UserFacingError(DELETE_ACCOUNT_SIGN_IN_AGAIN);
    const user = await store.get<DbUser>(userPk(session.userId), session.userId);
    if (user?.doc.type !== 'user') throw apiErrors.signInRequired('Your session has ended. Sign in again.');
    if (confirmation.trim().toLowerCase() !== user.doc.email)
        throw new UserFacingError('Type your account email to confirm.');
    const memberships = await store.query<DbMember>({ type: 'member', where: { userId: session.userId } });
    const job: AccountDeletion = {
        type: 'account-deletion', pk: user.doc.pk, id: 'account-deletion', attempt: nanoid(),
        userId: session.userId, email: user.doc.email, requestedAt: new Date().toISOString(), status: 'preparing',
        workspaceIds: memberships.map(member => member.workspaceId).filter(id => id !== PUBLIC_WORKSPACE_ID),
        closedWorkspaceIds: [], ttl: -1
    };
    if (!await store.create(job)) {
        const existing = (await store.get<AccountDeletion>(job.pk, job.id))?.doc;
        if (!existing || !(existing.status === 'cancelled' || existing.status === 'preparing'
            && Date.now() - Date.parse(existing.requestedAt) > preparationTimeout)) throw new UserFacingError(changed);
        await cancelPreparation(existing, store);
        if (!await store.create(job)) throw new UserFacingError(changed);
    }
    const committed: AccountDeletion = { ...job, status: 'committed', closedWorkspaceIds: [] };
    try {
        const preparation = await store.get<AccountDeletion>(job.pk, job.id);
        if (preparation?.doc.attempt !== job.attempt) throw new UserFacingError(changed);
        // One answer names every workspace that needs a handoff, so the person is not sent back once for each.
        const handoffs: string[] = [];
        for (const id of job.workspaceIds) {
            try {
                if (await reserveWorkspace(job, id, store)) committed.closedWorkspaceIds.push(id);
            } catch (error) {
                if (!(error instanceof HandoffNeeded)) throw error;
                handoffs.push(error.message);
            }
        }
        if (handoffs.length) throw new UserFacingError(handoffs.join('\n'));
        // This is the point of no return. All old credentials lose their live user at the same
        // instant the worker takes responsibility for finishing every remaining step.
        const avatar = user.doc.avatar ? await store.get(user.doc.pk, avatarDocId(user.doc.avatar.version)) : null;
        if (!await store.transact([
            ...(avatar ? [{ kind: 'delete' as const, pk: avatar.doc.pk, id: avatar.doc.id, etag: avatar.etag }] : []),
            { kind: 'replace', doc: committed, etag: preparation.etag },
            { kind: 'delete', pk: user.doc.pk, id: user.doc.id, etag: user.etag }
        ])) throw new UserFacingError(changed);
    } catch (error) {
        // A lost transaction response can still mean the deletion committed.
        const saved = await store.get<AccountDeletion>(job.pk, job.id);
        if (saved?.doc.attempt !== job.attempt || !['committed', 'complete'].includes(saved.doc.status)) {
            // The reason reaches the person even when the cancellation fails here. A cancelled or timed-out
            // attempt blocks nothing, and the next attempt or the scheduled worker releases what is left.
            try { await cancelPreparation(job, store); }
            catch { console.error('[accounts] A cancelled account deletion needs scheduled cleanup.'); }
            throw error;
        }
    }
    const finish = async () => {
        try { await cleanAccount(committed, store); }
        catch { console.error('[accounts] Account deletion needs scheduled retry.'); }
    };
    if (!afterResponse(finish)) await finish();
}

async function clearPartition(pk: string, store: AppStore, except?: string) {
    for (const id of await store.partitionIds(pk))
        if (id !== except) await store.delete(pk, id);
}

/** Claims and shareable records can change owners after a scan. Check the current fields
 * and condition the delete on that version, including on a retry after a new sign-up. */
async function removeMatching(type: string, where: Record<string, string>, store: AppStore, before?: string) {
    for (const candidate of await store.query<Row>({ type, where })) {
        const row = await store.get<Row>(candidate.pk, candidate.id);
        if (!row || row.doc.type !== type || Object.entries(where).some(([key, value]) => row.doc[key] !== value)) continue;
        if (before && typeof row.doc.createdAt === 'string' && row.doc.createdAt > before) continue;
        if (type === 'invitation' && typeof row.doc.tokenHash === 'string')
            await store.delete(`invitation:${row.doc.tokenHash}`, row.doc.tokenHash);
        if (!await store.transact([{ kind: 'delete', pk: row.doc.pk, id: row.doc.id, etag: row.etag }]))
            throw new Error('An account record changed during cleanup');
    }
}

async function removeMembership(job: AccountDeletion, id: string, store: AppStore) {
    const pk = workspacePk(id);
    const workspace = await store.get<DbWorkspace>(pk, id);
    const member = await store.get<DbMember>(pk, memberId(job.userId));
    const close = job.closedWorkspaceIds.includes(id);
    if (!workspace) {
        if (member) await store.delete(pk, member.doc.id);
        return;
    }
    const ownsLock = workspace.doc.accountDeletion?.attempt === job.attempt;
    if (!member && !ownsLock) return;
    if (close && !ownsLock) throw new Error('Workspace closure lost its reservation');
    if (!ownsLock) await assertWorkspaceWritable(workspace.doc, store);

    const operations: AppMutation[] = [];
    if (close) {
        operations.push({ kind: 'delete', pk, id, etag: workspace.etag });
        if (member) operations.push({ kind: 'delete', pk, id: member.doc.id, etag: member.etag });
    } else {
        const updated = { ...workspace.doc, accessRevision: (workspace.doc.accessRevision ?? 0) + 1 };
        if (ownsLock) delete updated.accountDeletion;
        operations.push({ kind: 'replace', doc: updated, etag: workspace.etag });
        if (member) {
            const change = await memberRemovalChange(member, store);
            operations.push(...change.operations, { kind: 'create', doc: accessEvent(id, job.userId, change) });
        }
    }
    if (!await store.transact(operations)) throw new Error('Workspace changed during account deletion');
}

async function cleanAccount(job: AccountDeletion, store: AppStore) {
    // Include in-flight membership writes and storage from earlier versions of the app.
    const memberships = await store.query<DbMember>({ type: 'member', where: { userId: job.userId } });
    const workspaces = new Set([...job.workspaceIds, ...memberships.map(member => member.workspaceId)]);
    workspaces.delete(PUBLIC_WORKSPACE_ID);
    for (const id of workspaces) await removeMembership(job, id, store);
    await store.delete(workspacePk(PUBLIC_WORKSPACE_ID), memberId(job.userId));
    // Release all reservations before contacting any provider.
    for (const id of workspaces) await revokeIntegrationGrantsOf(id, job.userId, store);
    for (const id of job.closedWorkspaceIds) {
        await removeMatching('domain-workspace', { workspaceId: id }, store);
        await removeMatching('invitation-token', { workspaceId: id }, store);
        await clearPartition(workspacePk(id), store);
    }
    await clearPartition(job.pk, store, job.id);
    await clearPartition(mcpUserPk(job.userId), store);
    const byUser = { userId: job.userId };
    for (const type of ['user-identity', 'comment-author', 'passkey-credential', 'passkey-challenge', 'review-code', 'extension-code',
        'extension-session', 'extension-refresh-token', 'mcp-event-subscription'])
        await removeMatching(type, byUser, store);
    await removeMatching('mcp-event-subscription', { actorUserId: job.userId }, store);
    for (const type of ['google-sign-in', 'microsoft-sign-in'])
        await removeMatching(type, { linkUserId: job.userId }, store);
    const actorId = userPk(job.userId);
    await removeMatching('comment-author', { authorId: actorId }, store);
    await removeMatching('mcp-credential', { actingUserId: job.userId }, store);
    await removeMatching('review-read', { reviewerId: actorId }, store);
    for (const type of ['notification-preference', 'notification-subscription', 'notification-delivery'])
        await removeMatching(type, { actorId }, store);
    for (const type of ['comment-query-view', 'comment-query-link'])
        await removeMatching(type, { ownerId: job.userId, sharing: 'personal' }, store);
    await removeMatching('invitation', { invitedBy: job.userId }, store);
    if (job.email) {
        for (const type of ['sign-in', 'google-link', 'microsoft-link', 'invitation'])
            await removeMatching(type, { email: job.email }, store, job.requestedAt);
    }
    await removeMatching('user-email', byUser, store);
    const current = await store.get<AccountDeletion>(job.pk, job.id);
    if (current?.doc.attempt !== job.attempt) return;
    if (job.status === 'complete') {
        await store.transact([{ kind: 'delete', pk: job.pk, id: job.id, etag: current.etag }]);
    } else if (current.doc.status === 'committed') {
        const { email: _, ...receipt } = current.doc;
        await store.replace({ ...receipt, status: 'complete' }, current.etag);
    }
}

export async function sweepAccountDeletions(store = getAppStore()) {
    let failed = 0;
    for (const job of await store.query<AccountDeletion>({ type: 'account-deletion' })) {
        try {
            const age = Date.now() - Date.parse(job.requestedAt);
            if (job.status === 'cancelled' || job.status === 'preparing' && age > preparationTimeout)
                await cancelPreparation(job, store);
            if (job.status === 'committed' || job.status === 'complete' && age > 60 * 60_000)
                await cleanAccount(job, store);
        } catch { failed++; }
    }
    return { failed };
}
