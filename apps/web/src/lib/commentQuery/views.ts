import { nanoid } from 'nanoid';
import { z } from 'zod';
import { parseQuery, visitConditions, type QueryDocument } from '@uier/comments-query';
import { hasProjectAccess, loadWorkspaceAccess, type AccessSnapshot } from '../app/access';
import { memberId, userPk, workspacePk, type AppDoc, type DbMember, type DbProject, type DbUser, type DbWorkspace } from '../app/model';
import { isLiveProject } from '../app/projectPublicIds';
import { getAppStore, type AppMutation, type AppStore, type StoredDoc } from '../app/store';
import { ApiError, apiErrors } from '../comments/http';
import { publicProjectMember } from '../comments/publicProjectPolicy';

export const COMMENT_QUERY_BODY_BYTES = 68 * 1024;
export const COMMENT_QUERY_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_OWN_VIEWS = 100;
const MAX_SHARED_VIEWS = 200;
const MAX_OWN_LINKS = 100;
const MAX_SHARED_LINKS = 200;

/** These ids come from a session or a verified review actor, never a request body. */
export type CommentViewPrincipal = { workspaceId: string; userId: string; projectId?: string };
export type ViewSharing = 'personal' | 'shared';
type Definition = AppDoc & {
    workspaceId: string;
    projectId?: string;
    ownerId: string;
    sharing: ViewSharing;
    query: QueryDocument;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
};
export type DbCommentView = Definition & { type: 'comment-query-view'; name: string };
export type DbCommentQueryLink = Definition & { type: 'comment-query-link'; expiresAt: string; ttl: number };
type SavedDefinition = DbCommentView | DbCommentQueryLink;
type QueryWorkspace = DbWorkspace & { commentQueryRevision?: number };
type Access = {
    principal: CommentViewPrincipal;
    workspace: StoredDoc<QueryWorkspace>;
    member: DbMember;
    snapshot: AccessSnapshot;
    projects: Map<string, DbProject>;
    projectVersions: Map<string, StoredDoc<DbProject>>;
};

const nameSchema = z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Use a name without control characters.');
const sharingSchema = z.enum(['personal', 'shared']);
export const commentViewCreateSchema = z.strictObject({ name: nameSchema, sharing: sharingSchema.default('personal'), query: z.unknown() });
export const commentViewUpdateSchema = z.strictObject({
    version: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/),
    name: nameSchema.optional(), sharing: sharingSchema.optional(), query: z.unknown().optional()
}).refine(input => input.name !== undefined || input.sharing !== undefined || input.query !== undefined, 'Choose a change to save.');
export const commentViewDeleteSchema = z.strictObject({ version: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/) });
export const commentViewDuplicateSchema = z.strictObject({ name: nameSchema.optional(), sharing: sharingSchema.default('personal') });
export const commentQueryLinkCreateSchema = z.strictObject({ sharing: sharingSchema.default('personal'), query: z.unknown() });

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const result = schema.safeParse(input);
    if (!result.success) throw apiErrors.invalidRequest(result.error.issues[0]?.message ?? 'Invalid view.');
    return result.data;
}
function conflict() { return new ApiError(409, 'conflict', 'This saved query changed. Reload it and try again.', 1); }
function notFound() { return apiErrors.notFound('Saved query not found.'); }
function version(etag: string) { return Buffer.from(etag).toString('base64url'); }
function checkVersion(etag: string, expected: string) { if (version(etag) !== expected) throw conflict(); }
function validId(id: string, type: SavedDefinition['type']) {
    return (type === 'comment-query-view' ? /^comment_view_[A-Za-z0-9_-]{21}$/ : /^comment_query_link_[A-Za-z0-9_-]{21}$/).test(id);
}

/** No stored definition, copied URL or old reviewer role grants access. Re-read current membership. */
async function accessFor(principal: CommentViewPrincipal, store: AppStore): Promise<Access> {
    const pk = workspacePk(principal.workspaceId);
    const [workspace, storedMember, user] = await Promise.all([
        store.get<QueryWorkspace>(pk, principal.workspaceId),
        store.get<DbMember>(pk, memberId(principal.userId)),
        store.get<DbUser>(userPk(principal.userId), principal.userId)
    ]);
    if (workspace?.doc.type !== 'workspace' || workspace.doc.pk !== pk || user?.doc.type !== 'user'
        || storedMember?.doc.type !== 'member' || storedMember.doc.workspaceId !== principal.workspaceId
        || storedMember.doc.userId !== principal.userId) throw notFound();
    const member = publicProjectMember(storedMember.doc, user.doc.email);
    const access: Access = { principal, workspace, member, snapshot: await loadWorkspaceAccess(principal.workspaceId, store), projects: new Map(), projectVersions: new Map() };
    if (principal.projectId) await projectFor(access, principal.projectId, store);
    return access;
}

async function projectFor(access: Access, id: string, store: AppStore) {
    const known = access.projects.get(id);
    if (known) return known;
    const stored = await store.get<DbProject>(access.workspace.doc.pk, id), project = stored?.doc;
    if (project?.type !== 'project' || project.workspaceId !== access.principal.workspaceId
        || !hasProjectAccess(access.snapshot, access.member, project) || !await isLiveProject(project, store)) throw notFound();
    access.projects.set(id, project);
    access.projectVersions.set(id, stored!);
    return project;
}

/** Capability checks also apply when loading an old definition after an admin was demoted. */
function assertCapabilities(query: QueryDocument, access: Access) {
    if (access.member.role === 'admin') return;
    let restricted = query.order.some(rule => ['openedBy', 'device', 'browser', 'width', 'height'].includes(rule.field));
    if (query.where) visitConditions(query.where, condition => {
        if (['device', 'browser', 'width', 'height'].includes(condition.field)) restricted = true;
        if (condition.field === 'openedBy' || condition.field === 'author') {
            const values = Array.isArray(condition.value) ? condition.value : [condition.value];
            if (!values.length || values.some(value => !value || typeof value !== 'object' || !('relative' in value) || value.relative !== 'me')) restricted = true;
        }
    });
    if (restricted) throw apiErrors.forbidden('Only workspace admins can use author and reproduction filters.');
}

async function queryFor(input: unknown, access: Access, store: AppStore) {
    let query: QueryDocument;
    try { query = parseQuery(input); }
    catch (error) { throw apiErrors.invalidRequest(error instanceof Error ? error.message : 'Invalid query.'); }
    if (query.scope.kind === 'public') throw apiErrors.invalidRequest('Save this query in a workspace or project.');
    if (query.scope.kind === 'workspace') {
        if (access.principal.projectId || query.scope.workspaceId !== access.principal.workspaceId) throw apiErrors.invalidRequest('The query must use this view’s scope.');
    } else {
        // The review URL can contain the public project id; persist only its canonical storage id.
        if (access.principal.projectId) {
            const pinned = await projectFor(access, access.principal.projectId, store);
            if (query.scope.projectId !== pinned.id && query.scope.projectId !== pinned.publicId) throw apiErrors.invalidRequest('The query must use this project.');
            query = { ...query, scope: { kind: 'project', projectId: pinned.id } };
        }
        await projectFor(access, query.scope.kind === 'project' ? query.scope.projectId : '', store);
    }
    assertCapabilities(query, access);
    return query;
}

async function readable(definition: SavedDefinition, access: Access, store: AppStore) {
    if (definition.workspaceId !== access.principal.workspaceId || definition.pk !== access.workspace.doc.pk
        || (definition.sharing !== 'personal' && definition.sharing !== 'shared')
        || definition.sharing === 'personal' && definition.ownerId !== access.principal.userId
        || access.principal.projectId && definition.projectId !== access.principal.projectId) throw notFound();
    if (definition.type === 'comment-query-link' && (!Number.isFinite(Date.parse(definition.expiresAt)) || Date.parse(definition.expiresAt) <= Date.now())) throw notFound();
    const query = await queryFor(definition.query, access, store);
    if ((query.scope.kind === 'project' ? query.scope.projectId : undefined) !== definition.projectId) throw notFound();
}

function assertEditable(definition: SavedDefinition, access: Access) {
    if (definition.sharing === 'shared' ? access.member.role !== 'admin' : definition.ownerId !== access.principal.userId)
        throw apiErrors.forbidden('Only the owner can edit a personal view. Shared views are managed by workspace admins.');
}
function assertSharing(sharing: ViewSharing, access: Access) {
    if (sharing === 'shared' && access.member.role !== 'admin') throw apiErrors.forbidden('Only workspace admins can share saved queries.');
}

function metadata(doc: DbCommentView) {
    return { id: doc.id, name: doc.name, ownerId: doc.ownerId, sharing: doc.sharing,
        scope: doc.query.scope, createdAt: doc.createdAt, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
}
function viewDto(stored: StoredDoc<DbCommentView>) { return { ...metadata(stored.doc), query: stored.doc.query, version: version(stored.etag) }; }
function linkDto(stored: StoredDoc<DbCommentQueryLink>) {
    const doc = stored.doc;
    return { id: doc.id, ownerId: doc.ownerId, sharing: doc.sharing, query: doc.query,
        createdAt: doc.createdAt, expiresAt: doc.expiresAt, version: version(stored.etag) };
}

async function definitionFor<T extends SavedDefinition>(id: string, type: T['type'], access: Access, store: AppStore): Promise<StoredDoc<T>> {
    if (!validId(id, type)) throw notFound();
    const stored = await store.get<T>(access.workspace.doc.pk, id);
    if (!stored || stored.doc.type !== type) throw notFound();
    await readable(stored.doc, access, store);
    return stored;
}

/** The workspace ETag serializes quotas and role/team revocations with the saved-query write. */
async function write(access: Access, operations: AppMutation[], store: AppStore) {
    return store.transact([
        { kind: 'replace', doc: { ...access.workspace.doc, commentQueryRevision: (access.workspace.doc.commentQueryRevision ?? 0) + 1 }, etag: access.workspace.etag },
        ...[...access.projectVersions.values()].map(project => ({ kind: 'replace' as const, doc: { ...project.doc }, etag: project.etag })),
        ...operations
    ]);
}
async function quota(type: SavedDefinition['type'], sharing: ViewSharing, access: Access, store: AppStore) {
    const limit = type === 'comment-query-view' ? MAX_OWN_VIEWS : MAX_OWN_LINKS;
    const own = await store.count({ type, pk: access.workspace.doc.pk, where: { ownerId: access.principal.userId } });
    if (own >= limit) throw apiErrors.invalidRequest(`You can save at most ${limit} ${type === 'comment-query-view' ? 'views' : 'query links'} in a workspace.`);
    if (sharing === 'shared') {
        const sharedLimit = type === 'comment-query-view' ? MAX_SHARED_VIEWS : MAX_SHARED_LINKS;
        if (await store.count({ type, pk: access.workspace.doc.pk, where: { sharing: 'shared' } }) >= sharedLimit)
            throw apiErrors.invalidRequest(`This workspace already has ${sharedLimit} shared saved queries of this kind.`);
    }
}

export async function listCommentViews(principal: CommentViewPrincipal, store: AppStore = getAppStore()) {
    const access = await accessFor(principal, store), pk = access.workspace.doc.pk;
    const project: Record<string, string> = principal.projectId ? { projectId: principal.projectId } : {};
    const [own, shared] = await Promise.all([
        store.query<DbCommentView>({ type: 'comment-query-view', pk, where: { ...project, ownerId: principal.userId }, limit: MAX_OWN_VIEWS + 1 }),
        store.query<DbCommentView>({ type: 'comment-query-view', pk, where: { ...project, sharing: 'shared' }, limit: MAX_SHARED_VIEWS + 1 })
    ]);
    if (own.length > MAX_OWN_VIEWS || shared.length > MAX_SHARED_VIEWS) throw apiErrors.unavailable('Too many saved views. Ask an admin to remove unused views.');
    const visible: DbCommentView[] = [];
    for (const doc of new Map([...own, ...shared].map(doc => [doc.id, doc])).values()) {
        try { await readable(doc, access, store); visible.push(doc); }
        catch (error) { if (!(error instanceof ApiError && [400, 403, 404].includes(error.status))) throw error; }
    }
    return visible.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(metadata);
}

export async function getCommentView(principal: CommentViewPrincipal, id: string, store: AppStore = getAppStore()) {
    return viewDto(await definitionFor<DbCommentView>(id, 'comment-query-view', await accessFor(principal, store), store));
}

export async function createCommentView(principal: CommentViewPrincipal, input: unknown, store: AppStore = getAppStore()) {
    const parsed = parseInput(commentViewCreateSchema, input), id = `comment_view_${nanoid()}`;
    for (let attempt = 0; attempt < 5; attempt++) {
        const access = await accessFor(principal, store), query = await queryFor(parsed.query, access, store);
        assertSharing(parsed.sharing, access);
        await quota('comment-query-view', parsed.sharing, access, store);
        const now = new Date().toISOString();
        const doc: DbCommentView = { type: 'comment-query-view', id, pk: access.workspace.doc.pk,
            workspaceId: principal.workspaceId, projectId: query.scope.kind === 'project' ? query.scope.projectId : undefined,
            ownerId: principal.userId, name: parsed.name, sharing: parsed.sharing, query,
            createdAt: now, updatedAt: now, updatedBy: principal.userId, ttl: -1 };
        if (await write(access, [{ kind: 'create', doc: { ...doc } }], store)) return getCommentView(principal, id, store);
    }
    throw conflict();
}

export async function updateCommentView(principal: CommentViewPrincipal, id: string, input: unknown, store: AppStore = getAppStore()) {
    const parsed = parseInput(commentViewUpdateSchema, input);
    for (let attempt = 0; attempt < 5; attempt++) {
        const access = await accessFor(principal, store), stored = await definitionFor<DbCommentView>(id, 'comment-query-view', access, store);
        checkVersion(stored.etag, parsed.version);
        assertEditable(stored.doc, access);
        const sharing = parsed.sharing ?? stored.doc.sharing;
        assertSharing(sharing, access);
        if (sharing === 'personal' && stored.doc.ownerId !== principal.userId) throw apiErrors.forbidden('Only the owner can make a shared view personal.');
        if (sharing === 'shared' && stored.doc.sharing !== 'shared'
            && await store.count({ type: 'comment-query-view', pk: stored.doc.pk, where: { sharing: 'shared' } }) >= MAX_SHARED_VIEWS)
            throw apiErrors.invalidRequest('This workspace already has too many shared views.');
        const query = parsed.query === undefined ? stored.doc.query : await queryFor(parsed.query, access, store);
        if (JSON.stringify(query.scope) !== JSON.stringify(stored.doc.query.scope)) throw apiErrors.invalidRequest('A saved view’s scope cannot change. Duplicate it instead.');
        const doc: DbCommentView = { ...stored.doc, name: parsed.name ?? stored.doc.name, sharing, query, updatedAt: new Date().toISOString(), updatedBy: principal.userId };
        if (await write(access, [{ kind: 'replace', doc: { ...doc }, etag: stored.etag }], store)) return getCommentView(principal, id, store);
    }
    throw conflict();
}

export async function deleteCommentView(principal: CommentViewPrincipal, id: string, input: unknown, store: AppStore = getAppStore()) {
    const parsed = parseInput(commentViewDeleteSchema, input);
    for (let attempt = 0; attempt < 5; attempt++) {
        const access = await accessFor(principal, store), stored = await definitionFor<DbCommentView>(id, 'comment-query-view', access, store);
        checkVersion(stored.etag, parsed.version);
        assertEditable(stored.doc, access);
        if (await write(access, [{ kind: 'delete', pk: stored.doc.pk, id, etag: stored.etag }], store)) return;
    }
    throw conflict();
}

export async function duplicateCommentView(principal: CommentViewPrincipal, id: string, input: unknown, store: AppStore = getAppStore()) {
    const parsed = parseInput(commentViewDuplicateSchema, input), source = await getCommentView(principal, id, store);
    return createCommentView(principal, { name: parsed.name ?? `${source.name.slice(0, 73)} (copy)`, sharing: parsed.sharing, query: source.query }, store);
}

export async function createCommentQueryLink(principal: CommentViewPrincipal, input: unknown, store: AppStore = getAppStore()) {
    const parsed = parseInput(commentQueryLinkCreateSchema, input), id = `comment_query_link_${nanoid()}`;
    for (let attempt = 0; attempt < 5; attempt++) {
        const access = await accessFor(principal, store), query = await queryFor(parsed.query, access, store);
        assertSharing(parsed.sharing, access);
        await quota('comment-query-link', parsed.sharing, access, store);
        const now = new Date();
        const doc: DbCommentQueryLink = { type: 'comment-query-link', id, pk: access.workspace.doc.pk,
            workspaceId: principal.workspaceId, projectId: query.scope.kind === 'project' ? query.scope.projectId : undefined,
            ownerId: principal.userId, sharing: parsed.sharing, query, createdAt: now.toISOString(), updatedAt: now.toISOString(),
            updatedBy: principal.userId, expiresAt: new Date(now.getTime() + COMMENT_QUERY_LINK_TTL_SECONDS * 1000).toISOString(), ttl: COMMENT_QUERY_LINK_TTL_SECONDS };
        if (await write(access, [{ kind: 'create', doc: { ...doc } }], store)) return getCommentQueryLink(principal, id, store);
    }
    throw conflict();
}

export async function getCommentQueryLink(principal: CommentViewPrincipal, id: string, store: AppStore = getAppStore()) {
    return linkDto(await definitionFor<DbCommentQueryLink>(id, 'comment-query-link', await accessFor(principal, store), store));
}
