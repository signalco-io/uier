import { nanoid } from 'nanoid';
import type { AppDoc, DbProject } from './model';
import { getAppStore, type AppStore } from './store';

export type PublicProject = DbProject & { publicId: string };

type DbProjectPublicRef = AppDoc & {
    type: 'project-public-ref';
    workspaceId: string;
    projectId: string;
};

const publicRefPk = (id: string) => `project-public:${id}`;
export const isProjectPublicId = (id: string) => /^[A-Za-z0-9_-]{21}$/.test(id);

/** Assign once, including on old projects. Claim the lookup before publishing the id. */
export async function ensureProjectPublicId(project: DbProject, store: AppStore = getAppStore()): Promise<PublicProject> {
    if (project.publicId) return project as PublicProject;
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get<DbProject>(project.pk, project.id);
        if (!current) throw new Error('Project not found while assigning its public id');
        if (current.doc.publicId) return current.doc as PublicProject;
        const publicId = nanoid();
        const ref: DbProjectPublicRef = { type: 'project-public-ref', id: publicId, pk: publicRefPk(publicId),
            workspaceId: project.workspaceId, projectId: project.id, ttl: -1 };
        if (!await store.create(ref)) continue;
        const updated = { ...current.doc, publicId };
        const result = await store.replace(updated, current.etag);
        if (result === 'ok') return updated;
        await store.delete(ref.pk, ref.id);
        if (result === 'not_found') throw new Error('Project not found while assigning its public id');
    }
    throw new Error('Could not assign a public project id');
}

/** Only a published reference may resolve; abandoned claims cannot expose a project. */
export async function projectByPublicId(publicId: string, store: AppStore = getAppStore()): Promise<PublicProject | null> {
    if (!isProjectPublicId(publicId)) return null;
    const ref = (await store.get<DbProjectPublicRef>(publicRefPk(publicId), publicId))?.doc;
    if (!ref) return null;
    const project = (await store.get<DbProject>(`workspace:${ref.workspaceId}`, ref.projectId))?.doc;
    return project?.publicId === publicId ? project as PublicProject : null;
}
