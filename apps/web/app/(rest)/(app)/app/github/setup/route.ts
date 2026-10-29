import { getAppContext } from '@/src/lib/app/context';
import { appBaseUrl } from '@/src/lib/app/request';
import { finishGitHubSetup } from '@/src/lib/integrations/github';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const baseUrl = await appBaseUrl();
    const context = await getAppContext();
    if (!context) return new Response(null, { status: 302, headers: { Location: new URL('/app/sign-in?next=/app', baseUrl).href, 'Cache-Control': 'no-store' } });
    const params = new URL(request.url).searchParams;
    try {
        const result = await finishGitHubSetup({ userId: context.user.id, state: params.get('state'), installationId: params.get('installation_id'),
            setupAction: params.get('setup_action') ?? undefined, baseUrl });
        return new Response(null, { status: 302, headers: { Location: result.url, 'Cache-Control': 'no-store' } });
    } catch {
        return new Response('This connection link is not valid. Start again from the project settings.', {
            status: 400, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}
