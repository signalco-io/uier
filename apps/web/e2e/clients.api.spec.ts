import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, getProject, listProjects, listVisibleProjects } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import {
    clientNames,
    getClient,
    loadClients,
    projectClient,
    projectClients,
    setProjectClient,
    updateClient
} from '../src/lib/app/clients';
import { memberId, workspacePk, type DbClient, type DbMember, type DbProject } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { parseActionInput } from '../src/lib/app/validation';
import { UserFacingError } from '../src/lib/app/actionErrors';
import { clientActionSchema } from '../src/components/app/clients/actionSchemas';
import { reviewProjectDto } from '../src/lib/review/routes';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
});

async function adminContext(prefix: string): Promise<AppContext> {
    const user = await findOrCreateUser(`${prefix}-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    return { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
}

/** A commenter of the admin's workspace with access to the given projects only */
async function commenterContext(admin: AppContext, projects: string[]): Promise<AppContext> {
    const user = await findOrCreateUser(`clients-commenter-${randomUUID()}@example.com`);
    const member: DbMember = { ...admin.member, id: memberId(user.id), userId: user.id, email: user.email, role: 'commenter', projects };
    await getAppStore().create(member);
    return { ...admin, user, member, isAdmin: false, memberships: [{ member, workspace: admin.workspace }] };
}

async function clientOf(context: AppContext, projectId: string) {
    const project = (await getProject(context.workspace.id, projectId))!;
    return projectClient(project, await loadClients(context.workspace.id));
}

test('renaming a client renames it on every project at once and frees the old name', async () => {
    const context = await adminContext('clients-rename');
    const projects = await Promise.all(['one', 'two', 'three'].map(name =>
        createProject(context, { name, urls: [`https://${name}.example.com`], clientName: 'Acme' })));
    const other = await createProject(context, { name: 'other', urls: ['https://other.example.com'], clientName: 'Northwind' });
    const clientIds = new Set(projects.map(project => project.clientId));
    expect(clientIds.size).toBe(1);
    const clientId = projects[0]!.clientId!;
    expect(clientId).toMatch(/^client_[A-Za-z0-9_-]{21}$/);
    expect(other.clientId).not.toBe(clientId);
    expect(projects[0]).not.toHaveProperty('clientName');

    const saved = await updateClient(context, clientId, {
        name: '  Acme   Studio ', description: '  Retail sites.  ', icon: 'store', color: 'blue'
    });
    expect(saved).toEqual({ id: clientId, name: 'Acme Studio', description: 'Retail sites.', icon: 'store', color: 'blue' });
    for (const project of projects)
        expect(await clientOf(context, project.id)).toEqual(saved);
    expect((await clientOf(context, other.id))?.name).toBe('Northwind');
    expect(clientNames(await listProjects(context.workspace.id), await loadClients(context.workspace.id))).toEqual(['Acme Studio', 'Northwind']);

    // The old name is free again: a project that names it starts a new client
    const again = await createProject(context, { name: 'again', urls: ['https://again.example.com'], clientName: 'Acme' });
    expect(again.clientId).not.toBe(clientId);
    // The new name belongs to the renamed client
    const joined = await createProject(context, { name: 'joined', urls: ['https://joined.example.com'], clientName: 'Acme Studio' });
    expect(joined.clientId).toBe(clientId);

    // A name another client uses is refused while one of its projects uses it
    await expect(updateClient(context, clientId, { name: 'Northwind' })).rejects.toThrow('Another client already uses this name.');
    expect((await clientOf(context, projects[0]!.id))?.name).toBe('Acme Studio');

    // Clearing a description, icon and colour keeps the name
    expect(await updateClient(context, clientId, { name: 'Acme Studio' })).toEqual({ id: clientId, name: 'Acme Studio' });
});

test('an unused client gives its name up to a rename', async () => {
    const context = await adminContext('clients-unused');
    const kept = await createProject(context, { name: 'kept', urls: ['https://kept.example.com'], clientName: 'Kept' });
    const left = await createProject(context, { name: 'left', urls: ['https://left.example.com'], clientName: 'Former' });
    const formerId = left.clientId!;
    await updateClient(context, formerId, { name: 'Former', color: 'red' });
    // The project moves away: "Former" is unused, so nobody sees it any more
    await setProjectClient(context, left.id, 'Kept');
    expect(projectClients(await listProjects(context.workspace.id), await loadClients(context.workspace.id)).map(client => client.name)).toEqual(['Kept']);

    await updateClient(context, kept.clientId!, { name: 'Former' });
    expect(await getClient(context.workspace.id, formerId)).toBeNull();
    expect((await clientOf(context, kept.id))?.name).toBe('Former');
    expect((await clientOf(context, left.id))?.id).toBe(kept.clientId);
    // The name now leads to the renamed client, not the removed one
    const next = await createProject(context, { name: 'next', urls: ['https://next.example.com'], clientName: 'Former' });
    expect(next.clientId).toBe(kept.clientId);
});

test('concurrent renames to one name and concurrent new clients stay consistent', async () => {
    const context = await adminContext('clients-concurrent');
    const a = await createProject(context, { name: 'a', urls: ['https://a.example.com'], clientName: 'A' });
    const b = await createProject(context, { name: 'b', urls: ['https://b.example.com'], clientName: 'B' });
    const results = await Promise.allSettled([
        updateClient(context, a.clientId!, { name: 'Same' }),
        updateClient(context, b.clientId!, { name: 'Same' })
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UserFacingError);
    expect(rejected.reason.message).toBe('Another client already uses this name.');

    const projects = await Promise.all(['c', 'd', 'e'].map(name =>
        createProject(context, { name, urls: [`https://${name}.example.com`] })));
    await Promise.all(projects.map(project => setProjectClient(context, project.id, 'Brand new')));
    const ids = await Promise.all(projects.map(async project => (await clientOf(context, project.id))?.id));
    expect(new Set(ids).size).toBe(1);
    const named = [...(await loadClients(context.workspace.id)).values()].filter(client => client.name === 'Brand new');
    expect(named).toHaveLength(1);
});

test('only admins change clients, with validated input', async () => {
    const admin = await adminContext('clients-admin');
    const project = await createProject(admin, { name: 'site', urls: ['https://site.example.com'], clientName: 'Acme' });
    const commenter = await commenterContext(admin, [project.id]);
    await expect(updateClient(commenter, project.clientId!, { name: 'Taken over' })).rejects.toThrow('Only admins can do this.');
    expect((await clientOf(admin, project.id))?.name).toBe('Acme');

    const id = project.clientId!;
    await expect(updateClient(admin, id, { name: '   ' })).rejects.toThrow('Enter a client name.');
    await expect(updateClient(admin, id, { name: 'x'.repeat(81) })).rejects.toThrow('Use at most 80 characters for the client name.');
    await expect(updateClient(admin, id, { name: 'Acme', description: 'x'.repeat(281) })).rejects.toThrow('Use at most 280 characters for the description.');
    await expect(updateClient(admin, id, { name: 'Acme', icon: 'skull' })).rejects.toThrow('Choose one of the icons.');
    await expect(updateClient(admin, id, { name: 'Acme', color: '#ff0000' })).rejects.toThrow('Choose one of the colours.');
    expect((await updateClient(admin, id, { name: 'x'.repeat(80) })).name).toBe('x'.repeat(80));

    // Client ids from the form are untrusted
    expect(parseActionInput(clientActionSchema, { clientId: id })).toEqual({ clientId: id });
    for (const clientId of ['', 'client_short', `client_${'a'.repeat(20)}/`, `team_${'a'.repeat(21)}`, null, {}, ['x']])
        expect(() => parseActionInput(clientActionSchema, { clientId })).toThrow('Check the request and try again.');
});

test('clients stay in their workspace and show only through visible projects', async () => {
    const owner = await adminContext('clients-owner');
    const shared = await createProject(owner, { name: 'shared', urls: ['https://shared.example.com'], clientName: 'Shared client' });
    const hidden = await createProject(owner, { name: 'hidden', urls: ['https://hidden.example.com'], clientName: 'Private client' });
    const commenter = await commenterContext(owner, [shared.id]);
    const visible = projectClients(await listVisibleProjects(commenter), await loadClients(owner.workspace.id));
    expect(visible.map(client => client.name)).toEqual(['Shared client']);
    expect(visible[0]!.projects.map(project => project.id)).toEqual([shared.id]);

    const other = await adminContext('clients-other');
    const otherProject = await createProject(other, { name: 'other', urls: ['https://other.example.com'], clientName: 'Private client' });
    // The same name in another workspace is another client
    expect(otherProject.clientId).not.toBe(hidden.clientId);
    expect([...(await loadClients(other.workspace.id)).keys()]).toEqual([otherProject.clientId]);
    // An admin of another workspace cannot reach a client by its id
    expect(await getClient(other.workspace.id, hidden.clientId!)).toBeNull();
    await expect(updateClient(other, hidden.clientId!, { name: 'Renamed elsewhere' })).rejects.toThrow('This client no longer exists.');
    expect((await clientOf(owner, hidden.id))?.name).toBe('Private client');
    // Or point one of their projects to it
    await setProjectClient(other, otherProject.id, 'Shared client');
    expect((await clientOf(other, otherProject.id))?.id).not.toBe(shared.clientId);
});

test('older projects move their client name to a shared client document once', async () => {
    const context = await adminContext('clients-legacy');
    const store = getAppStore();
    const legacy = await Promise.all(['old-one', 'old-two'].map(async name => {
        const project = await createProject(context, { name, urls: [`https://${name}.example.com`] });
        const stored = (await store.get<DbProject>(project.pk, project.id))!;
        const { clientId: _, ...withoutClient } = stored.doc;
        const old: DbProject = { ...withoutClient, clientName: 'Legacy  client', updatedAt: '2026-01-01T00:00:00.000Z' };
        expect(await store.replace(old, stored.etag)).toBe('ok');
        return old;
    }));

    const listed = await listProjects(context.workspace.id);
    const migrated = legacy.map(project => listed.find(item => item.id === project.id)!);
    expect(migrated.every(project => project.clientName === undefined && project.clientId)).toBe(true);
    expect(new Set(migrated.map(project => project.clientId)).size).toBe(1);
    // Moving the name is not an edit of the project
    expect(migrated.map(project => project.updatedAt)).toEqual(legacy.map(() => '2026-01-01T00:00:00.000Z'));
    const client = (await store.get<DbClient>(workspacePk(context.workspace.id), migrated[0]!.clientId!))!.doc;
    expect(client).toMatchObject({ type: 'client', name: 'Legacy client', workspaceId: context.workspace.id, createdBy: context.user.id });
    const stored = (await store.get<DbProject>(legacy[0]!.pk, legacy[0]!.id))!.doc;
    expect(stored).not.toHaveProperty('clientName');
    expect(stored.clientId).toBe(client.id);
});

test('client details never reach the review API', async () => {
    const context = await adminContext('clients-dto');
    const project = await createProject(context, { name: 'reviewed', urls: ['https://reviewed.example.com'], clientName: 'Secret client' });
    await updateClient(context, project.clientId!, { name: 'Secret client', description: 'Secret description', icon: 'rocket', color: 'green' });
    // Before and after a commenter's view: the brief and environments are added only for them
    for (const canComment of [false, true]) {
        const dto = reviewProjectDto(project, canComment);
        expect(dto.id).toBe(project.publicId);
        for (const key of ['clientId', 'clientName', 'client'])
            expect(dto).not.toHaveProperty(key);
        const text = JSON.stringify(dto);
        for (const secret of ['Secret client', 'Secret description', project.clientId!])
            expect(text).not.toContain(secret);
    }
});
