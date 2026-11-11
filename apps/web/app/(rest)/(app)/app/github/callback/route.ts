import { finishGitHubConnect } from '@/src/lib/integrations/github';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const GET = integrationCallbackRoute('github', finishGitHubConnect);
