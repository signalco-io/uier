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

/** `w_<userId>`: one own workspace per user, so creating it twice is harmless */
export function ownWorkspaceId(userId: string) {
    return `w_${userId}`;
}

/** The user's own workspace with the user as its admin, created when missing */
export async function ensureOwnWorkspace(user: DbUser): Promise<DbMember> {
    const store = getAppStore();
    const workspaceId = ownWorkspaceId(user.id);
    const now = new Date().toISOString();

    await store.create<DbWorkspace>({
        type: 'workspace',
        id: workspaceId,
        pk: workspacePk(workspaceId),
        name: user.email,
        createdBy: user.id,
        createdAt: now
    });

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
    if (!await store.create(member)) {
        const existing = await getMember(workspaceId, user.id);
        if (existing)
            return existing;
    }
    return member;
}

/** Whether the member may review the project (admins and "all projects" members always can) */
export function memberCanAccessProject(member: Pick<DbMember, 'role' | 'projects'>, projectId: string) {
    return member.role === 'admin' || member.projects === 'all' || member.projects.includes(projectId);
}
