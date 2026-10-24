import type { DbMember, DbUser } from './model';
import { getUser } from './users';
import { listWorkspaceMembers, memberCanAccessProject } from './workspaces';

export type MemberWithUser = {
    member: DbMember;
    /** `null` when the account no longer exists */
    user: DbUser | null;
    name: string;
};

/** The workspace's members with their names, sorted by name */
export async function listMembersWithUsers(workspaceId: string): Promise<MemberWithUser[]> {
    const members = await listWorkspaceMembers(workspaceId);
    const users = await Promise.all(members.map(member => getUser(member.userId)));
    return members
        .map((member, index) => {
            const user = users[index] ?? null;
            return { member, user, name: user?.name ?? member.email };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Members who can review the project (admins and commenters with access) */
export async function listProjectMembers(workspaceId: string, projectId: string) {
    return (await listMembersWithUsers(workspaceId)).filter(({ member }) => memberCanAccessProject(member, projectId));
}
