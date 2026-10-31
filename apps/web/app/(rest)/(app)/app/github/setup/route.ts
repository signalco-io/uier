import { cookies } from 'next/headers';
import { getAppContext, WORKSPACE_COOKIE_NAME } from '@/src/lib/app/context';
import { appBaseUrl } from '@/src/lib/app/request';
import { isLocalRuntime } from '@/src/lib/comments/environment';
import { finishGitHubSetup } from '@/src/lib/integrations/github';
import { invalidIntegrationConnection } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const baseUrl = await appBaseUrl();
    const context = await getAppContext();
    if (!context) return new Response(null, { status: 302, headers: { Location: new URL('/app/sign-in?next=/app', baseUrl).href, 'Cache-Control': 'no-store' } });
    const params = new URL(request.url).searchParams;
    try {
        const result = await finishGitHubSetup({ userId: context.user.id, state: params.get('state'), installationId: params.get('installation_id'),
            setupAction: params.get('setup_action') ?? undefined, baseUrl });
        if (result.status === 'pending') (await cookies()).set(WORKSPACE_COOKIE_NAME, result.workspaceId, {
            httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600, secure: !isLocalRuntime()
        });
        return new Response(null, { status: 302, headers: { Location: result.url, 'Cache-Control': 'no-store' } });
    } catch {
        return invalidIntegrationConnection('github', baseUrl);
    }
}
