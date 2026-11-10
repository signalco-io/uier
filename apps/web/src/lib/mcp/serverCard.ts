import { createHash } from 'node:crypto';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { brand } from '@uier/brand';
import { webhookSigningKeys } from './events/identity';

/*
 * Discovery without a connection (the MCP Server Card extension): what the endpoint is, where it
 * is and which protocol revisions it speaks, at `GET /api/mcp/server-card` (the location the
 * extension reserves, `<endpoint>/server-card`), and an AI Catalog at `/.well-known/ai-catalog.json`
 * that points to it. Public, unauthenticated and never authoritative: a client checks everything
 * against the live connection. The card also carries the key that verifies the server's signature
 * on event webhooks (SEP-3415), because a key has to come from an origin the client already trusts.
 */

export const mcpServerInfo = { name: brand.name, version: '1.0.0' } as const;
/** The revision without a handshake, then the earlier ones `initialize` negotiates */
export const mcpProtocolVersions = ['2026-07-28', ...SUPPORTED_PROTOCOL_VERSIONS];
const REPOSITORY = 'https://github.com/signalco-io/uier';

export function serverCard(origin: string) {
    return {
        $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
        name: 'io.uier/uier',
        version: mcpServerInfo.version,
        title: brand.name,
        // At most 100 characters (the card's schema).
        description: 'Website feedback for coding agents: read threads with page context, reply, assign and set status.',
        websiteUrl: brand.url,
        repository: { url: REPOSITORY, source: 'github' },
        icons: [
            { src: `${origin}/android-chrome-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] },
            { src: `${origin}/android-chrome-512x512.png`, mimeType: 'image/png', sizes: ['512x512'] }
        ],
        remotes: [{
            type: 'streamable-http',
            url: `${origin}/api/mcp`,
            supportedProtocolVersions: mcpProtocolVersions,
            // Where SEP-3415 puts the webhook signing keys (a JWK set). Deliveries come from changing addresses, so no egress ranges.
            extensions: { 'io.modelcontextprotocol/events': { webhooks: { signingKeys: webhookSigningKeys() } } }
        }]
    };
}

/** The AI Catalog of this origin: one entry, the Server Card. */
export function aiCatalog(origin: string) {
    return { specVersion: '1.0', entries: [{ identifier: `urn:air:${new URL(brand.url).hostname}:mcp:${brand.name}`,
        type: 'application/mcp-server-card+json', url: `${origin}/api/mcp/server-card` }] };
}

/** A public, cacheable discovery document: any origin may read it, and an unchanged one answers 304. */
export function discoveryResponse(request: Request, document: unknown, contentType: string) {
    const body = JSON.stringify(document);
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    const headers = { 'Content-Type': contentType, ETag: etag, 'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
        'Access-Control-Expose-Headers': 'ETag', 'X-Content-Type-Options': 'nosniff' };
    const known = request.headers.get('if-none-match')?.split(',').map(value => value.trim().replace(/^W\//, ''));
    return known?.includes(etag) || known?.includes('*') ? new Response(null, { status: 304, headers }) : new Response(body, { headers });
}

export function discoveryPreflight() {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, If-None-Match', 'Access-Control-Max-Age': '86400' } });
}
