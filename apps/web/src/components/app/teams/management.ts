import { notFound } from 'next/navigation';
import { requireAppContext, type AppContext } from '@/src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { listProjects } from '@/src/lib/app/projects';
import { listMembersWithUsers } from '@/src/lib/app/members';

export async function requireTeamAdmin() {
    const context = await requireAppContext();
    if (!context.isAdmin || context.workspace.id === PUBLIC_WORKSPACE_ID) notFound();
    return context;
}

export async function managementData(context: AppContext) {
    const [access, projects, members] = await Promise.all([
        loadWorkspaceAccess(context.workspace.id),
        listProjects(context.workspace.id),
        listMembersWithUsers(context.workspace.id)
    ]);
    return {
        access,
        projects,
        people: members.filter((person) => person.user).map(({ member, name }) => ({ member, name })),
        revision: context.workspace.accessRevision ?? 0
    };
}
