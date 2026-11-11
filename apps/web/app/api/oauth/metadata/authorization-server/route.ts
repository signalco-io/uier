import { mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { oauthIssuer, oauthNotFound } from '@/src/lib/mcp/oauth/http';
import { authorizationServerMetadata, publicMetadataHeaders } from '@/src/lib/mcp/oauth/metadata';


/** Served at /.well-known/oauth-authorization-server (next.config.ts rewrite) */
export async function GET(request?: Request) {
    request?.headers.get('host');
    if (!mcpOauthEnabled()) return oauthNotFound();
    return Response.json(authorizationServerMetadata(await oauthIssuer()), { headers: publicMetadataHeaders });
}
