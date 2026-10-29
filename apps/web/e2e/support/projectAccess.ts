import { getAppStore } from '../../src/lib/app/store';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../../src/lib/app/model';

/** Persist the authorization records for service fixtures, just like a resolved API request. */
export async function persistProjectAccess(
    project: DbProject,
    actors = [
        { userId: 'member', name: 'Member', isAdmin: false },
        { userId: 'admin', name: 'Admin', isAdmin: true }
    ]
) {
    const store = getAppStore(),
        now = new Date().toISOString();
    const workspaceId = project.workspaceId ?? `test_${project.id}`;
    Object.assign(project, {
        type: 'project',
        pk: workspacePk(workspaceId),
        workspaceId,
        name: project.name ?? 'Fixture project',
        urls: project.urls ?? ['https://reviewed.example'],
        access: project.access ?? 'guests',
        status: project.status ?? 'active',
        createdBy: project.createdBy ?? 'admin',
        createdAt: project.createdAt ?? now,
        updatedAt: project.updatedAt ?? now
    });
    await store.create(project);
    for (const actor of actors) {
        const email = `${actor.userId.replace(/[^a-z0-9]/gi, '').slice(0, 40)}@example.test`;
        await store.create<DbUser>({
            type: 'user',
            id: actor.userId,
            pk: userPk(actor.userId),
            email,
            name: actor.name,
            createdAt: now,
            updatedAt: now
        });
        await store.create<DbMember>({
            type: 'member',
            id: memberId(actor.userId),
            pk: project.pk,
            workspaceId,
            userId: actor.userId,
            email,
            role: actor.isAdmin ? 'admin' : 'commenter',
            projects: 'all',
            createdAt: now
        });
    }
    return project;
}
