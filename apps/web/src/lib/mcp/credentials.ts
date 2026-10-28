import { z } from 'zod';
import type { AppDoc } from '../app/model';
import type { AppContext } from '../app/context';
import { getVisibleProject, getProject } from '../app/projects';
import { getAppStore } from '../app/store';
import { randomToken, sha256Hex } from '../app/tokens';
import { getUser } from '../app/users';
import { memberActor } from '../review/actor';
import { ApiError, apiErrors } from '../comments/http';

export const mcpScopes = ['feedback:read', 'screenshots:read', 'feedback:reply', 'feedback:status', 'feedback:assign'] as const;
export type McpScope = typeof mcpScopes[number];
export const credentialSchema = z.object({
    name: z.string().trim().min(1, 'Enter a credential label.').max(60, 'Use at most 60 characters.'),
    projectIds: z.array(z.string().regex(/^[a-z0-9]{12}$/)).min(1, 'Choose at least one project.').max(20, 'Choose at most 20 projects.'),
    scopes: z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)])
}).refine(value => value.scopes.includes('feedback:read'), 'Read access is required.');

export type McpCredential = AppDoc & {
    type: 'mcp-credential'; userId: string; workspaceId: string; name: string;
    projectIds: string[]; scopes: McpScope[]; createdAt: string; expiresAt: string; ttl: number;
};
const credentialPk = (userId: string) => `mcp-user:${userId}`;

export async function listMcpCredentials(userId: string) {
    return (await getAppStore().query<McpCredential>({ type: 'mcp-credential', pk: credentialPk(userId) }))
        .filter(entry => Date.parse(entry.expiresAt) > Date.now()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createMcpCredential(context: AppContext, value: unknown) {
    const input = credentialSchema.parse(value);
    for (const projectId of input.projectIds)
        if (!await getVisibleProject(context, projectId)) throw apiErrors.forbidden('Choose projects you can access.');
    if ((await listMcpCredentials(context.user.id)).length >= 20)
        throw apiErrors.invalidRequest('Revoke an existing credential first (maximum 20).');
    // Only the hash is persisted. The user id selects a partition; it grants no authority.
    const token = `uier_mcp.${context.user.id}.${randomToken()}`;
    const doc: McpCredential = {
        type: 'mcp-credential', id: sha256Hex(token), pk: credentialPk(context.user.id),
        userId: context.user.id, workspaceId: context.workspace.id, name: input.name,
        projectIds: [...new Set(input.projectIds)], scopes: [...new Set(input.scopes)],
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + input.days * 86400_000).toISOString(), ttl: input.days * 86400
    };
    if (!await getAppStore().create(doc)) throw apiErrors.conflict();
    return { token, credential: doc };
}

export async function revokeMcpCredential(userId: string, id: string) {
    await getAppStore().delete(credentialPk(userId), id);
}

export async function authenticateMcp(request: Request) {
    const match = /^Bearer (uier_mcp\.([A-Za-z0-9_-]{1,128})\.[A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') ?? '');
    const credential = match ? (await getAppStore().get<McpCredential>(credentialPk(match[2]!), sha256Hex(match[1]!)))?.doc : null;
    const user = credential && Date.parse(credential.expiresAt) > Date.now() ? await getUser(credential.userId) : null;
    if (!credential || !user) throw new ApiError(401, 'sign_in_required', 'Use an unexpired MCP credential from Account.');
    return { credential, user };
}
export type McpIdentity = Awaited<ReturnType<typeof authenticateMcp>>;

export function requireMcpScope(identity: McpIdentity, scope: McpScope) {
    if (!identity.credential.scopes.includes(scope)) throw apiErrors.forbidden(`This credential needs ${scope}.`);
}

export async function mcpProject(identity: McpIdentity, projectId: string, scope: McpScope = 'feedback:read') {
    requireMcpScope(identity, scope);
    const project = identity.credential.projectIds.includes(projectId)
        ? await getProject(identity.credential.workspaceId, projectId) : null;
    const actor = project ? await memberActor(project, identity.user.id) : null;
    if (!project || !actor || actor.kind !== 'member')
        throw apiErrors.notFound('Project not found. Check list_projects for projects granted in this credential’s workspace.');
    return { project, actor: { ...actor, agent: { credentialId: identity.credential.id, name: identity.credential.name } } };
}
