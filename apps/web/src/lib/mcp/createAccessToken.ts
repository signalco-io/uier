import { z } from 'zod';
import { randomToken, sha256Hex } from '../app/tokens';
import { getAppStore } from '../app/store';
import { apiErrors } from '../comments/http';
import { idempotencyKeySchema } from '../comments/validation';
import { consume } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { mcpCredentialView, mcpProject, persistMcpCredential, requireMcpScope,
    type McpCredential, type McpCredentialCreation, type McpIdentity } from './credentials';
import { getGrant } from './oauth/grants';
import { tokenScopes } from './scopes';
import { projectId } from './schemas';

export const createAccessTokenSchema = z.object({
    name: z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Use a single-line name.'),
    workspaceId: z.string().min(1).max(128),
    projectIds: z.array(projectId).min(1).max(20)
        .refine(ids => new Set(ids).size === ids.length, 'Choose each project once.'),
    scopes: z.array(z.enum(tokenScopes)).min(1).max(tokenScopes.length)
        .refine(scopes => scopes.includes('feedback:read'), 'Read access is required.')
        .refine(scopes => new Set(scopes).size === scopes.length, 'Choose each operation once.'),
    days: z.number().int().min(1).max(30).describe('Lifetime in days: 1–30. No automatic renewal.'),
    idempotencyKey: idempotencyKeySchema.describe('One random key per intended token. Retry with the same key and input; retries return metadata only, never the secret again.')
}).strict();

export async function createAccessToken(identity: McpIdentity, value: unknown) {
    requireMcpScope(identity, 'tokens:create');
    const input = createAccessTokenSchema.parse(value);
    if (input.scopes.some(scope => !identity.scopes.includes(scope)))
        throw apiErrors.forbidden('Choose only operations this connection has.');
    let actingUserId: string | undefined;
    for (const projectId of input.projectIds) {
        const { project, user } = await mcpProject(identity, projectId);
        if (project.workspaceId !== input.workspaceId)
            throw apiErrors.invalidRequest('Choose projects in one workspace.');
        if (actingUserId && actingUserId !== user.id)
            throw apiErrors.invalidRequest('Choose projects this connection can open under one account.');
        actingUserId = user.id;
    }
    const pk = `mcp-user:${identity.user.id}`;
    const id = `credential-creation_${sha256Hex(`${identity.connection.id}:${input.idempotencyKey}`)}`;
    const { idempotencyKey: _key, ...choice } = input;
    const actingAccount = actingUserId !== identity.user.id ? { actingUserId } : {};
    const inputHash = sha256Hex(JSON.stringify({ ...choice, ...actingAccount, projectIds: [...input.projectIds].sort(), scopes: [...input.scopes].sort() }));
    const previous = (await getAppStore().get<McpCredentialCreation>(pk, id))?.doc;
    if (previous && (previous.type !== 'mcp-credential-creation' || previous.inputHash !== inputHash)) throw apiErrors.conflict();
    if (previous) return replay(previous);
    for (const [subject, limit] of [[`connection:${identity.connection.id}`, 5], [`user:${identity.user.id}`, 10]] as const)
        await consume(getCommentsStore(), '$mcp', { key: `create-access-token:${subject}`, limit, windowSeconds: 3600,
            reason: 'too_fast', message: 'Access token creation limit reached. Try again later.' });
    const now = Date.now();
    const creator = identity.connection.kind === 'oauth'
        ? (await getGrant(identity.user.id, identity.connection.id))?.doc.absoluteExpiresAt
        : (await getAppStore().get<McpCredential>(pk, identity.connection.id))?.doc.expiresAt;
    if (!creator || Date.parse(creator) <= now) throw apiErrors.forbidden('The creating connection has expired.');
    const expiresAt = Math.min(now + input.days * 86400_000, Date.parse(creator));
    const token = `uier_mcp.${identity.user.id}.${randomToken()}`;
    const credential: McpCredential = {
        type: 'mcp-credential', id: sha256Hex(token), pk, userId: identity.user.id,
        workspaceId: input.workspaceId, name: input.name, projectIds: input.projectIds, scopes: input.scopes,
        ...actingAccount,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
        ttl: Math.max(1, Math.ceil((expiresAt - now) / 1000)), createdBy: { ...identity.connection }
    };
    const view = mcpCredentialView(credential);
    const receipt: McpCredentialCreation = { type: 'mcp-credential-creation', id, pk, inputHash, credential: view, ttl: 30 * 86400 };
    const concurrent = await persistMcpCredential(credential, receipt);
    return concurrent ? replay(concurrent) : { credential: view, token, alreadyCreated: false };
}

function replay(receipt: McpCredentialCreation) {
    return { credential: receipt.credential, alreadyCreated: true,
        message: 'This token was already created. Its secret is shown only in the first response. If it was lost, revoke it in Account before creating a replacement with a new key.' };
}
