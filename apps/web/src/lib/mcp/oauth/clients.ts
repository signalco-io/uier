import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import type { AppDoc } from '../../app/model';
import { getAppStore } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { isLocalRuntime } from '../../comments/environment';
import { normalizeClientName, OAUTH_LIFETIMES } from './config';
import { isAllowedRedirectUri, redirectHost } from './redirects';
import { OAuthError } from './errors';
import type { ClientPresentation } from './grants';

export type McpClient = AppDoc & {
    type: 'mcp-client';
    kind: 'cimd' | 'dcr';
    clientId: string;
    name: string;
    redirectUris: string[];
    /** CIMD: the host that publishes the metadata document */
    metadataHost?: string;
    createdAt: string;
    lastUsedAt: string;
    /** CIMD only: a cached failure, so a broken document is not fetched on every attempt */
    failed?: true;
};

const MAX_METADATA_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 10;
const clientPk = (clientId: string) => `mcp-client:${sha256Hex(clientId)}`;
const newClientId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 24);

const metadataSchema = z.object({
    client_id: z.string().optional(),
    client_name: z.string().max(1000).optional(),
    redirect_uris: z.array(z.string().max(2048)).min(1).max(50),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional()
});

/**
 * Metadata documents must declare a public client. A registration's requested method is replaced
 * with `none` instead (RFC 7591 §2 lets the server substitute values): no secret is ever issued.
 */
function checkGrantTypes(metadata: z.infer<typeof metadataSchema>, { substituteAuthMethod = false } = {}) {
    if (!substituteAuthMethod && metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== 'none')
        throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported.');
    if (metadata.grant_types?.some(type => type !== 'authorization_code' && type !== 'refresh_token'))
        throw new OAuthError('invalid_client_metadata', 'Only the authorization_code and refresh_token grants are supported.');
    if (metadata.response_types?.some(type => type !== 'code'))
        throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported.');
}

export function clientPresentation(client: Pick<McpClient, 'kind' | 'name' | 'metadataHost'>, redirectUri: string): ClientPresentation {
    return { name: client.name, kind: client.kind, metadataHost: client.metadataHost, redirectHost: redirectHost(redirectUri) };
}

// --- Dynamic client registration (RFC 7591) ---

/** Registers a public client. Unsupported redirect URIs are dropped; no secret is issued. */
export async function registerClient(body: unknown) {
    const parsed = metadataSchema.safeParse(body);
    if (!parsed.success) throw new OAuthError('invalid_client_metadata', 'The client metadata is invalid.');
    checkGrantTypes(parsed.data, { substituteAuthMethod: true });
    const redirectUris = [...new Set(parsed.data.redirect_uris.filter(isAllowedRedirectUri))].slice(0, MAX_REDIRECT_URIS);
    if (!redirectUris.length)
        throw new OAuthError('invalid_redirect_uri', 'Use an HTTPS redirect URI or an HTTP loopback redirect URI.');
    const now = new Date().toISOString();
    const clientId = `uier_client_${newClientId()}`;
    const client: McpClient = {
        type: 'mcp-client', id: sha256Hex(clientId), pk: clientPk(clientId), kind: 'dcr', clientId,
        name: normalizeClientName(parsed.data.client_name), redirectUris, createdAt: now, lastUsedAt: now,
        ttl: OAUTH_LIFETIMES.dcrIdleSeconds
    };
    if (!await getAppStore().create(client)) throw new OAuthError('server_error', 'Try registering again.', 500);
    return {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.parse(now) / 1000),
        client_name: client.name,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
    };
}

// --- Client ID Metadata Documents ---

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const)
    blocked.addSubnet(network, prefix, 'ipv4');
// No `::ffff:0:0/96` rule: BlockList checks IPv4-mapped addresses against the IPv4 rules above, and
// such a rule would also match every IPv4 address.
for (const [network, prefix] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const)
    blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string) {
    const family = isIP(address);
    if (!family) return false;
    const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] : undefined;
    if (mapped) return !blocked.check(mapped, 'ipv4');
    return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Only resolves to public addresses, checked on the connection's own lookup so DNS cannot change in between. */
function publicLookup(hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, '');
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)))
            return callback(Object.assign(new Error('The client metadata host is not public.'), { code: 'EBLOCKED' }), '');
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
    });
}

/** Local test runs only: `UIER_OAUTH_TEST_HTTP_CLIENT_METADATA=1` accepts http://localhost metadata URLs. */
function testMetadataUrl(url: URL) {
    return isLocalRuntime() && process.env.UIER_OAUTH_TEST_HTTP_CLIENT_METADATA === '1'
        && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** Whether a client id is a metadata document URL (and not a registered `uier_client_…` id) */
export function isMetadataClientId(clientId: string) {
    let url: URL;
    try { url = new URL(clientId); } catch { return false; }
    if (clientId.length > 512 || url.username || url.password || url.search || url.hash || clientId.includes('#') || url.pathname === '/') return false;
    if (testMetadataUrl(url)) return true;
    return url.protocol === 'https:' && !url.port && !isIP(url.hostname.replace(/^\[|\]$/g, '')) && url.hostname.includes('.');
}

type Fetched = { status: number; contentType: string; cacheControl: string; body: string };

function fetchPublicHttps(url: URL) {
    return new Promise<Fetched>((resolve, reject) => {
        const request = httpsRequest(url, {
            method: 'GET', lookup: publicLookup as never, timeout: 5000,
            headers: { Accept: 'application/json', 'User-Agent': 'uier-oauth/1.0' }
        }, response => {
            let size = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_METADATA_BYTES) { request.destroy(new Error('The client metadata document is too large.')); return; }
                chunks.push(chunk);
            });
            response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType: String(response.headers['content-type'] ?? ''),
                cacheControl: String(response.headers['cache-control'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error('The client metadata request timed out.')));
        request.on('error', reject);
        request.end();
    });
}

async function fetchMetadata(url: URL): Promise<Fetched> {
    if (!testMetadataUrl(url)) return await fetchPublicHttps(url);
    const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_METADATA_BYTES) throw new Error('The client metadata document is too large.');
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', cacheControl: response.headers.get('cache-control') ?? '', body };
}

function cacheSeconds(cacheControl: string) {
    const maxAge = Number(/(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)?.[1]);
    const seconds = /no-store|no-cache/i.test(cacheControl) || !Number.isFinite(maxAge) ? 300 : maxAge;
    return Math.min(Math.max(seconds, 300), 24 * 60 * 60);
}

async function loadMetadataClient(clientId: string): Promise<McpClient> {
    const url = new URL(clientId);
    const now = new Date().toISOString();
    const base = { type: 'mcp-client' as const, id: sha256Hex(clientId), pk: clientPk(clientId), kind: 'cimd' as const, clientId,
        metadataHost: url.host, createdAt: now, lastUsedAt: now };
    try {
        const fetched = await fetchMetadata(url);
        if (fetched.status !== 200 || !/^application\/(?:[\w.+-]+\+)?json\b/i.test(fetched.contentType)) throw new Error('Unexpected response');
        const parsed = metadataSchema.safeParse(JSON.parse(fetched.body));
        if (!parsed.success || parsed.data.client_id !== clientId || !parsed.data.client_name?.trim()) throw new Error('Invalid document');
        checkGrantTypes(parsed.data);
        const redirectUris = [...new Set(parsed.data.redirect_uris)];
        if (redirectUris.length > MAX_REDIRECT_URIS || !redirectUris.every(isAllowedRedirectUri)) throw new Error('Invalid redirect URIs');
        return { ...base, name: normalizeClientName(parsed.data.client_name), redirectUris, ttl: cacheSeconds(fetched.cacheControl) };
    } catch {
        return { ...base, name: url.host, redirectUris: [], failed: true, ttl: 300 };
    }
}

/** A registered client, or a metadata document client fetched (and cached) on demand; `null` when unknown or invalid */
export async function resolveClient(clientId: string): Promise<McpClient | null> {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 512) return null;
    const store = getAppStore();
    const cached = await store.get<McpClient>(clientPk(clientId), sha256Hex(clientId));
    if (cached && cached.doc.clientId === clientId) return cached.doc.failed ? null : cached.doc;
    if (!clientId.startsWith('uier_client_') && isMetadataClientId(clientId)) {
        const client = await loadMetadataClient(clientId);
        await store.create(client);
        return client.failed ? null : client;
    }
    return null;
}

/** Keeps a registration alive while it is used: at most one write a day. */
export async function touchClient(client: McpClient) {
    if (client.kind !== 'dcr' || Date.now() - Date.parse(client.lastUsedAt) < 24 * 60 * 60 * 1000) return;
    const stored = await getAppStore().get<McpClient>(client.pk, client.id);
    if (stored) await getAppStore().replace({ ...stored.doc, lastUsedAt: new Date().toISOString(), ttl: OAUTH_LIFETIMES.dcrIdleSeconds }, stored.etag);
}
