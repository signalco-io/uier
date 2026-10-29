import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureProjectPublicId, projectByPublicId } from '../src/lib/app/projectPublicIds';
import { workspacePk, type DbProject } from '../src/lib/app/model';
import { getAppStore, type AppStore } from '../src/lib/app/store';
import { getProject } from '../src/lib/app/projects';

async function legacyProject() {
    const store = getAppStore();
    const workspaceId = `w_public_ids_${randomUUID()}`;
    const project: DbProject = { type: 'project', id: 'oldproject01', pk: workspacePk(workspaceId), workspaceId,
        name: 'Existing project', urls: ['https://example.com'], status: 'active', access: 'guests',
        createdBy: 'system', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    await store.create(project);
    return { project, store };
}

const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

test('concurrent migration assigns one durable public id and retains every internal field', async () => {
    const { project, store } = await legacyProject();
    const projects = await Promise.all(Array.from({ length: 6 }, () => ensureProjectPublicId(project, store)));
    const publicId = projects[0]!.publicId;
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(new Set(projects.map(value => value.publicId)).size).toBe(1);
    expect(publicId).not.toContain(project.id);
    expect((await store.get(project.pk, project.id))?.doc).toEqual({ ...project, publicId });
    expect(await projectByPublicId(publicId, store)).toEqual({ ...project, publicId });
    expect(await getProject(project.workspaceId, publicId)).toEqual({ ...project, publicId });
    expect(await getProject('another-workspace', publicId)).toBeNull();
    expect((await ensureProjectPublicId(project, store)).publicId).toBe(publicId);
    const refs = await store.query({ type: 'project-public-ref', where: { workspaceId: project.workspaceId } });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ttl).toBe(-1);
});

test('collisions are retried and unpublished or stale references never resolve', async () => {
    const { project, store } = await legacyProject();
    let collision = true;
    const collidingStore: AppStore = { ...store, async create(doc) {
        if (doc.type === 'project-public-ref' && collision) { collision = false; return false; }
        return store.create(doc);
    } };
    const assigned = await ensureProjectPublicId(project, collidingStore);
    expect(collision).toBe(false);
    expect(await projectByPublicId(assigned.publicId, store)).toEqual(assigned);
    const unpublishedId = 'A'.repeat(21);
    await store.create({ type: 'project-public-ref', id: unpublishedId, pk: `project-public:${unpublishedId}`,
        workspaceId: project.workspaceId, projectId: project.id });
    expect(await projectByPublicId(unpublishedId, store)).toBeNull();
    await store.delete(project.pk, project.id);
    expect(await projectByPublicId(assigned.publicId, store)).toBeNull();
    for (const invalid of [project.id, '../project', 'a'.repeat(22), ''])
        expect(await projectByPublicId(invalid, store)).toBeNull();
});
