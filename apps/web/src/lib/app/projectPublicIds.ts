import { nanoid } from 'nanoid';
import { projectRefPk, type AppDoc, type DbProject, type DbProjectRef } from './model';
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

/**
 * A project provisioned with a public id chosen in code: claims the lookup for that id. Create-only,
 * so it never takes an id that names another project.
 */
export async function claimProjectPublicId(project: Pick<PublicProject, 'id' | 'workspaceId' | 'publicId'>, store: AppStore = getAppStore()) {
    const ref: DbProjectPublicRef = { type: 'project-public-ref', id: project.publicId, pk: publicRefPk(project.publicId),
        workspaceId: project.workspaceId, projectId: project.id, ttl: -1 };
    if (await store.create(ref)) return;
    const current = (await store.get<DbProjectPublicRef>(ref.pk, ref.id))?.doc;
    if (current?.type !== 'project-public-ref' || current.projectId !== project.id)
        throw new Error('A provisioned project’s public id names another project');
}

/**
 * Whether a project document is the project. One in a transfer (`transfer`) exists in two workspaces
 * and is the project only where its code points; every other document is, without another read.
 * Every read that takes the workspace from the person (`getProject`, `listProjects`, team grants,
 * integration admin) checks it, so neither workspace reaches the other's copy.
 */
export async function isLiveProject(project: Pick<DbProject, 'id' | 'workspaceId' | 'transfer'>, store: AppStore = getAppStore()) {
    if (!project.transfer) return true;
    const code = (await store.get<DbProjectRef>(projectRefPk(project.id), project.id))?.doc;
    return code?.type === 'project-ref' && code.workspaceId === project.workspaceId;
}

/** Only a published reference may resolve; abandoned claims cannot expose a project. */
export async function projectByPublicId(publicId: string, store: AppStore = getAppStore()): Promise<PublicProject | null> {
    if (!isProjectPublicId(publicId)) return null;
    const ref = (await store.get<DbProjectPublicRef>(publicRefPk(publicId), publicId))?.doc;
    if (ref?.type !== 'project-public-ref') return null;
    let project = (await store.get<DbProject>(`workspace:${ref.workspaceId}`, ref.projectId))?.doc;
    if (!project || project.transfer) {
        // Around a transfer the public id and the code can name different workspaces: the code decides
        const code = (await store.get<DbProjectRef>(projectRefPk(ref.projectId), ref.projectId))?.doc;
        if (code?.type !== 'project-ref') return null;
        if (code.workspaceId !== ref.workspaceId)
            project = (await store.get<DbProject>(`workspace:${code.workspaceId}`, ref.projectId))?.doc;
    }
    return project?.type === 'project' && project.publicId === publicId ? project as PublicProject : null;
}

/**
 * Project transfer: every claim of the project, published or abandoned, names the workspace given,
 * so review links and embeds keep their id. Pointed at the new workspace once the copy exists there,
 * and back at the old one when an interrupted transfer is abandoned.
 */
export async function pointProjectPublicIds(projectId: string, workspaceId: string, store: AppStore = getAppStore()) {
    for (const ref of await store.query<DbProjectPublicRef>({ type: 'project-public-ref', where: { projectId } })) {
        for (let attempt = 0; ; attempt++) {
            const current = await store.get<DbProjectPublicRef>(ref.pk, ref.id);
            if (current?.doc.type !== 'project-public-ref' || current.doc.projectId !== projectId || current.doc.workspaceId === workspaceId) break;
            if (await store.replace({ ...current.doc, workspaceId }, current.etag) === 'ok') break;
            if (attempt >= 7) throw new Error('A public project id changed while it was moved');
        }
    }
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
