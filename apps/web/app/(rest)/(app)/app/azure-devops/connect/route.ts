import { beginAzureDevOpsConnect } from '@/src/lib/integrations/azure-devops';
import { integrationConnectRoute } from '@/src/lib/integrations/routes';

export const GET = integrationConnectRoute('azure-devops', beginAzureDevOpsConnect);
