import { mcpScopes, type McpScope } from '../scopes';

/** OAuth for the MCP endpoint (docs/mcp-oauth-plan.md). `UIER_MCP_OAUTH=off` turns discovery and sign-in off. */
export function mcpOauthEnabled() {
    return process.env.UIER_MCP_OAUTH !== 'off';
}

export const mcpResourcePath = '/api/mcp';
export const protectedResourceMetadataPath = `/.well-known/oauth-protected-resource${mcpResourcePath}`;

/** The canonical protected resource: the MCP endpoint as clients enter it */
export function mcpResource(baseUrl: string) {
    return `${new URL(baseUrl).origin}${mcpResourcePath}`;
}

/** Exact audience comparison after lowercasing scheme and host and removing one trailing slash; never by prefix. */
export function isMcpResource(value: string, baseUrl: string) {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    if (url.username || url.password || url.search || url.hash) return false;
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    return `${url.origin}${path}` === mcpResource(baseUrl);
}

export const OAUTH_LIFETIMES = {
    authorizationRequestSeconds: 10 * 60,
    codeSeconds: 60,
    /** Consumed codes are kept this long to detect replays */
    codeRecordSeconds: 10 * 60,
    accessTokenSeconds: 60 * 60,
    /** A grant ends this long after its last refresh */
    idleSeconds: 30 * 24 * 60 * 60,
    absoluteSeconds: 365 * 24 * 60 * 60,
    refreshGraceSeconds: 60,
    /** Rotated refresh tokens are kept this long to detect reuse */
    rotatedRefreshSeconds: 24 * 60 * 60,
    dcrIdleSeconds: 30 * 24 * 60 * 60
} as const;

export const MAX_CONNECTED_APPS = 20;
export const MAX_CONNECTION_NAME_LENGTH = 60;

export function parseScopes(value: string | null | undefined): McpScope[] | null {
    const requested = (value ?? '').split(' ').filter(Boolean).filter(scope => scope !== 'offline_access');
    if (requested.some(scope => !(mcpScopes as readonly string[]).includes(scope))) return null;
    const scopes = [...new Set(requested as McpScope[])];
    return scopes.length ? scopes : ['feedback:read'];
}

/** Client-supplied names: no control or bidirectional override characters, at most 60 characters */
export function normalizeClientName(value: unknown, fallback = 'Coding tool') {
    const name = typeof value === 'string'
        ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CONNECTION_NAME_LENGTH).trim() : '';
    return name || fallback;
}
