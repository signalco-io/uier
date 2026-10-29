import { z } from 'zod';
import type { AppDoc, DbMember, DbProject, DbWorkspace } from '../../app/model';
import { getAppStore } from '../../app/store';
import { hasProjectAccess, loadWorkspaceAccess } from '../../app/access';
import { listProjects } from '../../app/projects';
import { getWorkspace, listUserMemberships } from '../../app/workspaces';
import { publicProjectMember } from '../../comments/publicProjectPolicy';
import { mcpScopes, type McpScope } from '../scopes';
import { MAX_CONNECTION_NAME_LENGTH } from './config';

/** What a connection may reach. Access is evaluated live against current membership on every request. */
export type AgentAccess =
    | { kind: 'all' }
    | { kind: 'selected'; workspaces: Array<{ workspaceId: string; projects: 'all' | string[] }> };

const projectIdSchema = z.string().regex(/^[a-z0-9]{12}$/);
export const agentAccessSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }).strict(),
    z.object({
        kind: z.literal('selected'),
        workspaces: z.array(z.object({
            workspaceId: z.string().min(1).max(128),
            projects: z.union([z.literal('all'), z.array(projectIdSchema).min(1).max(200)])
        }).strict()).min(1, 'Choose at least one workspace or project.').max(50)
            .refine(entries => new Set(entries.map(entry => entry.workspaceId)).size === entries.length, 'Choose each workspace once.')
    }).strict()
]);

export const connectionNameSchema = z.string().trim().min(1, 'Enter a connection name.').max(MAX_CONNECTION_NAME_LENGTH, `Use at most ${MAX_CONNECTION_NAME_LENGTH} characters.`);
export const grantScopesSchema = z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length)
    .transform(scopes => [...new Set(scopes)])
    .refine(scopes => scopes.includes('feedback:read'), 'Read access is required.');

/** How consent and Account present a client. The name always comes from the client itself. */
export type ClientPresentation = {
    name: string;
    /** `cimd`: published at `metadataHost`; `dcr`: registered by the app itself, unverified */
    kind: 'cimd' | 'dcr';
    metadataHost?: string;
    /** `null` when the client returns to a loopback address on this computer */
    redirectHost: string | null;
};

export type McpGrant = AppDoc & {
    type: 'mcp-grant';
    userId: string;
    clientId: string;
    client: ClientPresentation;
    /** The label replies and status changes carry */
    name: string;
    access: AgentAccess;
    scopes: McpScope[];
    resource: string;
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
};

export const userPk = (userId: string) => `mcp-user:${userId}`;

export function isGrantActive(grant: McpGrant, now = Date.now()) {
    return Date.parse(grant.idleExpiresAt) > now && Date.parse(grant.absoluteExpiresAt) > now;
}

export async function getGrant(userId: string, grantId: string) {
    const stored = await getAppStore().get<McpGrant>(userPk(userId), grantId);
    return stored && stored.doc.type === 'mcp-grant' && stored.doc.userId === userId ? stored : null;
}

/** Active connected apps of the user, newest first */
export async function listConnectedApps(userId: string) {
    return (await getAppStore().query<McpGrant>({ type: 'mcp-grant', pk: userPk(userId) }))
        .filter(grant => isGrantActive(grant)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deleting the grant revokes it: access tokens are checked against their grant on every request. */
export async function revokeConnectedApp(userId: string, grantId: string) {
    const grant = await getGrant(userId, grantId);
    return grant ? await getAppStore().delete(userPk(userId), grantId) : false;
}

export type AccessibleWorkspace = {
    workspace: Pick<DbWorkspace, 'id' | 'name'>;
    member: DbMember;
    projects: DbProject[];
};

const MAX_SCANNED_WORKSPACES = 50;
const MAX_SCANNED_PROJECTS = 1000;

/**
 * Every workspace of the user with the projects they can currently access, oldest membership
 * first. Includes the automatic uier workspace membership with its staff allowlist.
 */
export async function listAccessibleWorkspaces(userId: string, email: string, includeWorkspace: (workspaceId: string) => boolean = () => true): Promise<{ workspaces: AccessibleWorkspace[]; truncated: boolean }> {
    const members = (await listUserMemberships(userId))
        .filter(member => includeWorkspace(member.workspaceId))
        .map(member => publicProjectMember(member, email))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const workspaces: AccessibleWorkspace[] = [];
    let projectCount = 0;
    for (const member of members.slice(0, MAX_SCANNED_WORKSPACES)) {
        const [workspace, projects, access] = await Promise.all([getWorkspace(member.workspaceId), listProjects(member.workspaceId), loadWorkspaceAccess(member.workspaceId)]);
        if (!workspace) continue;
        const visible = projects.filter(project => hasProjectAccess(access, member, project))
            .sort((a, b) => a.name.localeCompare(b.name));
        projectCount += visible.length;
        workspaces.push({ workspace: { id: workspace.id, name: workspace.name }, member, projects: visible });
        if (projectCount >= MAX_SCANNED_PROJECTS) break;
    }
    return { workspaces, truncated: members.length > workspaces.length || projectCount >= MAX_SCANNED_PROJECTS };
}

/** Whether the grant covers this project. Current membership and project access are checked separately. */
export function accessCovers(access: AgentAccess, workspaceId: string, projectId: string) {
    if (access.kind === 'all') return true;
    const entry = access.workspaces.find(workspace => workspace.workspaceId === workspaceId);
    return Boolean(entry && (entry.projects === 'all' || entry.projects.includes(projectId)));
}

/** The workspace that a grant names explicitly for a project, if any, so callers can skip the global lookup */
export function grantedWorkspaceOf(access: AgentAccess, projectId: string) {
    return access.kind === 'selected'
        ? access.workspaces.find(entry => Array.isArray(entry.projects) && entry.projects.includes(projectId))?.workspaceId
        : undefined;
}

/** Rejects a choice of workspaces or projects the person cannot currently access. */
export async function validateAccessChoice(userId: string, email: string, access: AgentAccess) {
    if (access.kind === 'all') return true;
    const { workspaces } = await listAccessibleWorkspaces(userId, email);
    return access.workspaces.every(entry => {
        const workspace = workspaces.find(candidate => candidate.workspace.id === entry.workspaceId);
        return workspace && (entry.projects === 'all' || entry.projects.every(id => workspace.projects.some(project => project.id === id)));
    });
}

/** A short summary for Account: "All workspaces and projects" or "2 workspaces, 5 projects" */
export function describeAccess(access: AgentAccess) {
    if (access.kind === 'all') return 'All workspaces and projects, including new ones';
    const workspaces = access.workspaces.length;
    const projectLists = access.workspaces.filter(entry => entry.projects !== 'all');
    const allProjects = workspaces - projectLists.length;
    const projects = projectLists.reduce((sum, entry) => sum + (entry.projects as string[]).length, 0);
    const parts = [`${workspaces} ${workspaces === 1 ? 'workspace' : 'workspaces'}`];
    if (allProjects) parts.push(`all projects in ${allProjects === 1 ? 'one' : allProjects}`);
    if (projects) parts.push(`${projects} ${projects === 1 ? 'project' : 'projects'}`);
    return parts.join(', ');
}
