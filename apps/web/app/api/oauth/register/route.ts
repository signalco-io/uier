import { registerClient } from '@/src/lib/mcp/oauth/clients';
import { OAuthError, oauthJson } from '@/src/lib/mcp/oauth/errors';
import { limitByIp, limitGlobally, oauthEndpoint } from '@/src/lib/mcp/oauth/http';

export const dynamic = 'force-dynamic';

/** RFC 7591 dynamic client registration without an initial access token; public clients only. */
export async function POST(request: Request) {
    return oauthEndpoint(async () => {
        await limitByIp(request, 'register', 20);
        await limitGlobally(request, 'register', 2000);
        if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? ''))
            throw new OAuthError('invalid_client_metadata', 'Send application/json.');
        const text = await request.text();
        if (Buffer.byteLength(text) > 16_384) throw new OAuthError('invalid_client_metadata', 'The client metadata is too large.');
        let body: unknown;
        try { body = JSON.parse(text); } catch { throw new OAuthError('invalid_client_metadata', 'The client metadata is not JSON.'); }
        return oauthJson(await registerClient(body), 201);
    });
}
