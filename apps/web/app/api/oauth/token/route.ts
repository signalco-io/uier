import { OAuthError, oauthJson } from '@/src/lib/mcp/oauth/errors';
import { limitByIp, oauthEndpoint, oauthIssuer, readForm } from '@/src/lib/mcp/oauth/http';
import { exchangeCode, refreshTokens } from '@/src/lib/mcp/oauth/tokens';

export const dynamic = 'force-dynamic';

/** Public clients only: no client authentication, no cookies and no CORS. */
export async function POST(request: Request) {
    return oauthEndpoint(async () => {
        await limitByIp(request, 'token', 600);
        const form = await readForm(request);
        const issuer = await oauthIssuer();
        try {
            const grantType = form.getAll('grant_type');
            if (grantType.length !== 1) throw new OAuthError('invalid_request', 'Send grant_type once.');
            if (grantType[0] === 'authorization_code') return oauthJson(await exchangeCode(form, issuer));
            if (grantType[0] === 'refresh_token') return oauthJson(await refreshTokens(form, issuer));
            throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
        } catch (error) {
            if (error instanceof OAuthError && error.code === 'invalid_grant') await limitByIp(request, 'token-failures', 30);
            throw error;
        }
    });
}
