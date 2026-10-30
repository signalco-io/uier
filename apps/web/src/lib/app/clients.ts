import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppContext } from './context';
import { UserFacingError } from './actionErrors';
import { clientColors, clientIcons } from './clientAppearance';
import { MAX_CLIENT_DESCRIPTION_LENGTH, MAX_CLIENT_NAME_LENGTH } from './limits';
import { workspacePk, type DbClient, type DbClientName, type DbProject } from './model';
import { getAppStore, type AppMutation, type AppStore, type StoredDoc } from './store';
import { sha256Hex } from './tokens';
import { assertMutableProject, assertMutableWorkspace } from '../comments/publicProjectPolicy';

const MAX_ATTEMPTS = 8;
const clientIdPattern = /^client_[A-Za-z0-9_-]{21}$/;
export const clientIdSchema = z.string().regex(clientIdPattern);
export const isClientId = (value: unknown): value is string => typeof value === 'string' && clientIdPattern.test(value);
const clientNameId = (name: string) => `client_name_${sha256Hex(name)}`;
/** Waits a little longer after each conflict, like `updateDoc` */
const backOff = (attempt: number) => new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));

/** Blank input clears the optional label; repeated whitespace is not part of a client name. */
export const projectClientNameSchema = z.string()
    .transform(value => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(MAX_CLIENT_NAME_LENGTH, `Use at most ${MAX_CLIENT_NAME_LENGTH} characters for the client name.`))
    .transform(value => value || undefined);

/** What an admin edits on the Clients page. A client always has a name; a project clears its own client. */
export const clientDetailsSchema = z.object({
    name: projectClientNameSchema.pipe(z.string('Enter a client name.')),
    description: z.string().trim()
        .max(MAX_CLIENT_DESCRIPTION_LENGTH, `Use at most ${MAX_CLIENT_DESCRIPTION_LENGTH} characters for the description.`)
        .transform(value => value || undefined)
        .optional(),
    icon: z.enum(clientIcons, 'Choose one of the icons.').optional(),
    color: z.enum(clientColors, 'Choose one of the colours.').optional()
});
export type ClientDetails = z.output<typeof clientDetailsSchema>;

/** What the app shows of a client (no authorship or timestamps) */
export type ClientSummary = Pick<DbClient, 'id' | 'name' | 'description' | 'icon' | 'color'>;

type ClientProject = Pick<DbProject, 'id' | 'name' | 'status'>;

/** A client with the projects that point to it */
export type Client = ClientSummary & { projects: ClientProject[] };

export function clientSummary({ id, name, description, icon, color }: DbClient): ClientSummary {
    return { id, name, description, icon, color };
}

export async function getClient(workspaceId: string, clientId: string, store: AppStore = getAppStore()): Promise<StoredDoc<DbClient> | null> {
    if (!isClientId(clientId))
        return null;
    const client = await store.get<DbClient>(workspacePk(workspaceId), clientId);
    return client?.doc.type === 'client' && client.doc.workspaceId === workspaceId ? client : null;
}

/**
 * Every client document of the workspace, by id. Show only the clients that visible projects point
 * to (`projectClients`, `projectClient`): a client of a project someone cannot open stays hidden.
 */
export async function loadClients(workspaceId: string, store: AppStore = getAppStore()) {
    const clients = await store.query<DbClient>({ type: 'client', pk: workspacePk(workspaceId) });
    return new Map(clients.map(client => [client.id, client]));
}

/** The client of a project, when it has one */
export function projectClient(project: Pick<DbProject, 'clientId'>, clients: Map<string, DbClient>): ClientSummary | undefined {
    const client = project.clientId ? clients.get(project.clientId) : undefined;
    return client && clientSummary(client);
}

/**
 * The clients of the given projects, by name. Pass only the projects the person can see
 * (`listVisibleProjects`), so clients never come from projects they cannot open.
 */
export function projectClients(projects: (ClientProject & Pick<DbProject, 'clientId'>)[], clients: Map<string, DbClient>): Client[] {
    const grouped = new Map<string, Client>();
    for (const { id, name, status, clientId } of projects) {
        const client = clientId ? clients.get(clientId) : undefined;
        if (!client)
            continue;
        const entry = grouped.get(client.id) ?? { ...clientSummary(client), projects: [] };
        entry.projects.push({ id, name, status });
        grouped.set(client.id, entry);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The client names of the given (visible) projects, sorted */
export function clientNames(projects: Pick<DbProject, 'id' | 'name' | 'status' | 'clientId'>[], clients: Map<string, DbClient>) {
    return projectClients(projects, clients).map(client => client.name);
}

/** The client with this name, created when no client of the workspace has it yet */
async function clientNamed(store: AppStore, workspaceId: string, name: string, actorId: string): Promise<StoredDoc<DbClient>> {
    const pk = workspacePk(workspaceId);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const reservation = await store.get<DbClientName>(pk, clientNameId(name));
        if (reservation) {
            // Both documents change in one transaction, so a reserved name always has its client
            const client = await store.get<DbClient>(pk, reservation.doc.clientId);
            if (client)
                return client;
            continue;
        }

        const now = new Date().toISOString();
        const client: DbClient = { type: 'client', id: `client_${nanoid()}`, pk, workspaceId, name, createdBy: actorId, createdAt: now, updatedAt: now };
        const nameRef: DbClientName = { type: 'client-name', id: clientNameId(name), pk, workspaceId, clientId: client.id };
        // `false`: someone else claimed the name first; the next attempt reads their client
        if (await store.createAll([client, nameRef])) {
            const created = await store.get<DbClient>(pk, client.id);
            if (created)
                return created;
        }
    }
    throw new Error('Could not find or create the client');
}

/**
 * Points the project to the client named `name` (creating the client for a new name) or, without a
 * name, removes its client. The client document is rewritten in the same transaction, so a rename
 * that removes an unused client at the same time cannot leave the project pointing at nothing.
 */
async function assignProjectClient(store: AppStore, project: Pick<DbProject, 'pk' | 'id' | 'workspaceId'>, name: string | undefined,
    actorId: string, { legacyOnly = false } = {}): Promise<DbProject | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await store.get<DbProject>(project.pk, project.id);
        if (!current)
            return null;
        // Migration only: someone set the client since the project was read
        if (legacyOnly && (current.doc.clientId || current.doc.clientName === undefined))
            return current.doc;

        const { clientId: _clientId, clientName: _clientName, ...rest } = current.doc;
        const updatedAt = legacyOnly ? current.doc.updatedAt : new Date().toISOString();
        if (!name) {
            const updated: DbProject = { ...rest, updatedAt };
            const result = await store.replace(updated, current.etag);
            if (result === 'ok')
                return updated;
            if (result === 'not_found')
                return null;
            await backOff(attempt);
            continue;
        }

        const client = await clientNamed(store, project.workspaceId, name, actorId);
        const updated: DbProject = { ...rest, clientId: client.doc.id, updatedAt };
        if (await store.transact([
            { kind: 'replace', doc: updated, etag: current.etag },
            { kind: 'replace', doc: client.doc, etag: client.etag }
        ]))
            return updated;
        await backOff(attempt);
    }
    throw new Error(`Project ${project.id} changed too often while saving its client`);
}

/** Creates a new project together with its client (by name), in one transaction */
export async function createProjectWithClient(project: DbProject, name: string | undefined, store: AppStore = getAppStore()) {
    if (!name) {
        await store.create(project);
        return project;
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const client = await clientNamed(store, project.workspaceId, name, project.createdBy);
        const created: DbProject = { ...project, clientId: client.doc.id };
        if (await store.transact([{ kind: 'create', doc: created }, { kind: 'replace', doc: client.doc, etag: client.etag }]))
            return created;
        await backOff(attempt);
    }
    throw new Error(`Could not create project ${project.id} with its client`);
}

/** Sets a project's client by name (`projectClientNameSchema`); `undefined` removes it. */
export async function setProjectClient(context: AppContext, projectId: string, name: string | undefined, store: AppStore = getAppStore()) {
    assertMutableProject(context.workspace.id, projectId);
    return await assignProjectClient(store, { pk: workspacePk(context.workspace.id), id: projectId, workspaceId: context.workspace.id },
        projectClientNameSchema.parse(name ?? ''), context.user.id);
}

/**
 * Older projects name their client (`clientName`) instead of pointing to a client document. Moves the
 * name to a client once (on read, like `ensureProjectPublicId`); projects with the same name share it.
 */
export async function ensureProjectClient(project: DbProject, store: AppStore = getAppStore()): Promise<DbProject> {
    if (project.clientName === undefined || project.clientId)
        return project;
    const name = projectClientNameSchema.safeParse(project.clientName).data;
    return await assignProjectClient(store, project, name, project.createdBy, { legacyOnly: true }) ?? project;
}

/**
 * Renames a client and changes its description, icon and colour (admins). Projects point to the
 * client by id, so every project follows the new name at once. A name another client uses is
 * refused, unless no project uses that client any more: then this one takes the name over.
 */
export async function updateClient(context: AppContext, clientId: string, details: { name: string; description?: string; icon?: string; color?: string }, store: AppStore = getAppStore()) {
    if (!context.isAdmin)
        throw new UserFacingError('Only admins can do this.');
    assertMutableWorkspace(context.workspace.id);
    const { name, description, icon, color } = clientDetailsSchema.parse(details);
    const workspaceId = context.workspace.id;
    const pk = workspacePk(workspaceId);
    // Older projects find their client by name; move them first so a new name cannot pick them up
    await Promise.all((await store.query<DbProject>({ type: 'project', pk })).map(project => ensureProjectClient(project, store)));

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await getClient(workspaceId, clientId, store);
        if (!current)
            throw new UserFacingError('This client no longer exists.');

        const updated: DbClient = { ...current.doc, name, description, icon, color, updatedAt: new Date().toISOString() };
        const operations: AppMutation[] = [{ kind: 'replace', doc: updated, etag: current.etag }];
        if (name !== current.doc.name) {
            const [own, taken] = await Promise.all([
                store.get<DbClientName>(pk, clientNameId(current.doc.name)),
                store.get<DbClientName>(pk, clientNameId(name))
            ]);
            if (taken && taken.doc.clientId !== clientId) {
                const other = await store.get<DbClient>(pk, taken.doc.clientId);
                if (other) {
                    const used = await store.query<DbProject>({ type: 'project', pk, where: { clientId: other.doc.id }, limit: 1 });
                    if (used.length)
                        throw new UserFacingError('Another client already uses this name.');
                    // Assigning a project rewrites its client, so this delete fails if one joined since the query
                    operations.push({ kind: 'delete', pk, id: other.doc.id, etag: other.etag });
                }
                operations.push({ kind: 'replace', doc: { ...taken.doc, clientId }, etag: taken.etag });
            } else if (!taken) {
                operations.push({ kind: 'create', doc: { type: 'client-name', id: clientNameId(name), pk, workspaceId, clientId } satisfies DbClientName });
            }
            if (own?.doc.clientId === clientId)
                operations.push({ kind: 'delete', pk, id: own.doc.id, etag: own.etag });
        }
        if (await store.transact(operations))
            return clientSummary(updated);
        await backOff(attempt);
    }
    throw new Error(`Client ${clientId} changed too often while saving`);
}
