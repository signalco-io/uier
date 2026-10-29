import { z } from 'zod';
import type { AppDoc, DbUser } from '../app/model';
import type { AppContext } from '../app/context';
import { getVisibleProject, getProject, findProject } from '../app/projects';
import { getAppStore } from '../app/store';
import { randomToken, sha256Hex } from '../app/tokens';
import { getUser } from '../app/users';
import { memberActor } from '../review/actor';
import { ApiError, apiErrors } from '../comments/http';
import { mcpScopes, type McpScope } from './scopes';
import { accessCovers, grantedWorkspaceOf, type AgentAccess } from './oauth/grants';
import { authenticateAccessToken, isAccessTokenFormat } from './oauth/tokens';
import { mcpOauthEnabled } from './oauth/config';

export { mcpScopes, type McpScope } from './scopes';
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

/** Only manual credentials: OAuth records share the partition, and codes and rotated tokens detect replays. */
export async function revokeMcpCredential(userId: string, id: string) {
    const stored = await getAppStore().get<McpCredential>(credentialPk(userId), id);
    if (stored?.doc.type === 'mcp-credential' && stored.doc.userId === userId)
        await getAppStore().delete(credentialPk(userId), id);
}

/** A manual credential or an OAuth connection, resolved to one grant shape that every tool call checks */
export type McpIdentity = {
    user: DbUser;
    connection: { id: string; kind: 'credential' | 'oauth'; name: string; clientId?: string };
    scopes: McpScope[];
    access: AgentAccess;
};

export class McpAuthenticationError extends ApiError {
    constructor(readonly tokenPresented: boolean) {
        super(401, 'sign_in_required', 'Sign in again from your coding tool, or use an unexpired access token from Account.');
    }
}

function bearerToken(request: Request) {
    const header = request.headers.get('authorization');
    if (!header) return null;
    return /^Bearer ([A-Za-z0-9._~+/-]{1,512}=*)$/.exec(header)?.[1] ?? '';
}

/** `issuer` defaults to the request origin; the MCP route passes the configured app origin. */
export async function authenticateMcp(request: Request, issuer = new URL(request.url).origin): Promise<McpIdentity> {
    const token = bearerToken(request);
    if (token === null) throw new McpAuthenticationError(false);
    if (isAccessTokenFormat(token)) {
        // Off also stops access tokens that were already issued.
        const result = mcpOauthEnabled() ? await authenticateAccessToken(token, issuer) : null;
        const user = result ? await getUser(result.grant.userId) : null;
        if (!result || !user) throw new McpAuthenticationError(true);
        return { user, connection: { id: result.grant.id, kind: 'oauth', name: result.grant.name, clientId: result.grant.clientId }, scopes: result.scopes, access: result.grant.access };
    }
    const match = /^(uier_mcp\.([A-Za-z0-9_-]{1,128})\.[A-Za-z0-9_-]{32,128})$/.exec(token);
    const credential = match ? (await getAppStore().get<McpCredential>(credentialPk(match[2]!), sha256Hex(match[1]!)))?.doc : null;
    const user = credential && credential.type === 'mcp-credential' && Date.parse(credential.expiresAt) > Date.now() ? await getUser(credential.userId) : null;
    if (!credential || !user) throw new McpAuthenticationError(true);
    return { user, connection: { id: credential.id, kind: 'credential', name: credential.name }, scopes: credential.scopes,
        access: { kind: 'selected', workspaces: [{ workspaceId: credential.workspaceId, projects: credential.projectIds }] } };
}

export function requireMcpScope(identity: McpIdentity, scope: McpScope) {
    if (!identity.scopes.includes(scope)) throw apiErrors.forbidden(`This connection needs ${scope}.`);
}

export async function mcpProject(identity: McpIdentity, projectId: string, scope: McpScope = 'feedback:read') {
    requireMcpScope(identity, scope);
    const workspaceId = grantedWorkspaceOf(identity.access, projectId);
    const project = workspaceId ? await getProject(workspaceId, projectId) : await findProject(projectId);
    const covered = project && project.id === projectId && accessCovers(identity.access, project.workspaceId, project.id);
    const actor = covered ? await memberActor(project, identity.user.id) : null;
    if (!project || !covered || !actor || actor.kind !== 'member')
        throw apiErrors.notFound('Project not found. Check list_projects for the projects this connection can reach.');
    return { project, actor: { ...actor, agent: { credentialId: identity.connection.id, name: identity.connection.name, kind: identity.connection.kind } } };
}
