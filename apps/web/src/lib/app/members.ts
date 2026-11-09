import type { DbMember, DbUser } from './model';
import { cache } from 'react';
import { getUser } from './users';
import { avatarUrl } from './avatars';
import { listWorkspaceMembers } from './workspaces';
import { getAppStore } from './store';
import { workspacePk, type DbProject } from './model';
import { hasProjectAccess, loadWorkspaceAccessForRender, type AccessSnapshot } from './access';
import { publicProjectMember } from '../comments/publicProjectPolicy';

export type MemberWithUser = {
    member: DbMember;
    /** `null` when the account no longer exists */
    user: DbUser | null;
    name: string;
    /** Their profile picture's address, when they have one */
    avatarUrl?: string;
};

/** The workspace's members with their names, sorted by name */
export async function listMembersWithUsers(workspaceId: string): Promise<MemberWithUser[]> {
    const members = await listWorkspaceMembers(workspaceId);
    const users = await Promise.all(members.map(member => getUser(member.userId)));
    return members
        .map((member, index) => {
            const user = users[index] ?? null;
            return { member: publicProjectMember(member, user?.email ?? ''), user, name: user?.name ?? member.email, avatarUrl: avatarUrl(user) };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Select against the current request's live project/access, including public staff policy. */
export function membersWithProjectAccess(members: MemberWithUser[], project: DbProject, access: AccessSnapshot) {
    return members.filter(({ member, user }) => user && hasProjectAccess(access, member, project));
}

/** Members who can review the project (admins and commenters with access) */
export const listProjectMembers = cache(async (workspaceId: string, projectId: string) => {
    const [members, access, stored] = await Promise.all([listMembersWithUsers(workspaceId), loadWorkspaceAccessForRender(workspaceId), getAppStore().get<DbProject>(workspacePk(workspaceId), projectId)]);
    const project = stored?.doc;
    return project?.type === 'project' && project.workspaceId === workspaceId ? membersWithProjectAccess(members, project, access) : [];
});
