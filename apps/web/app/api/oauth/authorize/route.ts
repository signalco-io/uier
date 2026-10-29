import { KnownPageLinks } from '@/src/knownPages';
import { startAuthorization } from '@/src/lib/mcp/oauth/authorize';
import { limitByIp, oauthEndpoint, oauthIssuer } from '@/src/lib/mcp/oauth/http';

export const dynamic = 'force-dynamic';

/**
 * Validates the request and sends the browser to the consent page. Only the stored request id passes
 * through sign-in; unknown clients and redirect URIs get a uier error page, never a redirect.
 */
export async function GET(request: Request) {
    return oauthEndpoint(async () => {
        await limitByIp(request, 'authorize', 60);
        const issuer = await oauthIssuer();
        const outcome = await startAuthorization(new URL(request.url).searchParams, issuer);
        const location = outcome.kind === 'redirect' ? outcome.url
            : new URL(outcome.kind === 'consent' ? KnownPageLinks.mcpConnect(outcome.requestId) : KnownPageLinks.mcpConnectError(outcome.error), issuer).toString();
        return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    });
}
