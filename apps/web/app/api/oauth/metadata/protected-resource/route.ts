import { mcpOauthEnabled } from '@/src/lib/mcp/oauth/config';
import { oauthIssuer, oauthNotFound } from '@/src/lib/mcp/oauth/http';
import { protectedResourceMetadata, publicMetadataHeaders } from '@/src/lib/mcp/oauth/metadata';

export const dynamic = 'force-dynamic';

/** Served at /.well-known/oauth-protected-resource/api/mcp (next.config.ts rewrite) */
export async function GET() {
    if (!mcpOauthEnabled()) return oauthNotFound();
    return Response.json(protectedResourceMetadata(await oauthIssuer()), { headers: publicMetadataHeaders });
}
