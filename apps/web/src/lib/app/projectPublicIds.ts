import { nanoid } from 'nanoid';
import type { AppDoc, DbProject } from './model';
import { getAppStore, type AppStore } from './store';

export type PublicProject = DbProject & { publicId: string };

type DbProjectPublicRef = AppDoc & {
    type: 'project-public-ref';
    workspaceId: string;
    projectId: string;
};

/** A deleted project's public id: it keeps the claim, so the id is never issued again, and names no project. */
type DbRetiredPublicRef = AppDoc & { type: 'project-public-ref-retired'; retiredAt: string };

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
    if (ref?.type !== 'project-public-ref') return null;
    const project = (await store.get<DbProject>(`workspace:${ref.workspaceId}`, ref.projectId))?.doc;
    return project?.publicId === publicId ? project as PublicProject : null;
}

/**
 * Project deletion: every claim of the project, published or abandoned, becomes a retired claim
 * without workspace or project ids. Never deleted, so a review link or embed of the deleted
 * project can never reach a project that later draws the same id.
 */
export async function retireProjectPublicIds(projectId: string, publicId: string | undefined, store: AppStore = getAppStore()) {
    const refs = await store.query<DbProjectPublicRef>({ type: 'project-public-ref', where: { projectId } });
    const ids = new Set([...refs.map(ref => ref.id), ...(publicId ? [publicId] : [])]);
    for (const id of ids) {
        const retired: DbRetiredPublicRef = { type: 'project-public-ref-retired', id, pk: publicRefPk(id), retiredAt: new Date().toISOString(), ttl: -1 };
        const current = await store.get<DbProjectPublicRef | DbRetiredPublicRef>(retired.pk, id);
        if (current?.doc.type === 'project-public-ref-retired') continue;
        if (current && (current.doc.type !== 'project-public-ref' || current.doc.projectId !== projectId)) continue;
        const saved = current ? await store.replace(retired, current.etag) === 'ok' : await store.create(retired);
        if (!saved) throw new Error('A public project id changed while it was retired');
    }
}
