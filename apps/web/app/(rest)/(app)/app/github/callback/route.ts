import { finishGitHubConnect } from '@/src/lib/integrations/github';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const dynamic = 'force-dynamic';
export const GET = integrationCallbackRoute('github', finishGitHubConnect);
