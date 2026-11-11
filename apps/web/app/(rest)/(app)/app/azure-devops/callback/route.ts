import { finishAzureDevOpsConnect } from '@/src/lib/integrations/azure-devops';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const GET = integrationCallbackRoute('azure-devops', finishAzureDevOpsConnect);
