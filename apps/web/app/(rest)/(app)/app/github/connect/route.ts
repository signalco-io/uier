import { beginGitHubConnect } from '@/src/lib/integrations/github';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    const installationId = new URL(request.url).searchParams.get('installation') ?? undefined;
    return integrationConnectRoute('github', input => beginGitHubConnect({ ...input, installationId }))(request);
}
