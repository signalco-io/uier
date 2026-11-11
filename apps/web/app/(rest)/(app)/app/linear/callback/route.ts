import { finishLinearConnect } from '@/src/lib/integrations/linear';
import { integrationCallbackRoute } from '@/src/lib/integrations/routes';

export const GET = integrationCallbackRoute('linear', finishLinearConnect);
