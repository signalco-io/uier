import { createHash } from 'node:crypto';
import type { AppDoc } from '../../app/model';
import { getAppStore, type AppMutation } from '../../app/store';
import { randomToken, sha256Hex } from '../../app/tokens';
import type { McpScope } from '../scopes';
import { isMcpResource, OAUTH_LIFETIMES, parseScopes } from './config';
import { OAuthError } from './errors';
import { limitByKey } from './http';
import { getGrant, isGrantActive, userPk, type McpGrant } from './grants';
import type { McpAuthorizationCode } from './authorize';
import { redirectUriMatches } from './redirects';

export type McpAccessToken = AppDoc & {
    type: 'mcp-access-token';
    userId: string;
    grantId: string;
    clientId: string;
    resource: string;
    /** Narrowed at refresh; otherwise the grant's scopes apply */
    scopes?: McpScope[];
    expiresAt: string;
};

export type McpRefreshToken = AppDoc & {
    type: 'mcp-refresh-token';
    userId: string;
    grantId: string;
    clientId: string;
    resource: string;
    rotatedAt?: string;
    expiresAt: string;
};

const userIdPattern = '([A-Za-z0-9_-]{1,128})';
const tokenPattern = (prefix: string) => new RegExp(`^${prefix}\\.${userIdPattern}\\.[A-Za-z0-9_-]{43}$`);
const accessPattern = tokenPattern('uier_at');
const refreshPattern = tokenPattern('uier_rt');
const codePattern = tokenPattern('uier_code');

function iso(offsetSeconds: number, now = Date.now()) {
    return new Date(now + offsetSeconds * 1000).toISOString();
}

function newPair(grant: McpGrant, scopes: McpScope[] | undefined, now: number) {
    const accessToken = `uier_at.${grant.userId}.${randomToken()}`;
    const refreshToken = `uier_rt.${grant.userId}.${randomToken()}`;
    const access: McpAccessToken = {
        type: 'mcp-access-token', id: sha256Hex(accessToken), pk: userPk(grant.userId), userId: grant.userId, grantId: grant.id,
        clientId: grant.clientId, resource: grant.resource, scopes, expiresAt: iso(OAUTH_LIFETIMES.accessTokenSeconds, now),
        ttl: OAUTH_LIFETIMES.accessTokenSeconds + 300
    };
    const refresh: McpRefreshToken = {
        type: 'mcp-refresh-token', id: sha256Hex(refreshToken), pk: userPk(grant.userId), userId: grant.userId, grantId: grant.id,
        clientId: grant.clientId, resource: grant.resource, expiresAt: iso(OAUTH_LIFETIMES.idleSeconds, now),
        ttl: OAUTH_LIFETIMES.idleSeconds + 86400
    };
    const response = {
        access_token: accessToken, token_type: 'Bearer', expires_in: OAUTH_LIFETIMES.accessTokenSeconds,
        refresh_token: refreshToken, scope: (scopes ?? grant.scopes).join(' ')
    };
    return { access, refresh, response };
}

function pkceMatches(verifier: string, challenge: string) {
    return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && createHash('sha256').update(verifier).digest('base64url') === challenge;
}

/** Revokes a grant; its tokens stop working on the next request and expire by TTL. */
async function revokeGrant(userId: string, grantId: string | undefined) {
    if (grantId) await getAppStore().delete(userPk(userId), grantId);
}

function required(form: URLSearchParams, name: string) {
    const values = form.getAll(name);
    if (values.length !== 1 || !values[0]) throw new OAuthError('invalid_request', `Send ${name} once.`);
    return values[0];
}

function optional(form: URLSearchParams, name: string) {
    const values = form.getAll(name);
    if (values.length > 1) throw new OAuthError('invalid_request', `Send ${name} once.`);
    return values[0] || undefined;
}

/** `authorization_code`: PKCE, client, redirect URI and resource must match the approved request. */
export async function exchangeCode(form: URLSearchParams, issuer: string, attempt = 0): Promise<ReturnType<typeof newPair>['response']> {
    const code = required(form, 'code');
    const clientId = required(form, 'client_id');
    const verifier = required(form, 'code_verifier');
    const redirectUri = required(form, 'redirect_uri');
    const resource = optional(form, 'resource');
    const userId = codePattern.exec(code)?.[1];
    const store = getAppStore();
    const stored = userId ? await store.get<McpAuthorizationCode>(userPk(userId), sha256Hex(code)) : null;
    if (!userId || !stored || stored.doc.type !== 'mcp-code') throw new OAuthError('invalid_grant', 'The code is invalid or expired.');
    const record = stored.doc;
    if (record.consumedAt) {
        // A replayed code revokes the grant it produced (OAuth 2.1 §4.1.3).
        await revokeGrant(userId, record.grantId);
        throw new OAuthError('invalid_grant', 'The code was already used.');
    }
    if (Date.parse(record.expiresAt) <= Date.now()) throw new OAuthError('invalid_grant', 'The code is invalid or expired.');
    if (record.clientId !== clientId) throw new OAuthError('invalid_grant', 'The code was issued to another client.');
    if (record.redirectUri !== redirectUri || !redirectUriMatches(record.redirectUri, redirectUri)) throw new OAuthError('invalid_grant', 'The redirect URI does not match.');
    if (!pkceMatches(verifier, record.codeChallenge)) throw new OAuthError('invalid_grant', 'The code verifier does not match.');
    if (resource !== undefined && (!isMcpResource(resource, issuer) || !isMcpResource(record.resource, issuer)))
        throw new OAuthError('invalid_target', 'The resource must be the uier MCP endpoint.');

    const now = Date.now();
    const grant: McpGrant = {
        type: 'mcp-grant', id: `grant_${randomToken().slice(0, 24)}`, pk: userPk(userId), userId, clientId,
        client: record.client, name: record.name, access: record.access, scopes: record.scopes, resource: record.resource,
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
        idleExpiresAt: iso(OAUTH_LIFETIMES.idleSeconds, now), absoluteExpiresAt: iso(OAUTH_LIFETIMES.absoluteSeconds, now),
        ttl: OAUTH_LIFETIMES.idleSeconds + 86400
    };
    const { access, refresh, response } = newPair(grant, undefined, now);
    const operations: AppMutation[] = [
        { kind: 'replace', doc: { ...record, consumedAt: new Date(now).toISOString(), grantId: grant.id }, etag: stored.etag },
        { kind: 'create', doc: grant }, { kind: 'create', doc: access }, { kind: 'create', doc: refresh }
    ];
    if (record.replaceGrantId) {
        const replaced = await getGrant(userId, record.replaceGrantId);
        if (replaced) operations.push({ kind: 'delete', pk: replaced.doc.pk, id: replaced.doc.id, etag: replaced.etag });
    }
    if (await store.transact(operations)) return response;
    // The replaced connection changed (for example its last use was recorded): read everything again once.
    if (attempt === 0) return await exchangeCode(form, issuer, 1);
    throw new OAuthError('invalid_grant', 'The code was already used.');
}

/** `refresh_token`: every use rotates. A reuse within the grace period gets a new pair; later it revokes the grant. */
export async function refreshTokens(form: URLSearchParams, issuer: string, attempt = 0): Promise<ReturnType<typeof newPair>['response']> {
    const token = required(form, 'refresh_token');
    const clientId = required(form, 'client_id');
    const resource = optional(form, 'resource');
    const requestedScope = optional(form, 'scope');
    const userId = refreshPattern.exec(token)?.[1];
    const store = getAppStore();
    const stored = userId ? await store.get<McpRefreshToken>(userPk(userId), sha256Hex(token)) : null;
    if (!userId || !stored || stored.doc.type !== 'mcp-refresh-token') throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired.');
    const record = stored.doc;
    if (record.clientId !== clientId) throw new OAuthError('invalid_grant', 'The refresh token was issued to another client.');
    if (resource !== undefined && !isMcpResource(resource, issuer)) throw new OAuthError('invalid_target', 'The resource must be the uier MCP endpoint.');
    const now = Date.now();
    if (record.rotatedAt && now - Date.parse(record.rotatedAt) > OAUTH_LIFETIMES.refreshGraceSeconds * 1000) {
        await revokeGrant(userId, record.grantId);
        throw new OAuthError('invalid_grant', 'The refresh token was already used. Sign in again.');
    }
    const grant = await getGrant(userId, record.grantId);
    if (!grant || !isGrantActive(grant.doc, now) || Date.parse(record.expiresAt) <= now || !isMcpResource(record.resource, issuer))
        throw new OAuthError('invalid_grant', 'The connection ended. Sign in again.');

    if (attempt === 0) await limitByKey('refresh', grant.doc.id, 120);
    // Narrowing applies to the new access token only: an omitted scope means the scopes the person
    // granted (RFC 6749 §6), so a later refresh can return to them.
    let scopes: McpScope[] | undefined;
    if (requestedScope !== undefined) {
        const requested = parseScopes(requestedScope);
        if (!requested || !requested.includes('feedback:read') || requested.some(scope => !grant.doc.scopes.includes(scope)))
            throw new OAuthError('invalid_scope', 'Request the granted scopes or fewer, including feedback:read.');
        scopes = requested.length === grant.doc.scopes.length ? undefined : requested;
    }
    const updatedGrant: McpGrant = { ...grant.doc, idleExpiresAt: iso(OAUTH_LIFETIMES.idleSeconds, now), lastUsedAt: new Date(now).toISOString(), ttl: OAUTH_LIFETIMES.idleSeconds + 86400 };
    const { access, refresh, response } = newPair(updatedGrant, scopes, now);
    const operations: AppMutation[] = [
        { kind: 'replace', doc: updatedGrant, etag: grant.etag },
        { kind: 'create', doc: access }, { kind: 'create', doc: refresh }
    ];
    // Within the grace period (a lost response or a concurrent refresh) the rotated token stays as it is.
    if (!record.rotatedAt)
        operations.push({ kind: 'replace', doc: { ...record, rotatedAt: new Date(now).toISOString(), ttl: OAUTH_LIFETIMES.rotatedRefreshSeconds }, etag: stored.etag });
    if (await store.transact(operations)) return response;
    // A concurrent refresh or grant update: read again once, which turns into the grace path.
    if (attempt === 0) return await refreshTokens(form, issuer, 1);
    throw new OAuthError('invalid_grant', 'The refresh token changed. Try again.');
}

/** RFC 7009: a refresh token revokes its grant; an access token only itself. Unknown tokens still succeed. */
export async function revokeToken(form: URLSearchParams) {
    const token = optional(form, 'token');
    const clientId = optional(form, 'client_id');
    if (!token) throw new OAuthError('invalid_request', 'Send the token to revoke.');
    const store = getAppStore();
    const refreshUser = refreshPattern.exec(token)?.[1];
    if (refreshUser) {
        const stored = await store.get<McpRefreshToken>(userPk(refreshUser), sha256Hex(token));
        if (stored?.doc.type === 'mcp-refresh-token' && (!clientId || stored.doc.clientId === clientId))
            await revokeGrant(refreshUser, stored.doc.grantId);
        return;
    }
    const accessUser = accessPattern.exec(token)?.[1];
    if (accessUser) {
        const stored = await store.get<McpAccessToken>(userPk(accessUser), sha256Hex(token));
        if (stored?.doc.type === 'mcp-access-token' && (!clientId || stored.doc.clientId === clientId))
            await store.delete(userPk(accessUser), stored.doc.id);
    }
}

export function isAccessTokenFormat(token: string) {
    return accessPattern.test(token);
}

/** The grant behind a valid access token issued for this resource; `null` for anything else */
export async function authenticateAccessToken(token: string, issuer: string) {
    const userId = accessPattern.exec(token)?.[1];
    if (!userId) return null;
    const store = getAppStore();
    const stored = await store.get<McpAccessToken>(userPk(userId), sha256Hex(token));
    const record = stored?.doc;
    if (!record || record.type !== 'mcp-access-token' || Date.parse(record.expiresAt) <= Date.now() || !isMcpResource(record.resource, issuer))
        return null;
    const grant = await getGrant(userId, record.grantId);
    if (!grant || !isGrantActive(grant.doc) || grant.doc.clientId !== record.clientId) return null;
    // Last use is recorded at most once an hour.
    if (!grant.doc.lastUsedAt || Date.now() - Date.parse(grant.doc.lastUsedAt) > 60 * 60 * 1000)
        await store.replace({ ...grant.doc, lastUsedAt: new Date().toISOString() }, grant.etag).catch(() => undefined);
    return { grant: grant.doc, scopes: record.scopes ? record.scopes.filter(scope => grant.doc.scopes.includes(scope)) : grant.doc.scopes };
}
