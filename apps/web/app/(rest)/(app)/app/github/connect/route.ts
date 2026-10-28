import { beginGitHubConnect } from '@/src/lib/integrations/github';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationConnectRoute('github', beginGitHubConnect);
