import { getAppStore } from './store';
import { memberId, workspacePk, type DbMember, type DbUser, type DbWorkspace } from './model';

export async function getWorkspace(workspaceId: string) {
    return (await getAppStore().get<DbWorkspace>(workspacePk(workspaceId), workspaceId))?.doc ?? null;
}

export async function getMember(workspaceId: string, userId: string) {
    return (await getAppStore().get<DbMember>(workspacePk(workspaceId), memberId(userId)))?.doc ?? null;
}

/** Every workspace membership of the user (a query across workspaces) */
export async function listUserMemberships(userId: string) {
    return await getAppStore().query<DbMember>({ type: 'member', where: { userId } });
}

export async function listWorkspaceMembers(workspaceId: string) {
    return await getAppStore().query<DbMember>({ type: 'member', pk: workspacePk(workspaceId) });
}

/**
 * A user's own workspace: `w_<userId>`, then `w_<userId>_2`, `w_<userId>_3`, ... when an admin removed
 * them from the earlier ones (see {@link ensureOwnWorkspace})
 */
export function ownWorkspaceId(userId: string, generation = 1) {
    return generation > 1 ? `w_${userId}_${generation}` : `w_${userId}`;
}

/** Own workspaces a user can be removed from before opening the app fails */
const MAX_OWN_WORKSPACES = 20;

/**
 * The user's own workspace with the user as its admin, for a user who is in no workspace at all: a
 * new user, or one removed from every workspace.
 *
 * The workspace and its admin membership are created together, so an own workspace that exists
 * without its creator as a member means an admin removed them. They are never added back: that
 * would undo the removal and make their review tokens and MCP credentials work again. They get
 * their next own workspace instead. The ids are fixed, so concurrent requests end up in the same one.
 */
export async function ensureOwnWorkspace(user: DbUser): Promise<DbMember> {
    const store = getAppStore();
    for (let generation = 1; generation <= MAX_OWN_WORKSPACES; generation++) {
        const workspaceId = ownWorkspaceId(user.id, generation);
        const now = new Date().toISOString();
        const workspace: DbWorkspace = {
            type: 'workspace',
            id: workspaceId,
            pk: workspacePk(workspaceId),
            name: user.email,
            createdBy: user.id,
            createdAt: now
        };
        const member: DbMember = {
            type: 'member',
            id: memberId(user.id),
            pk: workspacePk(workspaceId),
            workspaceId,
            userId: user.id,
            email: user.email,
            role: 'admin',
            projects: 'all',
            createdAt: now
        };
        if (await store.createAll([workspace, member]))
            return member;

        // It exists: a concurrent request created it (still a member), or an admin removed them from it
        const existing = await getMember(workspaceId, user.id);
        if (existing)
            return existing;
    }
    throw new Error(`User ${user.id} was removed from ${MAX_OWN_WORKSPACES} workspaces of their own`);
}
