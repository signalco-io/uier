import { limitByIp, oauthEndpoint, readForm } from '@/src/lib/mcp/oauth/http';
import { revokeToken } from '@/src/lib/mcp/oauth/tokens';

export const dynamic = 'force-dynamic';

/** RFC 7009: unknown tokens still answer 200. */
export async function POST(request: Request) {
    return oauthEndpoint(async () => {
        await limitByIp(request, 'revoke', 120);
        await revokeToken(await readForm(request));
        return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    });
}
